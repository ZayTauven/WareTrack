"""
Operational rules the state must always satisfy, whoever mutates it. Port of the front end's
src/domain/invariants.ts. The database enforces the single-row rules too; these cover the
cross-row ones (truck and shipment agree, forklifts only work docked shipments...).
"""

from .models import Dock, Shipment, Truck
from .simulation import Operation

_SHIPMENT_FOR_TRUCK = {
    Truck.Status.IN_TRANSIT: lambda status, _: status == Shipment.Status.IN_TRANSIT,
    Truck.Status.WAITING: lambda status, _: status == Shipment.Status.AT_YARD,
    Truck.Status.LOADING: lambda status, direction: status == Shipment.Status.AT_DOCK and direction == 'outbound',
    Truck.Status.UNLOADING: lambda status, direction: status == Shipment.Status.AT_DOCK and direction == 'inbound',
    Truck.Status.IDLE: lambda *_: False,
}


def find_violations(op: Operation) -> list[str]:
    violations: list[str] = []
    docks = {d.id: d for d in op.docks}
    shipments = {s.id: s for s in op.shipments}
    items = {i.id: i for i in op.items}

    for truck in op.trucks:
        active = [s for s in op.shipments if s.truck_id == truck.id and s.status in Shipment.ACTIVE]
        expected = 0 if truck.status == Truck.Status.IDLE else 1
        if len(active) != expected:
            violations.append(f'{truck.name}: {len(active)} active shipments while {truck.status}')
        shipment = active[0] if active else None
        if shipment and not _SHIPMENT_FOR_TRUCK[truck.status](shipment.status, shipment.direction):
            violations.append(
                f'{truck.name}: {truck.status} but {shipment.reference} is {shipment.direction} {shipment.status}'
            )
        at_dock = truck.status in Truck.AT_DOCK
        if at_dock != (truck.dock_id is not None):
            violations.append(f'{truck.name}: dock {truck.dock_id} while {truck.status}')
        if at_dock and shipment and shipment.dock_id != truck.dock_id:
            violations.append(f'{truck.name}: at {truck.dock_id}, shipment at {shipment.dock_id}')
        if truck.dock_id and docks[truck.dock_id].state != Dock.State.OPERATIONAL:
            violations.append(f'{truck.name}: at an unusable dock')

    used = [t.dock_id for t in op.trucks if t.dock_id]
    if len(set(used)) != len(used):
        violations.append('two trucks share a dock')

    for forklift in op.forklifts:
        if not forklift.shipment_id:
            continue
        shipment = shipments.get(forklift.shipment_id)
        if not shipment or shipment.status != Shipment.Status.AT_DOCK:
            violations.append(f'{forklift.name}: on a shipment that is {shipment.status if shipment else "missing"}')
        elif shipment.site_id != forklift.site_id:
            violations.append(f'{forklift.name}: on a shipment of another site')

    for shipment in op.shipments:
        if (shipment.status == Shipment.Status.COMPLETED) != (shipment.completed_at is not None):
            violations.append(f'{shipment.reference}: completed_at mismatch')
        if not 0 <= shipment.progress <= 1:
            violations.append(f'{shipment.reference}: progress {shipment.progress}')
        for line in op.lines.get(shipment.id, []):
            item = items.get(line.item_id)
            if not item or item.site_id != shipment.site_id:
                violations.append(f'{shipment.reference}: line for an item of another site')

    for item in op.items:
        if item.quantity < 0:
            violations.append(f'{item.sku}: negative stock')

    return violations
