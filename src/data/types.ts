/**
 * WareTrack data model.
 *
 * Conventions
 * - Distances are in metres. Y is up, so floor positions are { x, z }.
 * - Positions of docks, racks, trucks and forklifts are LOCAL to their site:
 *   world position = site.origin + local position.
 * - rotationY is in radians around the vertical axis. At 0 an object faces -Z,
 *   which is towards the yard (docks are on the building's -Z wall).
 * - Timestamps are ISO 8601 strings, so the data serialises as-is to and from an API.
 * - Relations are foreign keys held by the child (dock.siteId, shipment.truckId...).
 *   Every site-scoped entity carries siteId, the tenant scope for filtering.
 * - Derived facts (dock occupancy, delays, low stock, KPIs) are computed, never stored.
 */

export type SiteId = `site-${string}`;
export type DockId = `dock-${string}`;
export type RackId = `rack-${string}`;
export type TruckId = `truck-${string}`;
export type ForkliftId = `forklift-${string}`;
export type InventoryItemId = `item-${string}`;
export type ShipmentId = `shipment-${string}`;

export type ISODateString = string;

export interface FloorPoint {
  x: number;
  z: number;
}

/** Axis-aligned rectangle on the floor plane. */
export interface FloorRect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Where an object stands on its site's floor. */
export interface Placement {
  position: FloorPoint;
  rotationY: number;
}

export interface Site {
  id: SiteId;
  /** Short code shown in the UI, e.g. "OAK". */
  code: string;
  name: string;
  city: string;
  timezone: string;
  /** World position of the site's local (0, 0). Keeps sites apart in one shared scene. */
  origin: FloorPoint;
  /** Building footprint, centred on the local origin. */
  building: { width: number; depth: number };
  /** Local area covering building, yard and approach road. Used as camera limits. */
  bounds: FloorRect;
}

export type DockState = 'operational' | 'maintenance';

/** A loading dock door in the building's yard-side wall. */
export interface Dock extends Placement {
  id: DockId;
  siteId: SiteId;
  /** 1-based number painted on the door. */
  number: number;
  name: string;
  /** Whether the door can be used. Occupancy is derived from trucks, not stored here. */
  state: DockState;
}

/** A pallet rack. Inventory is stored on its levels. */
export interface Rack extends Placement {
  id: RackId;
  siteId: SiteId;
  /** Location code, e.g. "A-03". */
  code: string;
  zone: string;
  /** Number of storage levels; level 0 is the floor. */
  levels: number;
  /** length runs along local X before rotation. */
  size: { length: number; depth: number; height: number };
}

export type TruckStatus = 'in_transit' | 'waiting' | 'loading' | 'unloading' | 'idle';

export interface Truck extends Placement {
  id: TruckId;
  /** Fleet unit name, e.g. "YTE-789". */
  name: string;
  carrier: string;
  /** Site the truck is at, or heading to when in transit. */
  siteId: SiteId;
  status: TruckStatus;
  /** Dock the truck is backed into. Set only while loading or unloading. */
  dockId: DockId | null;
  updatedAt: ISODateString;
}

export type ForkliftStatus = 'idle' | 'moving' | 'lifting' | 'charging' | 'maintenance';

export interface Forklift extends Placement {
  id: ForkliftId;
  /** Unit name, e.g. "Unit 401". */
  name: string;
  siteId: SiteId;
  operator: string | null;
  status: ForkliftStatus;
  /** 0 to 100. */
  batteryPct: number;
  /** Shipment the forklift is currently handling at a dock. */
  shipmentId: ShipmentId | null;
  updatedAt: ISODateString;
}

export type InventoryCategory =
  | 'electronics'
  | 'home'
  | 'grocery'
  | 'apparel'
  | 'automotive'
  | 'pharma';

export type UnitOfMeasure = 'pallet' | 'case';

export interface InventoryItem {
  id: InventoryItemId;
  sku: string;
  name: string;
  category: InventoryCategory;
  siteId: SiteId;
  /** Storage location: a rack of the same site, and a level on it. */
  rackId: RackId;
  level: number;
  quantity: number;
  unit: UnitOfMeasure;
  /** Low stock when quantity <= reorderPoint. */
  reorderPoint: number;
  updatedAt: ISODateString;
}

export type ShipmentDirection = 'inbound' | 'outbound';

/**
 * Lifecycle: scheduled -> in_transit -> at_yard -> at_dock -> completed.
 * Mirrors the truck: in_transit/in_transit, waiting/at_yard,
 * unloading/inbound at_dock, loading/outbound at_dock.
 */
export type ShipmentStatus = 'scheduled' | 'in_transit' | 'at_yard' | 'at_dock' | 'completed';

export interface ShipmentLine {
  itemId: InventoryItemId;
  quantity: number;
}

export interface Shipment {
  id: ShipmentId;
  /** Human reference, e.g. "S-1045A". */
  reference: string;
  siteId: SiteId;
  direction: ShipmentDirection;
  status: ShipmentStatus;
  /** Supplier for inbound, customer for outbound. */
  counterparty: string;
  /** Assigned truck. Kept after completion as history. */
  truckId: TruckId | null;
  /** Assigned dock. Null until the shipment is slotted. */
  dockId: DockId | null;
  /** Committed arrival time at the site (the appointment). */
  promisedAt: ISODateString;
  /** Estimated arrival; becomes the actual arrival once the truck reaches the site. */
  eta: ISODateString;
  completedAt: ISODateString | null;
  /** Dock handling progress, 0 to 1. */
  progress: number;
  lines: ShipmentLine[];
  updatedAt: ISODateString;
}

/** The whole normalised dataset, one flat array per entity. */
export interface WarehouseData {
  sites: Site[];
  docks: Dock[];
  racks: Rack[];
  trucks: Truck[];
  forklifts: Forklift[];
  inventory: InventoryItem[];
  shipments: Shipment[];
}
