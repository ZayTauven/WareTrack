import type {
  Dock,
  DockId,
  Forklift,
  InventoryItem,
  RackId,
  Shipment,
  ShipmentId,
  ShipmentStatus,
  Truck,
  TruckId,
  WarehouseData,
} from '../data/index.ts';

/** A shipment is active from departure until its dock work is completed. */
const ACTIVE_SHIPMENT_STATUSES: readonly ShipmentStatus[] = ['in_transit', 'at_yard', 'at_dock'];

export const isActive = (shipment: Shipment) => ACTIVE_SHIPMENT_STATUSES.includes(shipment.status);

export const isLowStock = (item: InventoryItem) => item.quantity <= item.reorderPoint;

export const byId = <T extends { id: string }>(rows: readonly T[], id: string): T | undefined => rows.find((row) => row.id === id);

export const activeShipmentOfTruck = (data: WarehouseData, truckId: TruckId): Shipment | undefined =>
  data.shipments.find((s) => s.truckId === truckId && isActive(s));

export const truckAtDock = (data: WarehouseData, dockId: DockId): Truck | undefined => data.trucks.find((t) => t.dockId === dockId);

export const forkliftsOnShipment = (data: WarehouseData, shipmentId: ShipmentId): Forklift[] =>
  data.forklifts.filter((f) => f.shipmentId === shipmentId);

export const itemsInRack = (data: WarehouseData, rackId: RackId): InventoryItem[] =>
  data.inventory.filter((item) => item.rackId === rackId).sort((a, b) => b.level - a.level);

export type DockOccupancy = 'free' | 'occupied' | 'maintenance';

export function dockOccupancy(data: WarehouseData, dock: Dock): DockOccupancy {
  if (dock.state === 'maintenance') return 'maintenance';
  return truckAtDock(data, dock.id) ? 'occupied' : 'free';
}

/** Minutes between promised and (estimated or actual) arrival; positive means late. */
export const arrivalDelayMinutes = (shipment: Shipment) =>
  Math.round((Date.parse(shipment.eta) - Date.parse(shipment.promisedAt)) / 60_000);
