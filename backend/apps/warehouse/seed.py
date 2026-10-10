"""
Demo dataset, ported from the front end's src/data/seed.ts: 3 sites, 18 docks, 36 racks,
12 trucks, 8 forklifts, 40 items and 25 shipments. Times are minute offsets from `now`,
so ETAs and delays look current whenever the seed runs.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta

from django.db import transaction

from apps.accounts.models import Organization

from . import layout
from .layout import Facing
from .models import Dock, Forklift, InventoryItem, Rack, Shipment, ShipmentLine, Site, Truck

# fmt: off
SITES = [
    # key, code, name, city, timezone, docks in maintenance
    ('oak', 'OAK', 'Oakland Main DC', 'Oakland, CA', 'America/Los_Angeles', ()),
    ('dal', 'DAL', 'Dallas Regional Hub', 'Dallas, TX', 'America/Chicago', (6,)),
    ('mia', 'MIA', 'Miami Coastal Port', 'Miami, FL', 'America/New_York', (3,)),
]

# key, name, carrier, site, status, dock number (when at a dock)
TRUCKS = [
    ('truck-01', 'YTE-789', 'Yellow Trans Express', 'oak', 'loading', 2),
    ('truck-02', 'YTE-992', 'Yellow Trans Express', 'oak', 'waiting', None),
    ('truck-03', 'LGX-8847', 'Logistix Inc.', 'oak', 'unloading', 4),
    ('truck-04', 'YTE-501', 'Yellow Trans Express', 'oak', 'in_transit', None),
    ('truck-05', 'PCF-310', 'Pacific Freightways', 'oak', 'idle', None),
    ('truck-06', 'LSF-221', 'Lone Star Freight', 'dal', 'unloading', 1),
    ('truck-07', 'LSF-245', 'Lone Star Freight', 'dal', 'loading', 3),
    ('truck-08', 'LGX-9012', 'Logistix Inc.', 'dal', 'in_transit', None),
    ('truck-09', 'TXR-118', 'Texas Roadline', 'dal', 'idle', None),
    ('truck-10', 'CBX-402', 'Coastal Box Lines', 'mia', 'unloading', 5),
    ('truck-11', 'SUN-077', 'Suncoast Haulage', 'mia', 'waiting', None),
    ('truck-12', 'CBX-415', 'Coastal Box Lines', 'mia', 'in_transit', None),
]

# name, site, operator, status, battery, shipment reference, (x, z), rotation
_CHARGER = layout.CHARGER
FORKLIFTS = [
    ('Unit 401', 'oak', 'Maria G.', 'idle', 65, None, (-28, -1.5), Facing.EAST),
    ('Unit 402', 'oak', 'Jamal R.', 'moving', 82, 'EXP-993-C', layout.staging_point(layout.dock_x(4)), Facing.YARD),
    ('Unit 403', 'oak', 'Kenji T.', 'lifting', 47, 'S-1045A', layout.staging_point(layout.dock_x(2)), Facing.YARD),
    ('Unit 404', 'dal', 'Luis M.', 'moving', 71, 'D-2201', layout.staging_point(layout.dock_x(1)), Facing.YARD),
    ('Unit 405', 'dal', '', 'charging', 18, None, _CHARGER, Facing.BUILDING),
    ('Unit 406', 'dal', 'Aisha B.', 'lifting', 56, 'D-2202', layout.staging_point(layout.dock_x(3)), Facing.YARD),
    ('Unit 407', 'mia', 'Carlos D.', 'moving', 90, 'M-3301', layout.staging_point(layout.dock_x(5)), Facing.YARD),
    ('Unit 408', 'mia', '', 'maintenance', 40, None, _CHARGER, Facing.BUILDING),
]

# sku, name, category, unit, quantity, reorder point
INVENTORY = {
    'oak': [
        ('ELX-1001', 'Wireless earbuds (case of 24)', 'electronics', 'case', 180, 60),
        ('ELX-1002', 'USB-C chargers 65W', 'electronics', 'case', 42, 50),
        ('ELX-1003', '27" monitors', 'electronics', 'pallet', 12, 6),
        ('ELX-1004', 'Mechanical keyboards', 'electronics', 'case', 95, 40),
        ('HOM-2001', 'Cordless vacuum cleaners', 'home', 'pallet', 8, 10),
        ('HOM-2002', 'Ceramic dinnerware sets', 'home', 'case', 140, 50),
        ('HOM-2003', 'LED desk lamps', 'home', 'case', 66, 30),
        ('GRO-3001', 'Arabica coffee beans 1kg', 'grocery', 'case', 210, 80),
        ('GRO-3002', 'Sparkling water 12-pack', 'grocery', 'pallet', 14, 20),
        ('GRO-3003', 'Organic oat milk 1L', 'grocery', 'case', 320, 120),
        ('APP-4001', 'Rain jackets (assorted)', 'apparel', 'case', 75, 25),
        ('APP-4002', 'Running shoes (assorted)', 'apparel', 'case', 22, 30),
        ('AUT-5001', 'Synthetic motor oil 5L', 'automotive', 'case', 130, 40),
        ('AUT-5002', 'Wiper blades', 'automotive', 'case', 88, 35),
    ],
    'dal': [
        ('ELX-1005', 'Smart thermostats', 'electronics', 'case', 54, 20),
        ('ELX-1006', 'Gaming laptops', 'electronics', 'pallet', 5, 6),
        ('ELX-1007', 'HDMI cables 2m', 'electronics', 'case', 400, 100),
        ('HOM-2004', 'Memory foam mattresses', 'home', 'pallet', 18, 8),
        ('HOM-2005', 'Cast iron skillets', 'home', 'case', 72, 30),
        ('GRO-3004', 'Tortilla chips 24-pack', 'grocery', 'pallet', 26, 12),
        ('GRO-3005', 'BBQ sauce 500ml', 'grocery', 'case', 38, 60),
        ('APP-4003', 'Work boots (assorted)', 'apparel', 'case', 64, 25),
        ('APP-4004', 'Denim jeans (assorted)', 'apparel', 'case', 150, 50),
        ('AUT-5003', 'Truck tires 22.5"', 'automotive', 'pallet', 9, 4),
        ('AUT-5004', 'Car batteries 12V', 'automotive', 'pallet', 3, 5),
        ('PHA-6001', 'First aid kits', 'pharma', 'case', 110, 40),
        ('PHA-6002', 'Hand sanitizer 500ml', 'pharma', 'case', 260, 100),
    ],
    'mia': [
        ('ELX-1008', 'Action cameras', 'electronics', 'case', 47, 20),
        ('ELX-1009', 'Bluetooth speakers', 'electronics', 'case', 18, 25),
        ('HOM-2006', 'Outdoor patio chairs', 'home', 'pallet', 21, 10),
        ('HOM-2007', 'Beach umbrellas', 'home', 'case', 85, 30),
        ('GRO-3006', 'Coconut water 12-pack', 'grocery', 'pallet', 30, 15),
        ('GRO-3007', 'Cuban coffee 250g', 'grocery', 'case', 190, 70),
        ('GRO-3008', 'Fresh mangoes (crate)', 'grocery', 'pallet', 6, 12),
        ('APP-4005', 'Swimwear (assorted)', 'apparel', 'case', 120, 40),
        ('APP-4006', 'Sunglasses (assorted)', 'apparel', 'case', 58, 20),
        ('AUT-5005', 'Marine engine oil 4L', 'automotive', 'case', 70, 25),
        ('PHA-6003', 'Sunscreen SPF 50', 'pharma', 'case', 45, 60),
        ('PHA-6004', 'Insect repellent', 'pharma', 'case', 140, 50),
        ('PHA-6005', 'Electrolyte tablets', 'pharma', 'case', 95, 30),
    ],
}


@dataclass(frozen=True)
class ShipmentDef:
    reference: str
    site: str
    direction: str
    status: str
    counterparty: str
    truck: str | None
    dock: int | None
    promised: int
    eta: int
    completed: int | None
    progress: float
    lines: tuple[tuple[str, int], ...]


S = ShipmentDef
SHIPMENTS = [
    # Oakland
    S('S-1045A', 'oak', 'outbound', 'at_dock', 'Bay Area Retail Co.', 'truck-01', 2, -40, -42, None, 0.4, (('ELX-1001', 40), ('ELX-1004', 20))),
    S('S-1046A', 'oak', 'inbound', 'at_yard', 'Shenzhen Audio Ltd.', 'truck-02', 1, 10, -6, None, 0, (('ELX-1002', 60),)),
    S('EXP-993-C', 'oak', 'inbound', 'at_dock', 'Nordic Home Supply', 'truck-03', 4, -35, -20, None, 0.75, (('ELX-1003', 8), ('HOM-2001', 4))),
    S('S-1047A', 'oak', 'inbound', 'in_transit', 'Central Valley Foods', 'truck-04', None, 90, 105, None, 0, (('GRO-3002', 20), ('GRO-3003', 80))),
    S('S-1048A', 'oak', 'outbound', 'scheduled', 'Oakland Sports Outlet', None, None, 240, 240, None, 0, (('APP-4002', 10),)),
    S('S-1049A', 'oak', 'inbound', 'scheduled', 'Pacific Apparel Group', None, None, 300, 300, None, 0, (('APP-4001', 30),)),
    S('S-1050A', 'oak', 'outbound', 'scheduled', 'Sacramento Grocers', None, None, 420, 420, None, 0, (('GRO-3001', 40),)),
    S('S-1036A', 'oak', 'outbound', 'completed', 'Berkeley Home Store', 'truck-01', 5, -480, -485, -430, 1, (('HOM-2002', 30),)),
    S('S-1037A', 'oak', 'inbound', 'completed', 'Andes Coffee Traders', 'truck-02', 6, -360, -365, -320, 1, (('GRO-3001', 60),)),
    S('S-1038A', 'oak', 'inbound', 'completed', 'Valvoline West', 'truck-05', 3, -300, -310, -250, 1, (('AUT-5001', 40),)),
    # Dallas
    S('D-2201', 'dal', 'inbound', 'at_dock', 'Gulf Coast Electronics', 'truck-06', 1, -15, -18, None, 0.55, (('ELX-1006', 6), ('ELX-1007', 120))),
    S('D-2202', 'dal', 'outbound', 'at_dock', 'Austin Home & Garden', 'truck-07', 3, -40, -45, None, 0.3, (('HOM-2004', 6), ('HOM-2005', 24))),
    S('D-2203', 'dal', 'inbound', 'in_transit', 'Monterrey Auto Parts', 'truck-08', None, 60, 60, None, 0, (('AUT-5004', 12), ('AUT-5003', 4))),
    S('D-2204', 'dal', 'outbound', 'scheduled', 'Houston Pharmacy Network', None, None, 180, 180, None, 0, (('PHA-6001', 30), ('PHA-6002', 60))),
    S('D-2205', 'dal', 'inbound', 'scheduled', 'Lubbock Foods', None, None, 360, 360, None, 0, (('GRO-3005', 80),)),
    S('D-2198', 'dal', 'inbound', 'completed', 'El Paso Snacks', 'truck-09', 2, -420, -400, -350, 1, (('GRO-3004', 12),)),
    S('D-2199', 'dal', 'outbound', 'completed', 'Fort Worth Outfitters', 'truck-06', 4, -540, -545, -500, 1, (('APP-4004', 50),)),
    S('D-2200', 'dal', 'outbound', 'completed', 'Plano Workwear', 'truck-07', 5, -240, -250, -200, 1, (('APP-4003', 20),)),
    # Miami
    S('M-3301', 'mia', 'inbound', 'at_dock', 'Caribbean Fresh Imports', 'truck-10', 5, -25, -30, None, 0.65, (('GRO-3008', 20), ('GRO-3006', 10))),
    S('M-3302', 'mia', 'outbound', 'at_yard', 'Keys Resort Supply', 'truck-11', 1, 15, -5, None, 0, (('APP-4005', 40), ('PHA-6003', 20))),
    S('M-3303', 'mia', 'inbound', 'in_transit', 'Port Everglades Terminal', 'truck-12', None, 40, 75, None, 0, (('ELX-1009', 30),)),
    S('M-3304', 'mia', 'outbound', 'scheduled', 'Orlando Theme Retail', None, None, 200, 200, None, 0, (('HOM-2007', 25),)),
    S('M-3298', 'mia', 'inbound', 'completed', 'Havana Roasters', 'truck-10', 2, -600, -605, -540, 1, (('GRO-3007', 60),)),
    S('M-3299', 'mia', 'outbound', 'completed', 'South Beach Optics', 'truck-12', 4, -360, -370, -330, 1, (('APP-4006', 15),)),
    S('M-3300', 'mia', 'inbound', 'completed', 'Everglades Outdoor Co.', 'truck-11', 6, -180, -185, -140, 1, (('PHA-6004', 50),)),
]

# fmt: on


def _truck_placement(status: str, dock: int | None) -> layout.Placement:
    if status in ('loading', 'unloading'):
        return layout.docked_truck(layout.dock_x(dock or 1), layout.DOCK_WALL_Z)
    return {'waiting': layout.yard_slot, 'idle': layout.parking_slot, 'in_transit': layout.road_slot}[status](0)


@transaction.atomic
def seed_demo(organization: Organization, now: datetime) -> dict[str, int]:
    """Creates the demo operation for `organization`. Replaces any sites it already has."""

    def at(minutes: float) -> datetime:
        return now + timedelta(minutes=minutes)

    organization.sites.all().delete()

    sites = {
        key: Site.objects.create(
            organization=organization,
            code=code,
            name=name,
            city=city,
            timezone=tz,
            origin_x=index * layout.SITE_SPACING,
            origin_z=0,
            building_width=layout.BUILDING['width'],
            building_depth=layout.BUILDING['depth'],
            **{f'bounds_{k}': v for k, v in layout.SITE_BOUNDS.items()},
        )
        for index, (key, code, name, city, tz, _) in enumerate(SITES)
    }

    docks = {
        (key, number): Dock(
            site=sites[key],
            number=number,
            name=f'Dock {number}',
            state=Dock.State.MAINTENANCE if number in maintenance else Dock.State.OPERATIONAL,
            position_x=layout.dock_x(number),
            position_z=layout.DOCK_WALL_Z,
            rotation_y=Facing.YARD,
        )
        for key, *_, maintenance in SITES
        for number in range(1, layout.DOCK_COUNT + 1)
    }
    Dock.objects.bulk_create(docks.values())

    racks: dict[str, list[Rack]] = {key: [] for key, *_ in SITES}
    for key, *_ in SITES:
        for column, x in enumerate(layout.RACK_COLUMNS_X):
            for row, z in enumerate(layout.RACK_ROWS_Z):
                zone = 'A' if x < 0 else 'B'
                index = (column % 2) * len(layout.RACK_ROWS_Z) + row + 1
                racks[key].append(
                    Rack(
                        site=sites[key],
                        code=f'{zone}-{index:02d}',
                        zone=zone,
                        levels=layout.RACK_LEVELS,
                        position_x=x,
                        position_z=z,
                        rotation_y=0,
                        **layout.RACK_SIZE,
                    )
                )
    Rack.objects.bulk_create([rack for site_racks in racks.values() for rack in site_racks])

    trucks: dict[str, Truck] = {}
    for i, (key, name, carrier, site, status, dock) in enumerate(TRUCKS):
        placement = _truck_placement(status, dock)
        trucks[key] = Truck(
            site=sites[site],
            name=name,
            carrier=carrier,
            status=status,
            dock=docks[(site, dock)] if dock else None,
            position_x=placement.x,
            position_z=placement.z,
            rotation_y=placement.rotation_y,
            updated_at=at(-(i % 4)),
        )
    Truck.objects.bulk_create(trucks.values())

    items: dict[str, InventoryItem] = {}
    counter = 0
    for key, *_ in SITES:
        site_racks = racks[key]
        for j, (sku, name, category, unit, quantity, reorder_point) in enumerate(INVENTORY[key]):
            counter += 1
            items[sku] = InventoryItem(
                site=sites[key],
                rack=site_racks[j % len(site_racks)],
                level=(j + j // len(site_racks)) % layout.RACK_LEVELS,
                sku=sku,
                name=name,
                category=category,
                quantity=quantity,
                unit=unit,
                reorder_point=reorder_point,
                updated_at=at(-((counter * 37) % 720)),
            )
    InventoryItem.objects.bulk_create(items.values())

    shipments: dict[str, Shipment] = {}
    for d in SHIPMENTS:
        shipments[d.reference] = Shipment(
            site=sites[d.site],
            reference=d.reference,
            direction=d.direction,
            status=d.status,
            counterparty=d.counterparty,
            truck=trucks[d.truck] if d.truck else None,
            dock=docks[(d.site, d.dock)] if d.dock else None,
            promised_at=at(d.promised),
            eta=at(d.eta),
            completed_at=at(d.completed) if d.completed is not None else None,
            progress=d.progress,
            updated_at=at(d.completed) if d.completed is not None else at(-1),
        )
    Shipment.objects.bulk_create(shipments.values())
    ShipmentLine.objects.bulk_create(
        ShipmentLine(shipment=shipments[d.reference], item=items[sku], quantity=quantity)
        for d in SHIPMENTS
        for sku, quantity in d.lines
    )

    Forklift.objects.bulk_create(
        Forklift(
            site=sites[site],
            name=name,
            operator=operator,
            status=status,
            battery_pct=battery,
            shipment=shipments[reference] if reference else None,
            position_x=position[0],
            position_z=position[1],
            rotation_y=rotation,
            updated_at=at(-(i % 3)),
        )
        for i, (name, site, operator, status, battery, reference, position, rotation) in enumerate(FORKLIFTS)
    )

    return {
        'sites': len(sites),
        'docks': len(docks),
        'racks': sum(len(r) for r in racks.values()),
        'trucks': len(trucks),
        'forklifts': len(FORKLIFTS),
        'items': len(items),
        'shipments': len(shipments),
    }
