from collections import Counter

from apps.accounts.models import Organization
from apps.warehouse.models import Dock, Forklift, InventoryItem, Rack, Shipment, ShipmentLine, Site, Truck
from apps.warehouse.seed import seed_demo

from .conftest import NOW


def test_creates_the_requested_volumes(seeded: Organization) -> None:
    sites = Site.objects.filter(organization=seeded)
    assert sites.count() == 3
    assert Dock.objects.filter(site__in=sites).count() == 18
    assert Rack.objects.filter(site__in=sites).count() == 36
    assert Truck.objects.filter(site__in=sites).count() == 12
    assert Forklift.objects.filter(site__in=sites).count() == 8
    assert InventoryItem.objects.filter(site__in=sites).count() == 40
    assert Shipment.objects.filter(site__in=sites).count() == 25
    assert Counter(Dock.objects.values_list('site__code', flat=True)) == {'OAK': 6, 'DAL': 6, 'MIA': 6}


def test_matches_the_front_end_seed(seeded: Organization) -> None:
    # Spot checks against src/data/seed.ts and the KPI figures its tests assert.
    truck = Truck.objects.get(name='LGX-8847')
    assert (truck.status, truck.dock.name, truck.position_z) == ('unloading', 'Dock 4', -26)
    late = Shipment.objects.get(reference='EXP-993-C')
    assert (late.eta - late.promised_at).total_seconds() / 60 == 15
    low_stock = [i for i in InventoryItem.objects.filter(site__code='OAK') if i.quantity <= i.reorder_point]
    assert len(low_stock) == 4


def test_keeps_rows_consistent_across_relations(seeded: Organization) -> None:
    for item in InventoryItem.objects.select_related('rack'):
        assert item.rack.site_id == item.site_id
        assert item.level < item.rack.levels
    for line in ShipmentLine.objects.select_related('shipment', 'item'):
        assert line.item.site_id == line.shipment.site_id
    for forklift in Forklift.objects.exclude(shipment=None).select_related('shipment'):
        assert forklift.shipment.status == Shipment.Status.AT_DOCK
        assert forklift.shipment.site_id == forklift.site_id
    for shipment in Shipment.objects.filter(status=Shipment.Status.AT_DOCK).select_related('truck'):
        assert shipment.truck.dock_id == shipment.dock_id


def test_reseeding_replaces_the_operation(seeded: Organization) -> None:
    seed_demo(seeded, NOW)
    assert Site.objects.filter(organization=seeded).count() == 3
    assert Shipment.objects.filter(site__organization=seeded).count() == 25


def test_tenants_do_not_share_records(seeded: Organization) -> None:
    other = Organization.objects.create(name='Other Co', slug='other')
    seed_demo(other, NOW)
    seed_demo(seeded, NOW)  # reseeding one tenant must leave the other untouched
    assert Site.objects.filter(organization=other).count() == 3
    assert Truck.objects.filter(site__organization=other).count() == 12
    assert not Site.objects.filter(organization=seeded).filter(id__in=Site.objects.filter(organization=other)).exists()
