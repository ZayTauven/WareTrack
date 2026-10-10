"""The database itself rejects states the operation must never be in."""

import pytest
from django.db import IntegrityError, transaction

from apps.accounts.models import Organization
from apps.warehouse.models import Dock, Shipment, Truck
from testing import NOW


def _violates(action) -> bool:
    try:
        with transaction.atomic():
            action()
    except IntegrityError:
        return True
    return False


@pytest.fixture
def parked(seeded: Organization) -> Truck:
    return Truck.objects.get(name='PCF-310')  # idle, no dock, no active shipment


def test_truck_at_a_dock_only_while_handling(parked: Truck) -> None:
    free_dock = Dock.objects.get(site=parked.site, number=5)
    assert _violates(lambda: Truck.objects.filter(pk=parked.pk).update(status='loading'))
    assert _violates(lambda: Truck.objects.filter(pk=parked.pk).update(dock=free_dock))
    assert not _violates(lambda: Truck.objects.filter(pk=parked.pk).update(status='loading', dock=free_dock))


def test_one_truck_per_dock(parked: Truck) -> None:
    taken = Truck.objects.get(name='LGX-8847').dock
    assert _violates(lambda: Truck.objects.filter(pk=parked.pk).update(status='unloading', dock=taken))


def test_one_active_shipment_per_truck(parked: Truck) -> None:
    busy = Truck.objects.get(name='YTE-501')  # already carrying S-1047A
    scheduled = Shipment.objects.get(reference='S-1048A')
    assert _violates(lambda: Shipment.objects.filter(pk=scheduled.pk).update(status='in_transit', truck=busy))
    assert not _violates(lambda: Shipment.objects.filter(pk=scheduled.pk).update(status='in_transit', truck=parked))


def test_completion_time_only_when_completed(seeded: Organization) -> None:
    shipment = Shipment.objects.get(reference='S-1048A')
    assert _violates(lambda: Shipment.objects.filter(pk=shipment.pk).update(status='completed'))
    assert _violates(lambda: Shipment.objects.filter(pk=shipment.pk).update(completed_at=NOW))
    assert _violates(lambda: Shipment.objects.filter(pk=shipment.pk).update(progress=1.5))
