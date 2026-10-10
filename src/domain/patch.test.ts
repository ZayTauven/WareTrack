import { describe, expect, it } from 'vitest';
import type { LivePatch } from '../api/contract.ts';
import { createSeed } from '../data/index.ts';
import { applyPatch } from './patch.ts';

const NOW = new Date('2026-10-10T14:00:00.000Z');
const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString();

const patch = (overrides: Partial<LivePatch>): LivePatch => ({
  type: 'patch',
  at: later(1),
  docks: [],
  trucks: [],
  forklifts: [],
  shipments: [],
  inventory: [],
  removedShipmentIds: [],
  ...overrides,
});

describe('applyPatch', () => {
  const data = createSeed(NOW);
  const truck = data.trucks[0]!;

  it('replaces changed rows and keeps everything else by reference', () => {
    const moved = { ...truck, status: 'idle' as const, dockId: null, updatedAt: later(1) };
    const next = applyPatch(data, patch({ trucks: [moved] }));

    expect(next.trucks[0]).toBe(moved);
    expect(next.trucks.slice(1)).toEqual(data.trucks.slice(1));
    next.trucks.slice(1).forEach((row, i) => expect(row).toBe(data.trucks[i + 1]));
    expect(next.forklifts).toBe(data.forklifts);
    expect(next.docks).toBe(data.docks);
  });

  it('ignores rows older than what is already there', () => {
    const stale = { ...truck, status: 'idle' as const, updatedAt: later(-60) };
    expect(applyPatch(data, patch({ trucks: [stale] }))).toBe(data);
  });

  it('is idempotent, so a patch delivered twice changes nothing more', () => {
    const moved = { ...truck, status: 'idle' as const, dockId: null, updatedAt: later(1) };
    const once = applyPatch(data, patch({ trucks: [moved] }));
    expect(applyPatch(once, patch({ trucks: [moved] }))).toBe(once);
  });

  it('adds new shipments and drops removed ones', () => {
    const template = data.shipments[0]!;
    const created = { ...template, id: 'shipment-new', reference: 'OAK-5001', updatedAt: later(1) };
    const removed = data.shipments.find((s) => s.status === 'completed')!;
    const next = applyPatch(data, patch({ shipments: [created], removedShipmentIds: [removed.id] }));

    expect(next.shipments).toContain(created);
    expect(next.shipments.find((s) => s.id === removed.id)).toBeUndefined();
    expect(next.shipments).toHaveLength(data.shipments.length);
  });

  it('returns the same object for an empty patch', () => {
    expect(applyPatch(data, patch({}))).toBe(data);
  });
});
