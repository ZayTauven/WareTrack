import { useEffect } from 'react';
import { create } from 'zustand';
import { createSeed, type DockId, type ForkliftId, type RackId, type TruckId, type WarehouseData } from '../data/index.ts';
import { simulateTick } from '../domain/simulation.ts';

export type Selection =
  | { kind: 'truck'; id: TruckId }
  | { kind: 'forklift'; id: ForkliftId }
  | { kind: 'dock'; id: DockId }
  | { kind: 'rack'; id: RackId };

interface WarehouseState {
  data: WarehouseData;
  selection: Selection | null;
  select: (selection: Selection) => void;
  clearSelection: () => void;
  /** Applies one simulation step. A WebSocket feed would replace this with patches. */
  tick: (now: Date) => void;
}

/**
 * Single source of truth for the views. Business rules live in `domain/`;
 * the store only wires them to state. Subscribe with narrow selectors.
 */
export const useWarehouse = create<WarehouseState>()((set) => ({
  data: createSeed(),
  selection: null,
  select: (selection) => set({ selection }),
  clearSelection: () => set({ selection: null }),
  tick: (now) => set((state) => ({ data: simulateTick(state.data, now, Math.random) })),
}));

export const isSelected = (selection: Selection | null, target: Selection) =>
  selection?.kind === target.kind && selection.id === target.id;

/** Drives the simulated live feed. */
export function useSimulation(intervalMs = 2_000) {
  const tick = useWarehouse((s) => s.tick);
  useEffect(() => {
    const handle = window.setInterval(() => tick(new Date()), intervalMs);
    return () => window.clearInterval(handle);
  }, [tick, intervalMs]);
}
