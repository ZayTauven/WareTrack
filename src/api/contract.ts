import type {
  Forklift,
  InventoryItem,
  Shipment,
  ShipmentId,
  Truck,
  WarehouseData,
} from '../data/types.ts';
import type { components } from './schema';

type Schemas = components['schemas'];

export type ApiSnapshot = Schemas['Snapshot'];
export type ApiSession = Schemas['Session'];
export type ApiMe = Schemas['Me'];
export type ApiSiteKpis = Schemas['SiteKpis'];

/**
 * One live update from /ws/v1/orgs/{org}/live/. WebSocket messages are outside OpenAPI, so this
 * mirrors backend/apps/warehouse/realtime.py:patch_payload by hand; rows reuse the REST shapes.
 */
export interface LivePatch {
  type: 'patch';
  at: string;
  trucks: Truck[];
  forklifts: Forklift[];
  shipments: Shipment[];
  inventory: InventoryItem[];
  removedShipmentIds: ShipmentId[];
}

// ---------------------------------------------------------------------------
// Compile-time contract: the API's payloads must fit the domain model the views are written
// against. If the backend changes a field, `npm run api:types` + `tsc` fail right here.
// ---------------------------------------------------------------------------

type Assignable<From, To> = [From] extends [To] ? true : never;

export const apiMatchesDomain: [
  Assignable<ApiSnapshot, WarehouseData>,
  Assignable<Schemas['Truck'], Truck>,
  Assignable<Schemas['Forklift'], Forklift>,
  Assignable<Schemas['Shipment'], Shipment>,
  Assignable<Schemas['InventoryItem'], InventoryItem>,
] = [true, true, true, true, true];
