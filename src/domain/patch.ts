import type { LivePatch } from '../api/contract.ts';
import type { WarehouseData } from '../data/types.ts';

interface Versioned {
  id: string;
  updatedAt: string;
}

/**
 * Upserts rows by id. A row only replaces the current one if it is not older (by updatedAt):
 * patches can arrive twice (socket hand-over) or predate a snapshot fetched in the meantime.
 * Untouched rows, and the array itself when nothing changed, keep their identity.
 */
function upsert<T extends Versioned>(rows: T[], incoming: readonly T[], removed: ReadonlySet<string> = new Set()): T[] {
  if (incoming.length === 0 && removed.size === 0) return rows;
  const updates = new Map(incoming.map((row) => [row.id, row]));
  let changed = false;
  const next: T[] = [];
  for (const row of rows) {
    if (removed.has(row.id)) {
      changed = true;
      continue;
    }
    const update = updates.get(row.id);
    updates.delete(row.id);
    if (update && Date.parse(update.updatedAt) >= Date.parse(row.updatedAt) && update !== row) {
      next.push(update);
      changed = true;
    } else {
      next.push(row);
    }
  }
  for (const added of updates.values()) {
    if (!removed.has(added.id)) {
      next.push(added);
      changed = true;
    }
  }
  return changed ? next : rows;
}

/** Applies one live patch to the operation. Pure; unchanged collections keep their identity. */
export function applyPatch(data: WarehouseData, patch: LivePatch): WarehouseData {
  const trucks = upsert(data.trucks, patch.trucks);
  const forklifts = upsert(data.forklifts, patch.forklifts);
  const shipments = upsert(data.shipments, patch.shipments, new Set(patch.removedShipmentIds));
  const inventory = upsert(data.inventory, patch.inventory);
  const same = trucks === data.trucks && forklifts === data.forklifts && shipments === data.shipments && inventory === data.inventory;
  return same ? data : { ...data, trucks, forklifts, shipments, inventory };
}
