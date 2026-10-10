import type { ShipmentStatus, TruckStatus, WarehouseData } from '../data/index.ts';
import { isActive } from './selectors.ts';

const SHIPMENT_FOR_TRUCK: Record<TruckStatus, (status: ShipmentStatus, direction: string) => boolean> = {
  in_transit: (s) => s === 'in_transit',
  waiting: (s) => s === 'at_yard',
  loading: (s, d) => s === 'at_dock' && d === 'outbound',
  unloading: (s, d) => s === 'at_dock' && d === 'inbound',
  idle: () => false,
};

/**
 * Rules the operational state must always satisfy, whoever mutates it
 * (seed, simulation, or later the API). Returns human-readable violations.
 */
export function findViolations(data: WarehouseData): string[] {
  const violations: string[] = [];
  const docks = new Map(data.docks.map((d) => [d.id, d]));
  const shipments = new Map(data.shipments.map((s) => [s.id, s]));

  for (const truck of data.trucks) {
    const active = data.shipments.filter((s) => s.truckId === truck.id && isActive(s));
    const expected = truck.status === 'idle' ? 0 : 1;
    if (active.length !== expected) violations.push(`${truck.id}: ${active.length} active shipments while ${truck.status}`);
    const [shipment] = active;
    if (shipment && !SHIPMENT_FOR_TRUCK[truck.status](shipment.status, shipment.direction)) {
      violations.push(`${truck.id}: ${truck.status} but ${shipment.id} is ${shipment.direction} ${shipment.status}`);
    }
    const atDock = truck.status === 'loading' || truck.status === 'unloading';
    if (atDock !== (truck.dockId !== null)) violations.push(`${truck.id}: dock ${truck.dockId} while ${truck.status}`);
    if (atDock && shipment && shipment.dockId !== truck.dockId) violations.push(`${truck.id}: at ${truck.dockId}, shipment at ${shipment.dockId}`);
    if (truck.dockId && docks.get(truck.dockId)?.state !== 'operational') violations.push(`${truck.id}: at unusable ${truck.dockId}`);
  }

  const usedDocks = data.trucks.flatMap((t) => (t.dockId ? [t.dockId] : []));
  if (new Set(usedDocks).size !== usedDocks.length) violations.push('two trucks share a dock');

  for (const forklift of data.forklifts) {
    if (!forklift.shipmentId) continue;
    const shipment = shipments.get(forklift.shipmentId);
    if (shipment?.status !== 'at_dock') violations.push(`${forklift.id}: on ${forklift.shipmentId} which is ${shipment?.status ?? 'missing'}`);
    if (shipment && shipment.siteId !== forklift.siteId) violations.push(`${forklift.id}: on a shipment of another site`);
  }

  for (const shipment of data.shipments) {
    if ((shipment.status === 'completed') !== (shipment.completedAt !== null)) violations.push(`${shipment.id}: completedAt mismatch`);
    if (shipment.progress < 0 || shipment.progress > 1) violations.push(`${shipment.id}: progress ${shipment.progress}`);
  }

  for (const item of data.inventory) {
    if (item.quantity < 0) violations.push(`${item.id}: negative stock`);
  }

  return violations;
}
