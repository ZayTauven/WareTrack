"""
Operator actions on the live operation.

Every action runs under the organization's operation lock, the same one the simulation worker
takes for a tick, so an action is never overwritten by a tick computed from older state. Each
action validates the business rules, writes, and returns a Journal of what changed so the caller
can answer with, and broadcast, the same patch the live feed sends.
"""

from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime
from uuid import UUID

from django.db import connection, transaction

from apps.accounts.models import Organization

from . import layout
from .layout import Facing
from .models import Dock, Forklift, Shipment, Truck
from .simulation import Journal, Rates, heading


class ActionRejected(Exception):
    """A business rule forbids the action. `code` is stable for clients; `message` is for people."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@contextmanager
def operation_lock(organization: Organization) -> Iterator[None]:
    """Serializes writers of one organization's operation (actions and simulation ticks)."""
    key = int.from_bytes(organization.id.bytes[:8], 'big', signed=True)
    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute('SELECT pg_advisory_xact_lock(%s)', [key])
        yield


def _in_org(model, organization: Organization, pk: UUID):
    obj = model.objects.select_for_update().filter(site__organization=organization, pk=pk).first()
    if obj is None:
        raise model.DoesNotExist
    return obj


def dock_truck(organization: Organization, truck_id: UUID, dock_id: UUID, now: datetime) -> Journal:
    """Sends a truck waiting in the yard to a free, operational dock of its site."""
    journal = Journal()
    with operation_lock(organization):
        truck = _in_org(Truck, organization, truck_id)
        if truck.status != Truck.Status.WAITING:
            raise ActionRejected('truck_not_waiting', f'{truck.name} is not waiting in the yard.')
        dock = Dock.objects.select_for_update().filter(site_id=truck.site_id, pk=dock_id).first()
        if dock is None:
            raise ActionRejected('dock_not_on_site', 'That dock is on another site than the truck.')
        if dock.state != Dock.State.OPERATIONAL:
            raise ActionRejected('dock_in_maintenance', f'{dock.name} is in maintenance.')
        if Truck.objects.filter(dock=dock).exists():
            raise ActionRejected('dock_occupied', f'{dock.name} already has a truck.')
        shipment = Shipment.objects.select_for_update().filter(truck=truck, status=Shipment.Status.AT_YARD).first()
        if shipment is None:
            raise ActionRejected('no_shipment', f'{truck.name} has no shipment to handle.')

        shipment.status, shipment.dock, shipment.updated_at = Shipment.Status.AT_DOCK, dock, now
        shipment.save(update_fields=['status', 'dock', 'updated_at'])
        inbound = shipment.direction == Shipment.Direction.INBOUND
        placement = layout.docked_truck(dock.position_x, dock.position_z)
        truck.status = Truck.Status.UNLOADING if inbound else Truck.Status.LOADING
        truck.dock, truck.updated_at = dock, now
        truck.position_x, truck.position_z, truck.rotation_y = placement.x, placement.z, placement.rotation_y
        truck.save(update_fields=['status', 'dock', 'position_x', 'position_z', 'rotation_y', 'updated_at'])
        journal.touch(shipment, 'status')
        journal.touch(truck, 'status')
    return journal


def assign_forklift(organization: Organization, forklift_id: UUID, shipment_id: UUID | None, now: datetime) -> Journal:
    """Puts a forklift on a shipment being handled at a dock of its site, or releases it (None)."""
    journal = Journal()
    with operation_lock(organization):
        forklift = _in_org(Forklift, organization, forklift_id)
        if forklift.status == Forklift.Status.MAINTENANCE:
            raise ActionRejected('forklift_in_maintenance', f'{forklift.name} is in maintenance.')

        if shipment_id is None:
            forklift.status, forklift.shipment = Forklift.Status.IDLE, None
        else:
            if not forklift.operator:
                raise ActionRejected('no_operator', f'{forklift.name} has no operator.')
            if forklift.battery_pct < Rates.BATTERY_CRITICAL:
                raise ActionRejected('battery_low', f'{forklift.name} needs charging first.')
            shipment = Shipment.objects.filter(site_id=forklift.site_id, pk=shipment_id).select_related('dock').first()
            if shipment is None:
                raise ActionRejected('shipment_not_on_site', 'That shipment is on another site than the forklift.')
            if shipment.status != Shipment.Status.AT_DOCK or shipment.dock is None:
                raise ActionRejected('shipment_not_at_dock', f'{shipment.reference} is not being handled at a dock.')
            target = layout.staging_point(shipment.dock.position_x)
            forklift.rotation_y = heading((forklift.position_x, forklift.position_z), target, forklift.rotation_y)
            forklift.position_x, forklift.position_z = target
            forklift.status, forklift.shipment = Forklift.Status.MOVING, shipment

        forklift.updated_at = now
        forklift.save(update_fields=['status', 'shipment', 'position_x', 'position_z', 'rotation_y', 'updated_at'])
        journal.touch(forklift, 'status')
    return journal


def charge_forklift(organization: Organization, forklift_id: UUID, now: datetime) -> Journal:
    """Sends a forklift to the charger, releasing any shipment it was working."""
    journal = Journal()
    with operation_lock(organization):
        forklift = _in_org(Forklift, organization, forklift_id)
        if forklift.status == Forklift.Status.MAINTENANCE:
            raise ActionRejected('forklift_in_maintenance', f'{forklift.name} is in maintenance.')
        forklift.status, forklift.shipment = Forklift.Status.CHARGING, None
        forklift.position_x, forklift.position_z = layout.CHARGER
        forklift.rotation_y, forklift.updated_at = Facing.BUILDING, now
        forklift.save(update_fields=['status', 'shipment', 'position_x', 'position_z', 'rotation_y', 'updated_at'])
        journal.touch(forklift, 'status')
    return journal


def set_dock_state(organization: Organization, dock_id: UUID, state: str, now: datetime) -> Journal:
    """Takes a dock out of service, or puts it back. A dock with a truck at it stays in service."""
    with operation_lock(organization):
        dock = _in_org(Dock, organization, dock_id)
        if state == Dock.State.MAINTENANCE and Truck.objects.filter(dock=dock).exists():
            raise ActionRejected('dock_occupied', f'{dock.name} has a truck at it.')
        dock.state, dock.updated_at = state, now
        dock.save(update_fields=['state', 'updated_at'])
    journal = Journal()
    journal.touch(dock, 'state')
    return journal
