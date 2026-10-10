import type {
  Dock,
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

/** 409 body: a business rule refused an action. */
export type ApiActionRejected = Schemas['ActionRejected'];

export type ApiMember = Schemas['Member'];
export type ApiInvitation = Schemas['Invitation'];
export type ApiInvitationCreated = Schemas['InvitationCreated'];
export type ApiInvitationPreview = Schemas['InvitationPreview'];

/**
 * One change to the operation: pushed on /ws/v1/orgs/{org}/live/ and returned by every action.
 * Written against the domain types; the contract below proves the API's `Patch` fits it.
 */
export interface LivePatch {
  type: 'patch';
  at: string;
  docks: Dock[];
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
  Assignable<Schemas['Patch'], LivePatch>,
  Assignable<Schemas['Truck'], Truck>,
  Assignable<Schemas['Forklift'], Forklift>,
  Assignable<Schemas['Shipment'], Shipment>,
  Assignable<Schemas['InventoryItem'], InventoryItem>,
] = [true, true, true, true, true, true];
