import { describe, expect, it } from 'vitest';
import { createSeed } from '../data/index.ts';
import { NO_FILTERS, siteKpis, truckMatches } from './kpis.ts';

const data = createSeed(new Date('2026-10-10T14:00:00.000Z'));

describe('siteKpis', () => {
  it('computes the seed figures per site', () => {
    expect(siteKpis(data, 'site-oak')).toEqual({
      onTimeRate: 1,
      completed: 3,
      docksInUse: 2,
      docksOperational: 6,
      activeTrucks: 4,
      trucks: 5,
      lowStock: 4,
      items: 14,
      delayed: 2,
    });
    expect(siteKpis(data, 'site-dal')).toMatchObject({ onTimeRate: 2 / 3, docksInUse: 2, docksOperational: 5, activeTrucks: 3, trucks: 4, lowStock: 3, delayed: 0 });
    expect(siteKpis(data, 'site-mia')).toMatchObject({ onTimeRate: 1, docksInUse: 1, docksOperational: 5, activeTrucks: 3, trucks: 3, lowStock: 3, delayed: 1 });
  });

  it('reports no on-time rate before any completion', () => {
    const fresh = { ...data, shipments: data.shipments.filter((s) => s.status !== 'completed') };
    expect(siteKpis(fresh, 'site-oak').onTimeRate).toBeNull();
  });
});

describe('truckMatches', () => {
  const ids = (filters: Parameters<typeof truckMatches>[2]) =>
    data.trucks.filter((t) => t.siteId === 'site-oak' && truckMatches(data, t, filters)).map((t) => t.id);

  it('keeps every truck without filters', () => {
    expect(ids(NO_FILTERS)).toHaveLength(5);
  });

  it('filters by status', () => {
    expect(ids({ ...NO_FILTERS, status: 'unloading' })).toEqual(['truck-03']);
  });

  it('keeps only trucks carrying a delayed shipment', () => {
    expect(ids({ ...NO_FILTERS, delayedOnly: true })).toEqual(['truck-03', 'truck-04']);
  });

  it('combines filters', () => {
    expect(ids({ delayedOnly: true, status: 'in_transit' })).toEqual(['truck-04']);
    expect(ids({ delayedOnly: true, status: 'loading' })).toEqual([]);
  });
});
