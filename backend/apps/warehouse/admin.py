from django.contrib import admin

from .models import Dock, Forklift, InventoryItem, Rack, Shipment, ShipmentLine, Site, Truck


@admin.register(Site)
class SiteAdmin(admin.ModelAdmin):
    list_display = ['code', 'name', 'city', 'organization']
    list_filter = ['organization']
    search_fields = ['code', 'name', 'city']


@admin.register(Dock)
class DockAdmin(admin.ModelAdmin):
    list_display = ['name', 'site', 'state']
    list_filter = ['site', 'state']


@admin.register(Rack)
class RackAdmin(admin.ModelAdmin):
    list_display = ['code', 'site', 'zone', 'levels']
    list_filter = ['site', 'zone']


@admin.register(Truck)
class TruckAdmin(admin.ModelAdmin):
    list_display = ['name', 'carrier', 'site', 'status', 'dock', 'updated_at']
    list_filter = ['site', 'status', 'carrier']
    search_fields = ['name', 'carrier']
    list_select_related = ['site', 'dock']


@admin.register(Forklift)
class ForkliftAdmin(admin.ModelAdmin):
    list_display = ['name', 'site', 'status', 'operator', 'battery_pct', 'shipment']
    list_filter = ['site', 'status']
    list_select_related = ['site', 'shipment']


@admin.register(InventoryItem)
class InventoryItemAdmin(admin.ModelAdmin):
    list_display = ['sku', 'name', 'site', 'rack', 'level', 'quantity', 'reorder_point']
    list_filter = ['site', 'category']
    search_fields = ['sku', 'name']
    list_select_related = ['site', 'rack']


class ShipmentLineInline(admin.TabularInline):
    model = ShipmentLine
    extra = 0
    raw_id_fields = ['item']


@admin.register(Shipment)
class ShipmentAdmin(admin.ModelAdmin):
    list_display = ['reference', 'site', 'direction', 'status', 'truck', 'dock', 'promised_at', 'eta']
    list_filter = ['site', 'status', 'direction']
    search_fields = ['reference', 'counterparty']
    list_select_related = ['site', 'truck', 'dock']
    inlines = [ShipmentLineInline]
