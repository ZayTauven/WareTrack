"""
Live operation simulator, ported from the front end's src/domain/simulation.ts.

`Operation` is an organization's operational state loaded into memory. `simulate_tick` mutates it
without touching the database and records every change, in order, in a `Journal`; `persist` then
writes the journal in that same order. The order matters: PostgreSQL checks the row constraints
(one truck per dock, one active shipment per truck...) statement by statement, so a dock freed and
re-taken in the same tick must be written release-first, exactly as it happened.

Trucks:    idle -> in_transit -> waiting (yard) -> loading|unloading (dock) -> idle
Forklifts: work the at-dock shipments of their site, shuttling between the staging lane and the
           racks, and recharge when the battery runs low.
"""

import math
import random
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from uuid import UUID

from django.db import models, transaction

from apps.accounts.models import Organization

from . import layout
from .layout import Facing
from .models import Dock, Forklift, InventoryItem, Shipment, ShipmentLine, Site, Truck


class Rates:
    """Per-tick odds and rates; a tick is one simulation step (2 s by default)."""

    ARRIVE = 0.25
    ETA_SLIP = 0.05
    ETA_SLIP_MINUTES = 5
    DOCK = 0.35
    HANDLING_BASE = 0.04
    HANDLING_SPREAD = 0.08
    HANDLING_WITHOUT_FORKLIFT = 0.35
    DISPATCH = 0.12
    TRAVEL_MINUTES = (2, 15)
    FORKLIFT_STEP = 0.6
    CHARGE = 3
    DRAIN = 0.3
    BATTERY_CRITICAL = 15
    BATTERY_RECHARGE = 25
    BATTERY_FULL = 95
    MIN_SCHEDULED_PER_SITE = 2
    HISTORY_PER_SITE = 30
    NEW_SHIPMENT_LEAD_MINUTES = (-10, 20)


@dataclass
class Operation:
    organization: Organization
    sites: list[Site]
    docks: list[Dock]
    trucks: list[Truck]
    forklifts: list[Forklift]
    shipments: list[Shipment]
    items: list[InventoryItem]
    lines: dict[UUID, list[ShipmentLine]]

    @classmethod
    def load(cls, organization: Organization) -> 'Operation':
        in_org = {'site__organization': organization}
        shipments = list(Shipment.objects.filter(**in_org).prefetch_related('lines'))
        return cls(
            organization=organization,
            sites=list(Site.objects.filter(organization=organization)),
            docks=list(Dock.objects.filter(**in_org)),
            trucks=list(Truck.objects.filter(**in_org)),
            forklifts=list(Forklift.objects.filter(**in_org)),
            shipments=shipments,
            items=list(InventoryItem.objects.filter(**in_org)),
            lines={s.id: list(s.lines.all()) for s in shipments},
        )


@dataclass
class Journal:
    """Changes of one tick, in the order they happened."""

    saves: list[tuple[models.Model, tuple[str, ...]]] = field(default_factory=list)
    created: list[Shipment] = field(default_factory=list)
    deleted: list[UUID] = field(default_factory=list)

    def touch(self, instance: models.Model, *fields: str) -> None:
        self.saves.append((instance, fields))

    def changed(self, model: type[models.Model]) -> list[UUID]:
        return list(dict.fromkeys(obj.pk for obj, _ in self.saves if isinstance(obj, model)))


def _same(a: tuple[float, float], b: tuple[float, float]) -> bool:
    return abs(a[0] - b[0]) < 1e-6 and abs(a[1] - b[1]) < 1e-6


def heading(start: tuple[float, float], end: tuple[float, float], fallback: float) -> float:
    if _same(start, end):
        return fallback
    return math.atan2(-(end[0] - start[0]), -(end[1] - start[1]))


def _between(rng: random.Random, bounds: tuple[float, float]) -> float:
    return bounds[0] + rng.random() * (bounds[1] - bounds[0])


def simulate_tick(op: Operation, now: datetime, rng: random.Random) -> Journal:
    journal = Journal()
    docks = {d.id: d for d in op.docks}
    items = {i.id: i for i in op.items}

    def active_shipment(truck: Truck) -> Shipment | None:
        return next((s for s in op.shipments if s.truck_id == truck.id and s.status in Shipment.ACTIVE), None)

    def free_slot(site_id: UUID, status: str, slot_at) -> layout.Placement | None:
        for slot in range(layout.SLOT_COUNT):
            placement = slot_at(slot)
            taken = any(
                t.site_id == site_id
                and t.status == status
                and _same((t.position_x, t.position_z), (placement.x, placement.z))
                for t in op.trucks
            )
            if not taken:
                return placement
        return None

    def dock_free(dock_id: UUID) -> bool:
        dock = docks.get(dock_id)
        return (
            dock is not None
            and dock.state == Dock.State.OPERATIONAL
            and not any(t.dock_id == dock_id for t in op.trucks)
        )

    def has_forklift(shipment: Shipment) -> bool:
        return any(f.shipment_id == shipment.id for f in op.forklifts)

    def place(truck: Truck, placement: layout.Placement) -> None:
        truck.position_x, truck.position_z, truck.rotation_y = placement.x, placement.z, placement.rotation_y

    def apply_stock(shipment: Shipment) -> None:
        sign = 1 if shipment.direction == Shipment.Direction.INBOUND else -1
        for line in op.lines.get(shipment.id, []):
            item = items.get(line.item_id)
            if item:
                item.quantity = max(0, item.quantity + sign * line.quantity)
                item.updated_at = now
                journal.touch(item, 'quantity', 'updated_at')

    # Trucks
    for truck in op.trucks:
        shipment = active_shipment(truck)
        moved = ('status', 'dock', 'position_x', 'position_z', 'rotation_y', 'updated_at')

        if truck.status == Truck.Status.IN_TRANSIT:
            if not shipment:
                continue
            if rng.random() < Rates.ARRIVE:
                slot = free_slot(truck.site_id, Truck.Status.WAITING, layout.yard_slot)
                if not slot:
                    continue
                shipment.status, shipment.eta, shipment.updated_at = Shipment.Status.AT_YARD, now, now
                journal.touch(shipment, 'status', 'eta', 'updated_at')
                truck.status, truck.updated_at = Truck.Status.WAITING, now
                place(truck, slot)
                journal.touch(truck, *moved)
            elif rng.random() < Rates.ETA_SLIP:
                shipment.eta += timedelta(minutes=Rates.ETA_SLIP_MINUTES)
                shipment.updated_at = truck.updated_at = now
                journal.touch(shipment, 'eta', 'updated_at')
                journal.touch(truck, 'updated_at')

        elif truck.status == Truck.Status.WAITING:
            if not shipment or rng.random() >= Rates.DOCK:
                continue
            preferred = docks[shipment.dock_id] if shipment.dock_id and dock_free(shipment.dock_id) else None
            dock = preferred or next((d for d in op.docks if d.site_id == truck.site_id and dock_free(d.id)), None)
            if not dock:
                continue
            shipment.status, shipment.dock_id, shipment.updated_at = Shipment.Status.AT_DOCK, dock.id, now
            journal.touch(shipment, 'status', 'dock', 'updated_at')
            inbound = shipment.direction == Shipment.Direction.INBOUND
            truck.status = Truck.Status.UNLOADING if inbound else Truck.Status.LOADING
            truck.dock_id, truck.updated_at = dock.id, now
            place(truck, layout.docked_truck(dock.position_x, dock.position_z))
            journal.touch(truck, *moved)

        elif truck.status in Truck.AT_DOCK:
            if not shipment:
                continue
            pace = 1 if has_forklift(shipment) else Rates.HANDLING_WITHOUT_FORKLIFT
            progress = min(1.0, shipment.progress + (Rates.HANDLING_BASE + rng.random() * Rates.HANDLING_SPREAD) * pace)
            if progress < 1:
                shipment.progress, shipment.updated_at, truck.updated_at = progress, now, now
                journal.touch(shipment, 'progress', 'updated_at')
                journal.touch(truck, 'updated_at')
                continue
            shipment.status, shipment.progress, shipment.completed_at, shipment.updated_at = (
                Shipment.Status.COMPLETED, 1.0, now, now,
            )  # fmt: skip
            journal.touch(shipment, 'status', 'progress', 'completed_at', 'updated_at')
            apply_stock(shipment)
            truck.status, truck.dock_id, truck.updated_at = Truck.Status.IDLE, None, now
            place(truck, free_slot(truck.site_id, Truck.Status.IDLE, layout.parking_slot) or layout.parking_slot(0))
            journal.touch(truck, *moved)

        elif truck.status == Truck.Status.IDLE:
            if rng.random() >= Rates.DISPATCH:
                continue
            queue = sorted(
                (
                    s
                    for s in op.shipments
                    if s.site_id == truck.site_id and s.status == Shipment.Status.SCHEDULED and not s.truck_id
                ),
                key=lambda s: s.promised_at,
            )
            slot = free_slot(truck.site_id, Truck.Status.IN_TRANSIT, layout.road_slot)
            if not queue or not slot:
                continue
            nxt = queue[0]
            nxt.status, nxt.truck_id, nxt.updated_at = Shipment.Status.IN_TRANSIT, truck.id, now
            nxt.eta = now + timedelta(minutes=round(_between(rng, Rates.TRAVEL_MINUTES)))
            journal.touch(nxt, 'status', 'truck', 'eta', 'updated_at')
            truck.status, truck.updated_at = Truck.Status.IN_TRANSIT, now
            place(truck, slot)
            journal.touch(truck, *moved)

    # Forklifts
    shipments_by_id = {s.id: s for s in op.shipments}
    forklift_fields = ('status', 'shipment', 'battery_pct', 'position_x', 'position_z', 'rotation_y', 'updated_at')

    def move_to(forklift: Forklift, target: tuple[float, float]) -> None:
        forklift.rotation_y = heading((forklift.position_x, forklift.position_z), target, forklift.rotation_y)
        forklift.position_x, forklift.position_z = target

    def record(forklift: Forklift) -> None:
        forklift.updated_at = now
        journal.touch(forklift, *forklift_fields)

    def to_charger(forklift: Forklift) -> None:
        forklift.status, forklift.shipment_id = Forklift.Status.CHARGING, None
        forklift.position_x, forklift.position_z = layout.CHARGER
        forklift.rotation_y = Facing.BUILDING

    for forklift in op.forklifts:
        if forklift.status == Forklift.Status.MAINTENANCE:
            continue

        if forklift.status == Forklift.Status.CHARGING:
            forklift.battery_pct = min(100, forklift.battery_pct + Rates.CHARGE)
            if forklift.battery_pct >= Rates.BATTERY_FULL:
                forklift.status = Forklift.Status.IDLE
            record(forklift)
            continue

        shipment = shipments_by_id.get(forklift.shipment_id) if forklift.shipment_id else None
        dock = docks.get(shipment.dock_id) if shipment and shipment.dock_id else None

        if shipment and shipment.status == Shipment.Status.AT_DOCK and dock:
            forklift.battery_pct = max(0, forklift.battery_pct - (1 if rng.random() < Rates.DRAIN else 0))
            if forklift.battery_pct < Rates.BATTERY_CRITICAL:
                to_charger(forklift)
            elif rng.random() < Rates.FORKLIFT_STEP:
                # moving to staging -> moving to a rack -> lifting at the rack -> back to staging
                staging = layout.staging_point(dock.position_x)
                if forklift.status == Forklift.Status.LIFTING:
                    forklift.status = Forklift.Status.MOVING
                    move_to(forklift, staging)
                elif forklift.status == Forklift.Status.MOVING and not _same(
                    (forklift.position_x, forklift.position_z), staging
                ):
                    forklift.status = Forklift.Status.LIFTING
                else:
                    forklift.status = Forklift.Status.MOVING
                    move_to(forklift, (round((rng.random() * 2 - 1) * layout.PICKING_X_RANGE), layout.PICKING_Z))
            record(forklift)
            continue

        # No dock work: recharge, or pick up a shipment that has no forklift yet, or stand by.
        if forklift.battery_pct < Rates.BATTERY_RECHARGE:
            to_charger(forklift)
            record(forklift)
            continue
        job = None
        if forklift.operator:
            site_docks = [d for d in op.docks if d.site_id == forklift.site_id]
            job = next(
                (
                    s
                    for d in site_docks
                    for s in op.shipments
                    if s.dock_id == d.id and s.status == Shipment.Status.AT_DOCK and not has_forklift(s)
                ),
                None,
            )
        if job and job.dock_id:
            forklift.status, forklift.shipment_id = Forklift.Status.MOVING, job.id
            move_to(forklift, layout.staging_point(docks[job.dock_id].position_x))
            record(forklift)
        elif forklift.shipment_id is not None or forklift.status != Forklift.Status.IDLE:
            forklift.status, forklift.shipment_id = Forklift.Status.IDLE, None
            record(forklift)

    # Keep a short queue of scheduled work per site so the demo never runs dry.
    for site in op.sites:
        site_shipments = [s for s in op.shipments if s.site_id == site.id]
        if sum(1 for s in site_shipments if s.status == Shipment.Status.SCHEDULED) >= Rates.MIN_SCHEDULED_PER_SITE:
            continue
        if site_shipments:
            created = _new_shipment(site, rng.choice(site_shipments), op, now, rng)
            op.shipments.append(created)
            journal.created.append(created)

    # Bounded history: drop the oldest completed shipments beyond the per-site budget.
    for site in op.sites:
        completed = sorted(
            (s for s in op.shipments if s.site_id == site.id and s.status == Shipment.Status.COMPLETED),
            key=lambda s: s.completed_at,
            reverse=True,
        )
        for old in completed[Rates.HISTORY_PER_SITE :]:
            op.shipments.remove(old)
            op.lines.pop(old.id, None)
            journal.deleted.append(old.id)

    return journal


_SIM_REFERENCE = re.compile(r'^[A-Z]+-(\d+)$')


def _new_shipment(site: Site, template: Shipment, op: Operation, now: datetime, rng: random.Random) -> Shipment:
    numbers = [
        int(m.group(1)) for s in op.shipments if s.site_id == site.id and (m := _SIM_REFERENCE.match(s.reference))
    ]
    sequence = max([5000, *numbers]) + 1
    promised = now + timedelta(minutes=round(_between(rng, Rates.NEW_SHIPMENT_LEAD_MINUTES)))
    shipment = Shipment(
        site_id=site.id,
        reference=f'{site.code}-{sequence}',
        direction=template.direction,
        status=Shipment.Status.SCHEDULED,
        counterparty=template.counterparty,
        promised_at=promised,
        eta=promised,
        progress=0,
        updated_at=now,
    )
    op.lines[shipment.id] = [
        ShipmentLine(shipment=shipment, item_id=line.item_id, quantity=line.quantity)
        for line in op.lines.get(template.id, [])
    ]
    return shipment


@transaction.atomic
def persist(op: Operation, journal: Journal) -> None:
    """
    Writes one tick in a handful of statements: new shipments, then one bulk update per model.

    PostgreSQL checks the partial unique constraints row by row, so within a tick the only hazard is
    a dock freed by one truck and taken by another: trucks that release a dock are written first.
    No other conflict can arise in one tick: a truck taking a dock was waiting without one, and a truck
    that completes a shipment is not dispatched again before the next tick (each truck moves once).
    """
    if journal.created:
        Shipment.objects.bulk_create(journal.created)
        ShipmentLine.objects.bulk_create(line for s in journal.created for line in op.lines.get(s.id, []))

    instances: dict[type[models.Model], dict[UUID, models.Model]] = {}
    fields: dict[type[models.Model], set[str]] = {}
    for instance, touched in journal.saves:
        model = type(instance)
        instances.setdefault(model, {})[instance.pk] = instance
        fields.setdefault(model, set()).update(touched)

    trucks = list(instances.pop(Truck, {}).values())
    truck_fields = sorted(fields.get(Truck, ()))
    released = [t for t in trucks if t.dock_id is None]
    Truck.objects.bulk_update(released, truck_fields)
    Truck.objects.bulk_update([t for t in trucks if t.dock_id is not None], truck_fields)
    for model, rows in instances.items():
        model.objects.bulk_update(list(rows.values()), sorted(fields[model]))

    if journal.deleted:
        Shipment.objects.filter(id__in=journal.deleted).delete()
