"""
Site KPIs, computed in the database. Same definitions as the front end's src/domain/kpis.ts:

- on-time rate: completed shipments that arrived by their promised time / completed shipments
- docks in use: operational docks with a truck backed in / operational docks
- active trucks: trucks not parked idle / trucks
- low stock: items with quantity <= reorder point
- delayed: active shipments whose (estimated or actual) arrival is after the promise
"""

from typing import TypedDict

from django.db.models import Count, F, Q

from .models import Dock, InventoryItem, Shipment, Site, Truck


class SiteKpis(TypedDict):
    onTimeRate: float | None
    completed: int
    docksInUse: int
    docksOperational: int
    activeTrucks: int
    trucks: int
    lowStock: int
    items: int
    delayed: int


def site_kpis(site: Site) -> SiteKpis:
    shipments = Shipment.objects.filter(site=site).aggregate(
        completed=Count('id', filter=Q(status=Shipment.Status.COMPLETED)),
        on_time=Count('id', filter=Q(status=Shipment.Status.COMPLETED, eta__lte=F('promised_at'))),
        delayed=Count('id', filter=Q(status__in=Shipment.ACTIVE, eta__gt=F('promised_at'))),
    )
    trucks = Truck.objects.filter(site=site).aggregate(
        total=Count('id'),
        active=Count('id', filter=~Q(status=Truck.Status.IDLE)),
        docked=Count('id', filter=Q(dock__state=Dock.State.OPERATIONAL)),
    )
    items = InventoryItem.objects.filter(site=site).aggregate(
        total=Count('id'),
        low=Count('id', filter=Q(quantity__lte=F('reorder_point'))),
    )
    completed = shipments['completed']
    return {
        'onTimeRate': shipments['on_time'] / completed if completed else None,
        'completed': completed,
        # one truck per dock is a database constraint, so docked trucks == docks in use
        'docksInUse': trucks['docked'],
        'docksOperational': Dock.objects.filter(site=site, state=Dock.State.OPERATIONAL).count(),
        'activeTrucks': trucks['active'],
        'trucks': trucks['total'],
        'lowStock': items['low'],
        'items': items['total'],
        'delayed': shipments['delayed'],
    }
