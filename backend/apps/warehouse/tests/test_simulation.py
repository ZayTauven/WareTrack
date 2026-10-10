import random
from collections import Counter
from datetime import timedelta

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

from apps.accounts.models import Organization
from apps.warehouse.invariants import find_violations
from apps.warehouse.models import Shipment, Truck
from apps.warehouse.realtime import broadcast, group_name, patch_payload
from apps.warehouse.simulation import Operation, Rates, persist, simulate_tick
from testing import NOW

TICK = timedelta(seconds=2)


def run_in_memory(organization: Organization, ticks: int, seed: int) -> Operation:
    op = Operation.load(organization)
    rng = random.Random(seed)
    for tick in range(1, ticks + 1):
        simulate_tick(op, NOW + tick * TICK, rng)
        violations = find_violations(op)
        assert not violations, f'tick {tick}: {violations}'
    return op


def test_seed_satisfies_every_invariant(seeded: Organization) -> None:
    assert find_violations(Operation.load(seeded)) == []


def test_keeps_every_invariant_over_a_long_run(seeded: Organization) -> None:
    op = run_in_memory(seeded, 1_500, seed=1)
    for site in op.sites:
        site_shipments = [s for s in op.shipments if s.site_id == site.id]
        completed = [s for s in site_shipments if s.status == Shipment.Status.COMPLETED]
        assert len(completed) <= Rates.HISTORY_PER_SITE
        assert max(Counter(s.reference for s in site_shipments).values()) == 1  # references stay unique


def test_moves_the_operation_forward(seeded: Organization) -> None:
    before = {t.id: t.status for t in Operation.load(seeded).trucks}
    op = run_in_memory(seeded, 200, seed=2)
    assert any(t.status != before[t.id] for t in op.trucks)
    assert any(s.status == Shipment.Status.SCHEDULED for s in op.shipments)


def test_is_deterministic_for_a_seed(seeded: Organization) -> None:
    def statuses(op: Operation) -> list[str]:
        return [t.status for t in op.trucks] + [f.status for f in op.forklifts]

    assert statuses(run_in_memory(seeded, 150, seed=3)) == statuses(run_in_memory(seeded, 150, seed=3))


def test_persisted_ticks_respect_the_database_constraints(seeded: Organization) -> None:
    # Like the worker: reload, tick, write, every tick. Any write-order mistake would trip a
    # constraint (one truck per dock, one active shipment per truck...) and raise IntegrityError.
    rng = random.Random(4)
    for tick in range(1, 121):  # ~4 simulated minutes, dozens of docks freed and re-taken
        op = Operation.load(seeded)
        persist(op, simulate_tick(op, NOW + tick * TICK, rng))
    reloaded = Operation.load(seeded)
    assert find_violations(reloaded) == []
    assert Shipment.objects.filter(site__organization=seeded, status=Shipment.Status.COMPLETED).count() > 9


def test_broadcasts_a_patch_of_what_changed(seeded: Organization) -> None:
    layer = get_channel_layer()
    channel = async_to_sync(layer.new_channel)()
    async_to_sync(layer.group_add)(group_name(seeded.id), channel)

    op = Operation.load(seeded)
    journal = simulate_tick(op, NOW + TICK, random.Random(5))
    persist(op, journal)
    broadcast(seeded, patch_payload(journal, NOW + TICK))

    message = async_to_sync(layer.receive)(channel)
    payload = message['payload']
    assert message['type'] == 'operation.patch'
    assert payload['type'] == 'patch'
    assert {t['id'] for t in payload['trucks']} == {str(pk) for pk in journal.changed(Truck)}
    changed = next(iter(payload['trucks']), None)
    if changed:  # same shape as the snapshot rows
        assert set(changed) == {
            'id',
            'name',
            'carrier',
            'siteId',
            'status',
            'dockId',
            'position',
            'rotationY',
            'updatedAt',
        }
