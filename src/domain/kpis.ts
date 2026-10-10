import type { Shipment, SiteId, Truck, TruckStatus, WarehouseData } from '../data/index.ts';
import { activeShipmentOfTruck, arrivalDelayMinutes, isActive, isLowStock } from './selectors.ts';

/** Late against its promise: arrived late, or expected to. */
const isDelayed = (shipment: Shipment) => isActive(shipment) && arrivalDelayMinutes(shipment) > 0;

export interface SiteKpis {
  /** Share of completed shipments that arrived by their promised time; null before any completion. */
  onTimeRate: number | null;
  completed: number;
  docksInUse: number;
  docksOperational: number;
  activeTrucks: number;
  trucks: number;
  lowStock: number;
  items: number;
  delayed: number;
}

export function siteKpis(data: WarehouseData, siteId: SiteId): SiteKpis {
  const shipments = data.shipments.filter((s) => s.siteId === siteId);
  const completed = shipments.filter((s) => s.status === 'completed');
  const onTime = completed.filter((s) => arrivalDelayMinutes(s) <= 0).length;
  const docks = data.docks.filter((d) => d.siteId === siteId && d.state === 'operational');
  const trucks = data.trucks.filter((t) => t.siteId === siteId);
  const items = data.inventory.filter((i) => i.siteId === siteId);
  return {
    onTimeRate: completed.length ? onTime / completed.length : null,
    completed: completed.length,
    docksInUse: docks.filter((d) => trucks.some((t) => t.dockId === d.id)).length,
    docksOperational: docks.length,
    activeTrucks: trucks.filter((t) => t.status !== 'idle').length,
    trucks: trucks.length,
    lowStock: items.filter(isLowStock).length,
    items: items.length,
    delayed: shipments.filter(isDelayed).length,
  };
}

export interface TruckFilters {
  /** Only trucks whose current shipment is delayed. */
  delayedOnly: boolean;
  status: TruckStatus | 'all';
}

export const NO_FILTERS: TruckFilters = { delayedOnly: false, status: 'all' };

export function truckMatches(data: WarehouseData, truck: Truck, filters: TruckFilters): boolean {
  if (filters.status !== 'all' && truck.status !== filters.status) return false;
  if (filters.delayedOnly) {
    const shipment = activeShipmentOfTruck(data, truck.id);
    if (!shipment || !isDelayed(shipment)) return false;
  }
  return true;
}
