import { describe, expect, it } from 'vitest';
import { createSeed } from '../data/index.ts';
import { findViolations } from './invariants.ts';
import { seededRandom } from './random.ts';
import { simulateTick } from './simulation.ts';

const NOW = new Date('2026-10-10T14:00:00.000Z');
const TICK_MS = 2_000;

describe('simulateTick', () => {
  it('starts from a seed that satisfies every invariant', () => {
    expect(findViolations(createSeed(NOW))).toEqual([]);
  });

  it('keeps every invariant over a long run', () => {
    const random = seededRandom('long-run');
    let data = createSeed(NOW);
    for (let tick = 1; tick <= 1_500; tick++) {
      data = simulateTick(data, new Date(NOW.getTime() + tick * TICK_MS), random);
      const violations = findViolations(data);
      if (violations.length) throw new Error(`tick ${tick}: ${violations.join('; ')}`);
    }
  });

  it('keeps state bounded with unique ids over a long run', () => {
    const random = seededRandom('bounded');
    let data = createSeed(NOW);
    for (let tick = 1; tick <= 3_000; tick++) data = simulateTick(data, new Date(NOW.getTime() + tick * TICK_MS), random);
    const ids = data.shipments.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const site of data.sites) {
      expect(data.shipments.filter((s) => s.siteId === site.id && s.status === 'completed').length).toBeLessThanOrEqual(30);
    }
    expect(data.shipments.length).toBeLessThan(150);
  });

  it('moves the operation forward', () => {
    const random = seededRandom('progress');
    const seed = createSeed(NOW);
    let data = seed;
    for (let tick = 1; tick <= 200; tick++) data = simulateTick(data, new Date(NOW.getTime() + tick * TICK_MS), random);

    const completed = (d: typeof seed) => d.shipments.filter((s) => s.status === 'completed').length;
    expect(completed(data)).toBeGreaterThan(completed(seed));
    expect(data.trucks.some((t, i) => t.status !== seed.trucks[i]?.status)).toBe(true);
    expect(data.forklifts.some((f, i) => f.status !== seed.forklifts[i]?.status)).toBe(true);
    expect(data.shipments.filter((s) => s.status === 'scheduled').length).toBeGreaterThan(0);
  });

  it('is deterministic for a given random sequence', () => {
    const run = () => {
      const random = seededRandom('determinism');
      let data = createSeed(NOW);
      for (let tick = 1; tick <= 100; tick++) data = simulateTick(data, new Date(NOW.getTime() + tick * TICK_MS), random);
      return data;
    };
    expect(run()).toEqual(run());
  });

  it('keeps untouched entities and collections by reference', () => {
    const seed = createSeed(NOW);
    const next = simulateTick(seed, new Date(NOW.getTime() + TICK_MS), () => 0.999);
    expect(next.docks).toBe(seed.docks);
    expect(next.racks).toBe(seed.racks);
    const idle = seed.trucks.find((t) => t.status === 'idle');
    expect(next.trucks.find((t) => t.id === idle?.id)).toBe(idle);
    const docked = seed.trucks.find((t) => t.status === 'unloading');
    expect(next.trucks.find((t) => t.id === docked?.id)).not.toBe(docked);
  });
});
