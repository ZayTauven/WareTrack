"""
Warehouse operational model, mirroring the front end's src/data/types.ts.

Conventions (same as the front end):
- Distances in metres; floor positions are (x, z), local to the site; rotation_y in radians,
  0 facing -Z (the yard).
- Every record belongs to a site, and a site to an organization (the tenant).
- Invariants that a single row can express are enforced by the database (check and partial
  unique constraints). Cross-row rules (e.g. a rack and its items share a site) are checked by
  the domain layer.
"""

import uuid

from django.db import models
from django.db.models import Q
from django.utils import timezone

from apps.accounts.models import Organization


class UUIDModel(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    class Meta:
        abstract = True


class Placement(models.Model):
    position_x = models.FloatField()
    position_z = models.FloatField()
    rotation_y = models.FloatField(default=0)

    class Meta:
        abstract = True


class Site(UUIDModel):
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name='sites')
    code = models.CharField(max_length=8, help_text='Short code shown in the UI, e.g. OAK.')
    name = models.CharField(max_length=120)
    city = models.CharField(max_length=120)
    timezone = models.CharField(max_length=64)
    # World position of the site's local origin, so sites sit apart in one shared scene.
    origin_x = models.FloatField()
    origin_z = models.FloatField()
    building_width = models.FloatField()
    building_depth = models.FloatField()
    # Local area covering building, yard and approach road; used as camera limits.
    bounds_min_x = models.FloatField()
    bounds_max_x = models.FloatField()
    bounds_min_z = models.FloatField()
    bounds_max_z = models.FloatField()

    class Meta:
        ordering = ['organization', 'code']
        constraints = [
            models.UniqueConstraint(fields=['organization', 'code'], name='site_code_unique_per_org'),
            models.CheckConstraint(
                condition=Q(building_width__gt=0, building_depth__gt=0), name='site_building_positive'
            ),
            models.CheckConstraint(
                condition=Q(bounds_min_x__lt=models.F('bounds_max_x'), bounds_min_z__lt=models.F('bounds_max_z')),
                name='site_bounds_ordered',
            ),
        ]

    def __str__(self) -> str:
        return f'{self.code} · {self.name}'


class Dock(UUIDModel, Placement):
    class State(models.TextChoices):
        OPERATIONAL = 'operational'
        MAINTENANCE = 'maintenance'

    site = models.ForeignKey(Site, on_delete=models.CASCADE, related_name='docks')
    number = models.PositiveSmallIntegerField()
    name = models.CharField(max_length=40)
    # Whether the door can be used. Occupancy is derived from trucks, never stored.
    state = models.CharField(max_length=16, choices=State.choices, default=State.OPERATIONAL)
    updated_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ['site', 'number']
        constraints = [
            models.UniqueConstraint(fields=['site', 'number'], name='dock_number_unique_per_site'),
            models.CheckConstraint(condition=Q(number__gte=1), name='dock_number_positive'),
        ]

    def __str__(self) -> str:
        return f'{self.site.code} {self.name}'


class Rack(UUIDModel, Placement):
    site = models.ForeignKey(Site, on_delete=models.CASCADE, related_name='racks')
    code = models.CharField(max_length=16, help_text='Location code, e.g. A-03.')
    zone = models.CharField(max_length=8)
    levels = models.PositiveSmallIntegerField(help_text='Storage levels; level 0 is the floor.')
    length = models.FloatField()
    depth = models.FloatField()
    height = models.FloatField()

    class Meta:
        ordering = ['site', 'code']
        constraints = [
            models.UniqueConstraint(fields=['site', 'code'], name='rack_code_unique_per_site'),
            models.CheckConstraint(condition=Q(levels__gte=1), name='rack_has_levels'),
            models.CheckConstraint(condition=Q(length__gt=0, depth__gt=0, height__gt=0), name='rack_size_positive'),
        ]

    def __str__(self) -> str:
        return f'{self.site.code} {self.code}'


class Truck(UUIDModel, Placement):
    class Status(models.TextChoices):
        IN_TRANSIT = 'in_transit'
        WAITING = 'waiting'
        LOADING = 'loading'
        UNLOADING = 'unloading'
        IDLE = 'idle'

    AT_DOCK = (Status.LOADING, Status.UNLOADING)

    site = models.ForeignKey(
        Site, on_delete=models.CASCADE, related_name='trucks', help_text='Site it is at or heading to.'
    )
    name = models.CharField(max_length=40, help_text='Fleet unit name, e.g. YTE-789.')
    carrier = models.CharField(max_length=120)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.IDLE)
    dock = models.ForeignKey(Dock, on_delete=models.RESTRICT, null=True, blank=True, related_name='+')
    updated_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ['site', 'name']
        constraints = [
            # Backed into a dock exactly while loading or unloading.
            models.CheckConstraint(
                condition=Q(status__in=['loading', 'unloading'], dock__isnull=False)
                | (~Q(status__in=['loading', 'unloading']) & Q(dock__isnull=True)),
                name='truck_dock_iff_handling',
            ),
            # One truck per dock door.
            models.UniqueConstraint(fields=['dock'], condition=Q(dock__isnull=False), name='one_truck_per_dock'),
        ]
        indexes = [models.Index(fields=['site', 'status'])]

    def __str__(self) -> str:
        return self.name


class InventoryItem(UUIDModel):
    class Category(models.TextChoices):
        ELECTRONICS = 'electronics'
        HOME = 'home'
        GROCERY = 'grocery'
        APPAREL = 'apparel'
        AUTOMOTIVE = 'automotive'
        PHARMA = 'pharma'

    class Unit(models.TextChoices):
        PALLET = 'pallet'
        CASE = 'case'

    site = models.ForeignKey(Site, on_delete=models.CASCADE, related_name='inventory')
    rack = models.ForeignKey(Rack, on_delete=models.RESTRICT, related_name='items')
    level = models.PositiveSmallIntegerField()
    sku = models.CharField(max_length=32)
    name = models.CharField(max_length=160)
    category = models.CharField(max_length=16, choices=Category.choices)
    quantity = models.PositiveIntegerField()
    unit = models.CharField(max_length=8, choices=Unit.choices)
    # Low stock when quantity <= reorder_point.
    reorder_point = models.PositiveIntegerField()
    updated_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ['site', 'sku']
        constraints = [models.UniqueConstraint(fields=['site', 'sku'], name='sku_unique_per_site')]

    def __str__(self) -> str:
        return f'{self.sku} {self.name}'


class Shipment(UUIDModel):
    class Direction(models.TextChoices):
        INBOUND = 'inbound'
        OUTBOUND = 'outbound'

    class Status(models.TextChoices):
        SCHEDULED = 'scheduled'
        IN_TRANSIT = 'in_transit'
        AT_YARD = 'at_yard'
        AT_DOCK = 'at_dock'
        COMPLETED = 'completed'

    ACTIVE = (Status.IN_TRANSIT, Status.AT_YARD, Status.AT_DOCK)

    site = models.ForeignKey(Site, on_delete=models.CASCADE, related_name='shipments')
    reference = models.CharField(max_length=32)
    direction = models.CharField(max_length=8, choices=Direction.choices)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.SCHEDULED)
    counterparty = models.CharField(max_length=160, help_text='Supplier for inbound, customer for outbound.')
    truck = models.ForeignKey(Truck, on_delete=models.SET_NULL, null=True, blank=True, related_name='shipments')
    dock = models.ForeignKey(Dock, on_delete=models.SET_NULL, null=True, blank=True, related_name='shipments')
    promised_at = models.DateTimeField(help_text='Committed arrival time (the appointment).')
    eta = models.DateTimeField(help_text='Estimated arrival; the actual arrival once the truck is on site.')
    completed_at = models.DateTimeField(null=True, blank=True)
    progress = models.FloatField(default=0, help_text='Dock handling progress, 0 to 1.')
    updated_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ['site', 'promised_at']
        constraints = [
            models.UniqueConstraint(fields=['site', 'reference'], name='shipment_reference_unique_per_site'),
            models.CheckConstraint(condition=Q(progress__gte=0, progress__lte=1), name='shipment_progress_ratio'),
            models.CheckConstraint(
                condition=Q(status='completed', completed_at__isnull=False)
                | (~Q(status='completed') & Q(completed_at__isnull=True)),
                name='shipment_completed_at_iff_completed',
            ),
            # A truck carries at most one active shipment.
            models.UniqueConstraint(
                fields=['truck'],
                condition=Q(truck__isnull=False, status__in=['in_transit', 'at_yard', 'at_dock']),
                name='one_active_shipment_per_truck',
            ),
        ]
        indexes = [models.Index(fields=['site', 'status'])]

    def __str__(self) -> str:
        return self.reference


class ShipmentLine(models.Model):
    shipment = models.ForeignKey(Shipment, on_delete=models.CASCADE, related_name='lines')
    item = models.ForeignKey(InventoryItem, on_delete=models.RESTRICT, related_name='shipment_lines')
    quantity = models.PositiveIntegerField()

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['shipment', 'item'], name='one_line_per_item'),
            models.CheckConstraint(condition=Q(quantity__gt=0), name='line_quantity_positive'),
        ]

    def __str__(self) -> str:
        return f'{self.shipment} · {self.item.sku} x {self.quantity}'


class Forklift(UUIDModel, Placement):
    class Status(models.TextChoices):
        IDLE = 'idle'
        MOVING = 'moving'
        LIFTING = 'lifting'
        CHARGING = 'charging'
        MAINTENANCE = 'maintenance'

    site = models.ForeignKey(Site, on_delete=models.CASCADE, related_name='forklifts')
    name = models.CharField(max_length=40)
    operator = models.CharField(max_length=120, blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.IDLE)
    battery_pct = models.PositiveSmallIntegerField()
    shipment = models.ForeignKey(Shipment, on_delete=models.SET_NULL, null=True, blank=True, related_name='forklifts')
    updated_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ['site', 'name']
        constraints = [models.CheckConstraint(condition=Q(battery_pct__lte=100), name='forklift_battery_pct')]

    def __str__(self) -> str:
        return self.name
