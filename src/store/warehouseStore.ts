import { useEffect } from 'react';
import { create } from 'zustand';
import { createSeed, type DockId, type ForkliftId, type RackId, type SiteId, type TruckId, type WarehouseData } from '../data/index.ts';
import { NO_FILTERS, type TruckFilters } from '../domain/kpis.ts';
import { simulateTick } from '../domain/simulation.ts';

export type Selection =
  | { kind: 'truck'; id: TruckId }
  | { kind: 'forklift'; id: ForkliftId }
  | { kind: 'dock'; id: DockId }
  | { kind: 'rack'; id: RackId };

interface WarehouseState {
  data: WarehouseData;
  /** Site in focus: KPIs, filters and camera follow it. */
  siteId: SiteId;
  selection: Selection | null;
  filters: TruckFilters;
  selectSite: (siteId: SiteId) => void;
  select: (selection: Selection) => void;
  clearSelection: () => void;
  setFilters: (patch: Partial<TruckFilters>) => void;
  /** Applies one simulation step. A WebSocket feed would replace this with patches. */
  tick: (now: Date) => void;
}

const seed = createSeed();

/**
 * Single source of truth for the views. Business rules live in `domain/`;
 * the store only wires them to state. Subscribe with narrow selectors.
 */
export const useWarehouse = create<WarehouseState>()((set) => ({
  data: seed,
  siteId: seed.sites[0]?.id ?? 'site-unknown',
  selection: null,
  filters: NO_FILTERS,
  selectSite: (siteId) => set({ siteId, selection: null }),
  select: (selection) => set({ selection }),
  clearSelection: () => set({ selection: null }),
  setFilters: (patch) => set((state) => ({ filters: { ...state.filters, ...patch } })),
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
