import { create } from 'zustand';
import type { ApiMe, ApiSnapshot, LivePatch } from '../api/contract.ts';
import type { LiveStatus } from '../api/live.ts';
import type { DockId, ForkliftId, RackId, SiteId, TruckId, WarehouseData } from '../data/index.ts';
import { NO_FILTERS, type TruckFilters } from '../domain/kpis.ts';
import { applyPatch } from '../domain/patch.ts';

export type Selection =
  | { kind: 'truck'; id: TruckId }
  | { kind: 'forklift'; id: ForkliftId }
  | { kind: 'dock'; id: DockId }
  | { kind: 'rack'; id: RackId };

/** booting: restoring a session from the refresh cookie · loading: fetching the operation. */
export type AppStatus = 'booting' | 'signed-out' | 'loading' | 'ready' | 'failed';

export type Workspace = ApiMe['organizations'][number];

const EMPTY: WarehouseData = { sites: [], docks: [], racks: [], trucks: [], forklifts: [], inventory: [], shipments: [] };

interface WarehouseState {
  status: AppStatus;
  live: LiveStatus;
  user: ApiMe | null;
  workspace: Workspace | null;
  /** Why the app is signed out or failed, in words for the user. */
  notice: string | null;

  data: WarehouseData;
  /** Site in focus: KPIs, filters and camera follow it. */
  siteId: SiteId;
  selection: Selection | null;
  filters: TruckFilters;

  selectSite: (siteId: SiteId) => void;
  select: (selection: Selection) => void;
  clearSelection: () => void;
  setFilters: (patch: Partial<TruckFilters>) => void;

  /** Replaces the operation with a fresh snapshot (start, or resync after a drop). */
  loadSnapshot: (snapshot: ApiSnapshot) => void;
  /** Merges one live update. */
  applyPatch: (patch: LivePatch) => void;
  /** Back to an empty, signed-out (or failed) app. */
  reset: (status: 'signed-out' | 'failed', notice?: string | null) => void;
}

/**
 * Single source of truth for the views. Business rules live in `domain/`, the session and
 * network flow in `app/session.ts`; the store only holds state. Subscribe with narrow selectors.
 */
export const useWarehouse = create<WarehouseState>()((set) => ({
  status: 'booting',
  live: 'connecting',
  user: null,
  workspace: null,
  notice: null,

  data: EMPTY,
  siteId: '',
  selection: null,
  filters: NO_FILTERS,

  selectSite: (siteId) => set({ siteId, selection: null }),
  select: (selection) => set({ selection }),
  clearSelection: () => set({ selection: null }),
  setFilters: (patch) => set((state) => ({ filters: { ...state.filters, ...patch } })),

  loadSnapshot: (snapshot) =>
    set((state) => ({
      data: snapshot,
      // Keep the site in focus across resyncs; default to the first one.
      siteId: snapshot.sites.some((s) => s.id === state.siteId) ? state.siteId : (snapshot.sites[0]?.id ?? ''),
      status: 'ready',
      notice: null,
    })),
  applyPatch: (patch) => set((state) => ({ data: applyPatch(state.data, patch) })),
  reset: (status, notice = null) =>
    set({ status, notice, user: null, workspace: null, data: EMPTY, siteId: '', selection: null, filters: NO_FILTERS }),
}));

export const isSelected = (selection: Selection | null, target: Selection) =>
  selection?.kind === target.kind && selection.id === target.id;
