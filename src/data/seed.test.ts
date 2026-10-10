import { describe, expect, it } from 'vitest';
import { createSeed } from './seed.ts';
import type { FloorPoint, ShipmentStatus, Site, TruckStatus } from './types.ts';

const NOW = new Date('2026-10-10T14:00:00.000Z');
const data = createSeed(NOW);

const byId = <T extends { id: string }>(rows: T[]) => new Map(rows.map((row) => [row.id, row]));
const sites = byId(data.sites);
const docks = byId(data.docks);
const racks = byId(data.racks);
const trucks = byId(data.trucks);
const items = byId(data.inventory);
const shipments = byId(data.shipments);

const ACTIVE: ShipmentStatus[] = ['in_transit', 'at_yard', 'at_dock'];

const inBounds = (site: Site, p: FloorPoint) =>
  p.x >= site.bounds.minX && p.x <= site.bounds.maxX && p.z >= site.bounds.minZ && p.z <= site.bounds.maxZ;

const inBuilding = (site: Site, p: FloorPoint) =>
  Math.abs(p.x) <= site.building.width / 2 && Math.abs(p.z) <= site.building.depth / 2;

describe('seed data', () => {
  it('has the requested volumes', () => {
    expect(data.sites).toHaveLength(3);
    expect(data.docks).toHaveLength(18);
    expect(data.trucks).toHaveLength(12);
    expect(data.forklifts).toHaveLength(8);
    expect(data.inventory).toHaveLength(40);
    expect(data.shipments).toHaveLength(25);
    for (const site of data.sites) {
      expect(data.docks.filter((d) => d.siteId === site.id)).toHaveLength(6);
    }
  });

  it('uses unique ids, SKUs and references', () => {
    const all = Object.values(data).flat().map((row) => row.id);
    expect(new Set(all).size).toBe(all.length);
    expect(new Set(data.inventory.map((i) => i.sku)).size).toBe(data.inventory.length);
    expect(new Set(data.shipments.map((s) => s.reference)).size).toBe(data.shipments.length);
  });

  it('is deterministic for a given time', () => {
    expect(createSeed(NOW)).toEqual(data);
  });

  it('resolves every foreign key within the same site', () => {
    for (const row of [...data.docks, ...data.racks, ...data.trucks, ...data.forklifts, ...data.inventory, ...data.shipments]) {
      expect(sites.has(row.siteId), row.id).toBe(true);
    }
    for (const truck of data.trucks) {
      if (truck.dockId) expect(docks.get(truck.dockId)?.siteId, truck.id).toBe(truck.siteId);
    }
    for (const item of data.inventory) {
      const rack = racks.get(item.rackId);
      expect(rack?.siteId, item.id).toBe(item.siteId);
      expect(item.level).toBeLessThan(rack?.levels ?? 0);
    }
    for (const shipment of data.shipments) {
      if (shipment.dockId) expect(docks.get(shipment.dockId)?.siteId, shipment.id).toBe(shipment.siteId);
      if (shipment.truckId) expect(trucks.has(shipment.truckId), shipment.id).toBe(true);
      for (const line of shipment.lines) {
        expect(items.get(line.itemId)?.siteId, shipment.id).toBe(shipment.siteId);
        expect(line.quantity).toBeGreaterThan(0);
      }
    }
    for (const forklift of data.forklifts) {
      if (!forklift.shipmentId) continue;
      const shipment = shipments.get(forklift.shipmentId);
      expect(shipment?.siteId, forklift.id).toBe(forklift.siteId);
      expect(shipment?.status, forklift.id).toBe('at_dock');
    }
  });

  it('keeps truck and shipment states consistent', () => {
    const expected: Record<TruckStatus, (s: ShipmentStatus, direction: string) => boolean> = {
      in_transit: (s) => s === 'in_transit',
      waiting: (s) => s === 'at_yard',
      loading: (s, d) => s === 'at_dock' && d === 'outbound',
      unloading: (s, d) => s === 'at_dock' && d === 'inbound',
      idle: () => false,
    };
    for (const truck of data.trucks) {
      const active = data.shipments.filter((s) => s.truckId === truck.id && ACTIVE.includes(s.status));
      expect(active.length, truck.id).toBe(truck.status === 'idle' ? 0 : 1);
      const [shipment] = active;
      if (shipment) {
        expect(expected[truck.status](shipment.status, shipment.direction), truck.id).toBe(true);
        expect(shipment.siteId, truck.id).toBe(truck.siteId);
      }
      const atDock = truck.status === 'loading' || truck.status === 'unloading';
      expect(truck.dockId !== null, truck.id).toBe(atDock);
      if (atDock) expect(shipment?.dockId, truck.id).toBe(truck.dockId);
    }
  });

  it('never puts two trucks on one dock, nor any on a dock in maintenance', () => {
    const used = data.trucks.flatMap((t) => (t.dockId ? [t.dockId] : []));
    expect(new Set(used).size).toBe(used.length);
    for (const id of used) expect(docks.get(id)?.state).toBe('operational');
    for (const s of data.shipments.filter((s) => s.status !== 'completed' && s.dockId)) {
      expect(docks.get(s.dockId!)?.state, s.id).toBe('operational');
    }
  });

  it('keeps shipment times coherent', () => {
    for (const s of data.shipments) {
      const completed = s.status === 'completed';
      expect(s.completedAt !== null, s.id).toBe(completed);
      expect(s.progress).toBeGreaterThanOrEqual(0);
      expect(s.progress).toBeLessThanOrEqual(1);
      if (completed) expect(s.progress).toBe(1);
      if (s.status === 'scheduled') expect(s.truckId, s.id).toBeNull();
      if (s.status === 'at_yard' || s.status === 'at_dock' || completed) {
        expect(Date.parse(s.eta), `${s.id} arrived, eta is the actual arrival`).toBeLessThanOrEqual(NOW.getTime());
      }
      if (s.completedAt) expect(Date.parse(s.completedAt)).toBeGreaterThan(Date.parse(s.eta));
    }
  });

  it('places every object inside its site', () => {
    for (const row of [...data.docks, ...data.trucks]) {
      expect(inBounds(sites.get(row.siteId)!, row.position), row.id).toBe(true);
    }
    for (const row of [...data.racks, ...data.forklifts, ...data.docks]) {
      expect(inBuilding(sites.get(row.siteId)!, row.position), row.id).toBe(true);
    }
  });
});
