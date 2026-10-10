"""
Read serializers. Output matches the front end's WarehouseData shape (src/data/types.ts):
camelCase keys, `siteId`-style foreign keys, placements as `position: {x, z}` + `rotationY`.
"""

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from .kpis import SiteKpis
from .models import Dock, Forklift, InventoryItem, Rack, Shipment, Site, Truck


class FloorPoint(serializers.Serializer):
    x = serializers.FloatField(source='position_x')
    z = serializers.FloatField(source='position_z')


class Origin(serializers.Serializer):
    x = serializers.FloatField(source='origin_x')
    z = serializers.FloatField(source='origin_z')


class BuildingSize(serializers.Serializer):
    width = serializers.FloatField(source='building_width')
    depth = serializers.FloatField(source='building_depth')


class FloorRect(serializers.Serializer):
    minX = serializers.FloatField(source='bounds_min_x')
    maxX = serializers.FloatField(source='bounds_max_x')
    minZ = serializers.FloatField(source='bounds_min_z')
    maxZ = serializers.FloatField(source='bounds_max_z')


class RackSize(serializers.Serializer):
    length = serializers.FloatField()
    depth = serializers.FloatField()
    height = serializers.FloatField()


class SiteSerializer(serializers.ModelSerializer):
    origin = Origin(source='*')
    building = BuildingSize(source='*')
    bounds = FloorRect(source='*')

    class Meta:
        model = Site
        fields = ['id', 'code', 'name', 'city', 'timezone', 'origin', 'building', 'bounds']


class PlacedSerializer(serializers.ModelSerializer):
    siteId = serializers.UUIDField(source='site_id')
    position = FloorPoint(source='*')
    rotationY = serializers.FloatField(source='rotation_y')


class DockSerializer(PlacedSerializer):
    class Meta:
        model = Dock
        fields = ['id', 'siteId', 'number', 'name', 'state', 'position', 'rotationY']


class RackSerializer(PlacedSerializer):
    size = RackSize(source='*')

    class Meta:
        model = Rack
        fields = ['id', 'siteId', 'code', 'zone', 'levels', 'size', 'position', 'rotationY']


class TruckSerializer(PlacedSerializer):
    dockId = serializers.UUIDField(source='dock_id', allow_null=True)
    updatedAt = serializers.DateTimeField(source='updated_at')

    class Meta:
        model = Truck
        fields = ['id', 'name', 'carrier', 'siteId', 'status', 'dockId', 'position', 'rotationY', 'updatedAt']


class ForkliftSerializer(PlacedSerializer):
    operator = serializers.SerializerMethodField()
    batteryPct = serializers.IntegerField(source='battery_pct')
    shipmentId = serializers.UUIDField(source='shipment_id', allow_null=True)
    updatedAt = serializers.DateTimeField(source='updated_at')

    class Meta:
        model = Forklift
        fields = [
            'id', 'name', 'siteId', 'operator', 'status', 'batteryPct', 'shipmentId',
            'position', 'rotationY', 'updatedAt',
        ]  # fmt: skip

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_operator(self, forklift: Forklift) -> str | None:
        return forklift.operator or None


class InventoryItemSerializer(serializers.ModelSerializer):
    siteId = serializers.UUIDField(source='site_id')
    rackId = serializers.UUIDField(source='rack_id')
    reorderPoint = serializers.IntegerField(source='reorder_point')
    updatedAt = serializers.DateTimeField(source='updated_at')

    class Meta:
        model = InventoryItem
        fields = [
            'id', 'sku', 'name', 'category', 'siteId', 'rackId', 'level',
            'quantity', 'unit', 'reorderPoint', 'updatedAt',
        ]  # fmt: skip


class ShipmentLineSerializer(serializers.Serializer):
    itemId = serializers.UUIDField(source='item_id')
    quantity = serializers.IntegerField()


class ShipmentSerializer(serializers.ModelSerializer):
    siteId = serializers.UUIDField(source='site_id')
    truckId = serializers.UUIDField(source='truck_id', allow_null=True)
    dockId = serializers.UUIDField(source='dock_id', allow_null=True)
    promisedAt = serializers.DateTimeField(source='promised_at')
    completedAt = serializers.DateTimeField(source='completed_at', allow_null=True)
    lines = ShipmentLineSerializer(many=True)
    updatedAt = serializers.DateTimeField(source='updated_at')

    class Meta:
        model = Shipment
        fields = [
            'id', 'reference', 'siteId', 'direction', 'status', 'counterparty', 'truckId', 'dockId',
            'promisedAt', 'eta', 'completedAt', 'progress', 'lines', 'updatedAt',
        ]  # fmt: skip


class SnapshotSerializer(serializers.Serializer):
    """Everything the operations view needs, in one response (WarehouseData)."""

    sites = SiteSerializer(many=True)
    docks = DockSerializer(many=True)
    racks = RackSerializer(many=True)
    trucks = TruckSerializer(many=True)
    forklifts = ForkliftSerializer(many=True)
    inventory = InventoryItemSerializer(many=True)
    shipments = ShipmentSerializer(many=True)


class SiteKpisSerializer(serializers.Serializer):
    onTimeRate = serializers.FloatField(allow_null=True)
    completed = serializers.IntegerField()
    docksInUse = serializers.IntegerField()
    docksOperational = serializers.IntegerField()
    activeTrucks = serializers.IntegerField()
    trucks = serializers.IntegerField()
    lowStock = serializers.IntegerField()
    items = serializers.IntegerField()
    delayed = serializers.IntegerField()

    def to_representation(self, instance: SiteKpis) -> dict:
        return dict(instance)
