import type { LivePatch } from '../api/contract.ts';
import { ApiError, apiPost } from '../api/http.ts';
import type { DockId, DockState, ForkliftId, ShipmentId, TruckId } from '../data/types.ts';
import { useWarehouse } from '../store/warehouseStore.ts';

/**
 * Operator actions. Each one posts to the API, which answers with the patch it also broadcasts:
 * applying it right away updates this screen without waiting for the live feed (merging is
 * idempotent, so receiving it again over the socket changes nothing).
 */

export type ActionResult = { ok: true } | { ok: false; message: string };

async function perform(path: string, body?: unknown): Promise<ActionResult> {
  const workspace = useWarehouse.getState().workspace;
  if (!workspace) return { ok: false, message: 'Not signed in to an organization.' };
  try {
    const patch = await apiPost<LivePatch>(`/orgs/${encodeURIComponent(workspace.slug)}${path}`, body);
    useWarehouse.getState().applyPatch(patch);
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError) return { ok: false, message: error.message };
    return { ok: false, message: 'The action could not reach the server. Check your connection, then retry.' };
  }
}

export const dockTruck = (truckId: TruckId, dockId: DockId) => perform(`/trucks/${truckId}/dock/`, { dockId });

export const assignForklift = (forkliftId: ForkliftId, shipmentId: ShipmentId | null) =>
  perform(`/forklifts/${forkliftId}/assign/`, { shipmentId });

export const chargeForklift = (forkliftId: ForkliftId) => perform(`/forklifts/${forkliftId}/charge/`);

export const setDockState = (dockId: DockId, state: DockState) => perform(`/docks/${dockId}/state/`, { state });
