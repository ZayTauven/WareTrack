import type {
  DockId,
  FloorPoint,
  Forklift,
  InventoryItem,
  Placement,
  Shipment,
  ShipmentId,
  Site,
  SiteId,
  Truck,
  TruckStatus,
  WarehouseData,
} from '../data/index.ts';
import {
  CHARGER,
  FACING,
  PICKING_X_RANGE,
  PICKING_Z,
  SLOT_COUNT,
  dockedTruck,
  parkingSlot,
  roadSlot,
  stagingPoint,
  yardSlot,
} from '../data/layout.ts';
import type { Random } from './random.ts';
import { isActive } from './selectors.ts';

const MINUTE = 60_000;

/** Per-tick odds and rates; a tick is one simulation step (2 s in the app). */
const RATES = {
  arrive: 0.25,
  etaSlip: 0.05,
  etaSlipMinutes: 5,
  dock: 0.35,
  handling: { base: 0.04, spread: 0.08, withoutForklift: 0.35 },
  dispatch: 0.12,
  /** Estimated drive time given to a dispatched truck, in minutes (min, max). */
  travelMinutes: [2, 15],
  forkliftStep: 0.6,
  /** Battery points gained per tick on the charger, and odds of losing one per working tick. */
  charge: 3,
  drain: 0.3,
  battery: { critical: 15, recharge: 25, full: 95 },
  minScheduledPerSite: 2,
  /** New work is promised close to now (some already overdue) so delays stay meaningful. */
  newShipmentLeadMinutes: [-10, 20],
} as const;

const samePoint = (a: FloorPoint, b: FloorPoint) => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.z - b.z) < 1e-6;

const heading = (from: FloorPoint, to: FloorPoint, fallback: number) =>
  samePoint(from, to) ? fallback : Math.atan2(-(to.x - from.x), -(to.z - from.z));

const between = (random: Random, [min, max]: readonly [number, number]) => min + random() * (max - min);

const plusMinutes = (iso: string | Date, minutes: number) =>
  new Date((typeof iso === 'string' ? Date.parse(iso) : iso.getTime()) + minutes * MINUTE).toISOString();

/** Keeps the original array when no row changed, so subscribers can skip work. */
function rebuild<T extends { id: string }>(original: T[], rows: Map<string, T>): T[] {
  const unchanged = rows.size === original.length && original.every((row) => rows.get(row.id) === row);
  return unchanged ? original : [...rows.values()];
}

/**
 * Advances the operation by one step. Pure: same input, same random sequence,
 * same output. Untouched entities keep their identity.
 *
 * Trucks:    idle -> in_transit -> waiting (yard) -> loading|unloading (dock) -> idle
 * Forklifts: work the at-dock shipments of their site, shuttling between the
 *            staging lane and the racks, and recharge when the battery runs low.
 */
export function simulateTick(data: WarehouseData, now: Date, random: Random): WarehouseData {
  const stamp = now.toISOString();
  const trucks = new Map<string, Truck>(data.trucks.map((t) => [t.id, t]));
  const shipments = new Map<string, Shipment>(data.shipments.map((s) => [s.id, s]));
  const forklifts = new Map<string, Forklift>(data.forklifts.map((f) => [f.id, f]));
  const inventory = new Map<string, InventoryItem>(data.inventory.map((i) => [i.id, i]));
  const docks = new Map(data.docks.map((d) => [d.id, d]));

  const patchTruck = (truck: Truck, patch: Partial<Truck>) => trucks.set(truck.id, { ...truck, ...patch, updatedAt: stamp });
  const patchShipment = (shipment: Shipment, patch: Partial<Shipment>) =>
    shipments.set(shipment.id, { ...shipment, ...patch, updatedAt: stamp });
  const patchForklift = (forklift: Forklift, patch: Partial<Forklift>) =>
    forklifts.set(forklift.id, { ...forklift, ...patch, updatedAt: stamp });

  const activeShipmentOf = (truck: Truck) => [...shipments.values()].find((s) => s.truckId === truck.id && isActive(s));

  const freeSlot = (siteId: SiteId, status: TruckStatus, slotAt: (slot: number) => Placement) => {
    for (let slot = 0; slot < SLOT_COUNT; slot++) {
      const placement = slotAt(slot);
      const taken = [...trucks.values()].some(
        (t) => t.siteId === siteId && t.status === status && samePoint(t.position, placement.position),
      );
      if (!taken) return placement;
    }
    return undefined;
  };

  const isDockFree = (dockId: DockId) =>
    docks.get(dockId)?.state === 'operational' && ![...trucks.values()].some((t) => t.dockId === dockId);

  const hasForklift = (shipmentId: ShipmentId) => [...forklifts.values()].some((f) => f.shipmentId === shipmentId);

  const applyStockMovement = (shipment: Shipment) => {
    const sign = shipment.direction === 'inbound' ? 1 : -1;
    for (const line of shipment.lines) {
      const item = inventory.get(line.itemId);
      if (item) inventory.set(item.id, { ...item, quantity: Math.max(0, item.quantity + sign * line.quantity), updatedAt: stamp });
    }
  };

  // Trucks
  for (const { id } of data.trucks) {
    const truck = trucks.get(id);
    if (!truck) continue;
    const shipment = activeShipmentOf(truck);

    switch (truck.status) {
      case 'in_transit': {
        if (!shipment) break;
        if (random() < RATES.arrive) {
          const slot = freeSlot(truck.siteId, 'waiting', yardSlot);
          if (!slot) break;
          patchShipment(shipment, { status: 'at_yard', eta: stamp });
          patchTruck(truck, { status: 'waiting', ...slot });
        } else if (random() < RATES.etaSlip) {
          patchShipment(shipment, { eta: plusMinutes(shipment.eta, RATES.etaSlipMinutes) });
          patchTruck(truck, {});
        }
        break;
      }
      case 'waiting': {
        if (!shipment || random() >= RATES.dock) break;
        const preferred = shipment.dockId && isDockFree(shipment.dockId) ? docks.get(shipment.dockId) : undefined;
        const dock = preferred ?? data.docks.find((d) => d.siteId === truck.siteId && isDockFree(d.id));
        if (!dock) break;
        patchShipment(shipment, { status: 'at_dock', dockId: dock.id });
        patchTruck(truck, {
          status: shipment.direction === 'inbound' ? 'unloading' : 'loading',
          dockId: dock.id,
          ...dockedTruck(dock.position),
        });
        break;
      }
      case 'loading':
      case 'unloading': {
        if (!shipment) break;
        const { base, spread, withoutForklift } = RATES.handling;
        const pace = hasForklift(shipment.id) ? 1 : withoutForklift;
        const progress = Math.min(1, shipment.progress + (base + random() * spread) * pace);
        if (progress < 1) {
          patchShipment(shipment, { progress });
          patchTruck(truck, {});
          break;
        }
        patchShipment(shipment, { status: 'completed', progress: 1, completedAt: stamp });
        applyStockMovement(shipment);
        patchTruck(truck, { status: 'idle', dockId: null, ...(freeSlot(truck.siteId, 'idle', parkingSlot) ?? parkingSlot(0)) });
        break;
      }
      case 'idle': {
        if (random() >= RATES.dispatch) break;
        const [next] = [...shipments.values()]
          .filter((s) => s.siteId === truck.siteId && s.status === 'scheduled' && s.truckId === null)
          .sort((a, b) => Date.parse(a.promisedAt) - Date.parse(b.promisedAt));
        const slot = freeSlot(truck.siteId, 'in_transit', roadSlot);
        if (!next || !slot) break;
        patchShipment(next, {
          status: 'in_transit',
          truckId: truck.id,
          eta: plusMinutes(now, Math.round(between(random, RATES.travelMinutes))),
        });
        patchTruck(truck, { status: 'in_transit', ...slot });
        break;
      }
    }
  }

  // Forklifts
  const pickingPoint = (): FloorPoint => ({ x: Math.round((random() * 2 - 1) * PICKING_X_RANGE), z: PICKING_Z });
  const moveTo = (forklift: Forklift, target: FloorPoint): Partial<Forklift> => ({
    position: { ...target },
    rotationY: heading(forklift.position, target, forklift.rotationY),
  });
  const toCharger = (): Partial<Forklift> => ({
    status: 'charging',
    shipmentId: null,
    position: { ...CHARGER },
    rotationY: FACING.building,
  });

  for (const { id } of data.forklifts) {
    const forklift = forklifts.get(id);
    if (!forklift || forklift.status === 'maintenance') continue;

    if (forklift.status === 'charging') {
      const batteryPct = Math.min(100, forklift.batteryPct + RATES.charge);
      patchForklift(forklift, batteryPct >= RATES.battery.full ? { batteryPct, status: 'idle' } : { batteryPct });
      continue;
    }

    const shipment = forklift.shipmentId ? shipments.get(forklift.shipmentId) : undefined;
    const dock = shipment?.dockId ? docks.get(shipment.dockId) : undefined;

    if (shipment?.status === 'at_dock' && dock) {
      const batteryPct = Math.max(0, forklift.batteryPct - (random() < RATES.drain ? 1 : 0));
      if (batteryPct < RATES.battery.critical) {
        patchForklift(forklift, { batteryPct, ...toCharger() });
        continue;
      }
      if (random() >= RATES.forkliftStep) {
        patchForklift(forklift, { batteryPct });
        continue;
      }
      // moving to staging -> moving to a rack -> lifting at the rack -> back to staging
      const staging = stagingPoint(dock.position);
      if (forklift.status === 'lifting') {
        patchForklift(forklift, { batteryPct, status: 'moving', ...moveTo(forklift, staging) });
      } else if (forklift.status === 'moving' && !samePoint(forklift.position, staging)) {
        patchForklift(forklift, { batteryPct, status: 'lifting' });
      } else {
        patchForklift(forklift, { batteryPct, status: 'moving', ...moveTo(forklift, pickingPoint()) });
      }
      continue;
    }

    // No dock work: release, recharge, or pick up a shipment that has no forklift yet.
    if (forklift.batteryPct < RATES.battery.recharge) {
      patchForklift(forklift, toCharger());
      continue;
    }
    const job = forklift.operator
      ? data.docks
          .filter((d) => d.siteId === forklift.siteId)
          .map((d) => [...shipments.values()].find((s) => s.dockId === d.id && s.status === 'at_dock'))
          .find((s): s is Shipment => s !== undefined && !hasForklift(s.id))
      : undefined;
    const jobDock = job?.dockId ? docks.get(job.dockId) : undefined;
    if (job && jobDock) {
      patchForklift(forklift, { status: 'moving', shipmentId: job.id, ...moveTo(forklift, stagingPoint(jobDock.position)) });
    } else if (forklift.shipmentId !== null || forklift.status !== 'idle') {
      patchForklift(forklift, { status: 'idle', shipmentId: null });
    }
  }

  // Keep a short queue of scheduled work per site so the demo never runs dry.
  for (const site of data.sites) {
    const scheduled = [...shipments.values()].filter((s) => s.siteId === site.id && s.status === 'scheduled').length;
    if (scheduled >= RATES.minScheduledPerSite) continue;
    const template = pick(data.shipments.filter((s) => s.siteId === site.id), random);
    if (template) {
      const created = newShipment(site, template, shipments.size + 1, now, random);
      shipments.set(created.id, created);
    }
  }

  return {
    ...data,
    trucks: rebuild(data.trucks, trucks),
    shipments: rebuild(data.shipments, shipments),
    forklifts: rebuild(data.forklifts, forklifts),
    inventory: rebuild(data.inventory, inventory),
  };
}

function pick<T>(rows: T[], random: Random): T | undefined {
  return rows[Math.floor(random() * rows.length)];
}

function newShipment(site: Site, template: Shipment, sequence: number, now: Date, random: Random): Shipment {
  const promisedAt = plusMinutes(now, Math.round(between(random, RATES.newShipmentLeadMinutes)));
  return {
    id: `shipment-sim-${sequence}`,
    reference: `${site.code}-${5000 + sequence}`,
    siteId: site.id,
    direction: template.direction,
    status: 'scheduled',
    counterparty: template.counterparty,
    truckId: null,
    dockId: null,
    promisedAt,
    eta: promisedAt,
    completedAt: null,
    progress: 0,
    lines: template.lines.map((line) => ({ ...line })),
    updatedAt: now.toISOString(),
  };
}
