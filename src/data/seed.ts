import type {
  Dock,
  DockId,
  FloorPoint,
  FloorRect,
  Forklift,
  ForkliftId,
  ForkliftStatus,
  InventoryCategory,
  InventoryItem,
  InventoryItemId,
  Rack,
  Shipment,
  ShipmentDirection,
  ShipmentStatus,
  Site,
  SiteId,
  Truck,
  TruckId,
  TruckStatus,
  UnitOfMeasure,
  WarehouseData,
} from './types.ts';
import {
  CHARGER,
  DOCK_COUNT,
  FACING,
  RACK_COLUMNS_X,
  RACK_ROWS_Z,
  dockX,
  dockedTruck,
  parkingSlot,
  roadSlot,
  stagingPoint,
  yardSlot,
} from './layout.ts';

// ---------------------------------------------------------------------------
// Site template. Every site uses the same building; values are site-local.
// ---------------------------------------------------------------------------

const BUILDING = { width: 60, depth: 40 };
const SITE_BOUNDS: FloorRect = { minX: -40, maxX: 40, minZ: -64, maxZ: 26 };
const SITE_SPACING = 150;
const DOCK_WALL_Z = -BUILDING.depth / 2;

const RACK_SIZE = { length: 10, depth: 1.2, height: 4.5 };
const RACK_LEVELS = 4;

const staging = (dockNumber: number): FloorPoint => stagingPoint({ x: dockX(dockNumber), z: DOCK_WALL_Z });

// ---------------------------------------------------------------------------
// Definitions. Times are minute offsets from `now`, so the data stays live.
// ---------------------------------------------------------------------------

type SiteKey = 'oak' | 'dal' | 'mia';

const SITE_DEFS: { key: SiteKey; code: string; name: string; city: string; timezone: string; maintenanceDocks: number[] }[] = [
  { key: 'oak', code: 'OAK', name: 'Oakland Main DC', city: 'Oakland, CA', timezone: 'America/Los_Angeles', maintenanceDocks: [] },
  { key: 'dal', code: 'DAL', name: 'Dallas Regional Hub', city: 'Dallas, TX', timezone: 'America/Chicago', maintenanceDocks: [6] },
  { key: 'mia', code: 'MIA', name: 'Miami Coastal Port', city: 'Miami, FL', timezone: 'America/New_York', maintenanceDocks: [3] },
];

/** `slot` spreads trucks that share the yard or the road. */
const TRUCK_DEFS: { id: TruckId; name: string; carrier: string; site: SiteKey; status: TruckStatus; dock?: number; slot?: number }[] = [
  { id: 'truck-01', name: 'YTE-789', carrier: 'Yellow Trans Express', site: 'oak', status: 'loading', dock: 2 },
  { id: 'truck-02', name: 'YTE-992', carrier: 'Yellow Trans Express', site: 'oak', status: 'waiting', slot: 0 },
  { id: 'truck-03', name: 'LGX-8847', carrier: 'Logistix Inc.', site: 'oak', status: 'unloading', dock: 4 },
  { id: 'truck-04', name: 'YTE-501', carrier: 'Yellow Trans Express', site: 'oak', status: 'in_transit', slot: 0 },
  { id: 'truck-05', name: 'PCF-310', carrier: 'Pacific Freightways', site: 'oak', status: 'idle', slot: 0 },
  { id: 'truck-06', name: 'LSF-221', carrier: 'Lone Star Freight', site: 'dal', status: 'unloading', dock: 1 },
  { id: 'truck-07', name: 'LSF-245', carrier: 'Lone Star Freight', site: 'dal', status: 'loading', dock: 3 },
  { id: 'truck-08', name: 'LGX-9012', carrier: 'Logistix Inc.', site: 'dal', status: 'in_transit', slot: 0 },
  { id: 'truck-09', name: 'TXR-118', carrier: 'Texas Roadline', site: 'dal', status: 'idle', slot: 0 },
  { id: 'truck-10', name: 'CBX-402', carrier: 'Coastal Box Lines', site: 'mia', status: 'unloading', dock: 5 },
  { id: 'truck-11', name: 'SUN-077', carrier: 'Suncoast Haulage', site: 'mia', status: 'waiting', slot: 0 },
  { id: 'truck-12', name: 'CBX-415', carrier: 'Coastal Box Lines', site: 'mia', status: 'in_transit', slot: 0 },
];

const FORKLIFT_DEFS: {
  id: ForkliftId;
  name: string;
  site: SiteKey;
  operator: string | null;
  status: ForkliftStatus;
  batteryPct: number;
  shipment: string | null;
  position: FloorPoint;
  rotationY: number;
}[] = [
  { id: 'forklift-401', name: 'Unit 401', site: 'oak', operator: 'Maria G.', status: 'idle', batteryPct: 65, shipment: null, position: { x: -28, z: -1.5 }, rotationY: FACING.east },
  { id: 'forklift-402', name: 'Unit 402', site: 'oak', operator: 'Jamal R.', status: 'moving', batteryPct: 82, shipment: 'EXP-993-C', position: staging(4), rotationY: FACING.yard },
  { id: 'forklift-403', name: 'Unit 403', site: 'oak', operator: 'Kenji T.', status: 'lifting', batteryPct: 47, shipment: 'S-1045A', position: staging(2), rotationY: FACING.yard },
  { id: 'forklift-404', name: 'Unit 404', site: 'dal', operator: 'Luis M.', status: 'moving', batteryPct: 71, shipment: 'D-2201', position: staging(1), rotationY: FACING.yard },
  { id: 'forklift-405', name: 'Unit 405', site: 'dal', operator: null, status: 'charging', batteryPct: 18, shipment: null, position: CHARGER, rotationY: FACING.building },
  { id: 'forklift-406', name: 'Unit 406', site: 'dal', operator: 'Aisha B.', status: 'lifting', batteryPct: 56, shipment: 'D-2202', position: staging(3), rotationY: FACING.yard },
  { id: 'forklift-407', name: 'Unit 407', site: 'mia', operator: 'Carlos D.', status: 'moving', batteryPct: 90, shipment: 'M-3301', position: staging(5), rotationY: FACING.yard },
  { id: 'forklift-408', name: 'Unit 408', site: 'mia', operator: null, status: 'maintenance', batteryPct: 40, shipment: null, position: CHARGER, rotationY: FACING.building },
];

type ItemDef = [sku: string, name: string, category: InventoryCategory, unit: UnitOfMeasure, quantity: number, reorderPoint: number];

const INVENTORY_DEFS: Record<SiteKey, ItemDef[]> = {
  oak: [
    ['ELX-1001', 'Wireless earbuds (case of 24)', 'electronics', 'case', 180, 60],
    ['ELX-1002', 'USB-C chargers 65W', 'electronics', 'case', 42, 50],
    ['ELX-1003', '27" monitors', 'electronics', 'pallet', 12, 6],
    ['ELX-1004', 'Mechanical keyboards', 'electronics', 'case', 95, 40],
    ['HOM-2001', 'Cordless vacuum cleaners', 'home', 'pallet', 8, 10],
    ['HOM-2002', 'Ceramic dinnerware sets', 'home', 'case', 140, 50],
    ['HOM-2003', 'LED desk lamps', 'home', 'case', 66, 30],
    ['GRO-3001', 'Arabica coffee beans 1kg', 'grocery', 'case', 210, 80],
    ['GRO-3002', 'Sparkling water 12-pack', 'grocery', 'pallet', 14, 20],
    ['GRO-3003', 'Organic oat milk 1L', 'grocery', 'case', 320, 120],
    ['APP-4001', 'Rain jackets (assorted)', 'apparel', 'case', 75, 25],
    ['APP-4002', 'Running shoes (assorted)', 'apparel', 'case', 22, 30],
    ['AUT-5001', 'Synthetic motor oil 5L', 'automotive', 'case', 130, 40],
    ['AUT-5002', 'Wiper blades', 'automotive', 'case', 88, 35],
  ],
  dal: [
    ['ELX-1005', 'Smart thermostats', 'electronics', 'case', 54, 20],
    ['ELX-1006', 'Gaming laptops', 'electronics', 'pallet', 5, 6],
    ['ELX-1007', 'HDMI cables 2m', 'electronics', 'case', 400, 100],
    ['HOM-2004', 'Memory foam mattresses', 'home', 'pallet', 18, 8],
    ['HOM-2005', 'Cast iron skillets', 'home', 'case', 72, 30],
    ['GRO-3004', 'Tortilla chips 24-pack', 'grocery', 'pallet', 26, 12],
    ['GRO-3005', 'BBQ sauce 500ml', 'grocery', 'case', 38, 60],
    ['APP-4003', 'Work boots (assorted)', 'apparel', 'case', 64, 25],
    ['APP-4004', 'Denim jeans (assorted)', 'apparel', 'case', 150, 50],
    ['AUT-5003', 'Truck tires 22.5"', 'automotive', 'pallet', 9, 4],
    ['AUT-5004', 'Car batteries 12V', 'automotive', 'pallet', 3, 5],
    ['PHA-6001', 'First aid kits', 'pharma', 'case', 110, 40],
    ['PHA-6002', 'Hand sanitizer 500ml', 'pharma', 'case', 260, 100],
  ],
  mia: [
    ['ELX-1008', 'Action cameras', 'electronics', 'case', 47, 20],
    ['ELX-1009', 'Bluetooth speakers', 'electronics', 'case', 18, 25],
    ['HOM-2006', 'Outdoor patio chairs', 'home', 'pallet', 21, 10],
    ['HOM-2007', 'Beach umbrellas', 'home', 'case', 85, 30],
    ['GRO-3006', 'Coconut water 12-pack', 'grocery', 'pallet', 30, 15],
    ['GRO-3007', 'Cuban coffee 250g', 'grocery', 'case', 190, 70],
    ['GRO-3008', 'Fresh mangoes (crate)', 'grocery', 'pallet', 6, 12],
    ['APP-4005', 'Swimwear (assorted)', 'apparel', 'case', 120, 40],
    ['APP-4006', 'Sunglasses (assorted)', 'apparel', 'case', 58, 20],
    ['AUT-5005', 'Marine engine oil 4L', 'automotive', 'case', 70, 25],
    ['PHA-6003', 'Sunscreen SPF 50', 'pharma', 'case', 45, 60],
    ['PHA-6004', 'Insect repellent', 'pharma', 'case', 140, 50],
    ['PHA-6005', 'Electrolyte tablets', 'pharma', 'case', 95, 30],
  ],
};

/** Offsets are minutes from `now`. `lines` are [sku, quantity]. */
interface ShipmentDef {
  reference: string;
  site: SiteKey;
  direction: ShipmentDirection;
  status: ShipmentStatus;
  counterparty: string;
  truck: TruckId | null;
  dock: number | null;
  promised: number;
  eta: number;
  completed: number | null;
  progress: number;
  lines: [sku: string, quantity: number][];
}

const SHIPMENT_DEFS: ShipmentDef[] = [
  // Oakland
  { reference: 'S-1045A', site: 'oak', direction: 'outbound', status: 'at_dock', counterparty: 'Bay Area Retail Co.', truck: 'truck-01', dock: 2, promised: -40, eta: -42, completed: null, progress: 0.4, lines: [['ELX-1001', 40], ['ELX-1004', 20]] },
  { reference: 'S-1046A', site: 'oak', direction: 'inbound', status: 'at_yard', counterparty: 'Shenzhen Audio Ltd.', truck: 'truck-02', dock: 1, promised: 10, eta: -6, completed: null, progress: 0, lines: [['ELX-1002', 60]] },
  { reference: 'EXP-993-C', site: 'oak', direction: 'inbound', status: 'at_dock', counterparty: 'Nordic Home Supply', truck: 'truck-03', dock: 4, promised: -35, eta: -20, completed: null, progress: 0.75, lines: [['ELX-1003', 8], ['HOM-2001', 4]] },
  { reference: 'S-1047A', site: 'oak', direction: 'inbound', status: 'in_transit', counterparty: 'Central Valley Foods', truck: 'truck-04', dock: null, promised: 90, eta: 105, completed: null, progress: 0, lines: [['GRO-3002', 20], ['GRO-3003', 80]] },
  { reference: 'S-1048A', site: 'oak', direction: 'outbound', status: 'scheduled', counterparty: 'Oakland Sports Outlet', truck: null, dock: null, promised: 240, eta: 240, completed: null, progress: 0, lines: [['APP-4002', 10]] },
  { reference: 'S-1049A', site: 'oak', direction: 'inbound', status: 'scheduled', counterparty: 'Pacific Apparel Group', truck: null, dock: null, promised: 300, eta: 300, completed: null, progress: 0, lines: [['APP-4001', 30]] },
  { reference: 'S-1050A', site: 'oak', direction: 'outbound', status: 'scheduled', counterparty: 'Sacramento Grocers', truck: null, dock: null, promised: 420, eta: 420, completed: null, progress: 0, lines: [['GRO-3001', 40]] },
  { reference: 'S-1036A', site: 'oak', direction: 'outbound', status: 'completed', counterparty: 'Berkeley Home Store', truck: 'truck-01', dock: 5, promised: -480, eta: -485, completed: -430, progress: 1, lines: [['HOM-2002', 30]] },
  { reference: 'S-1037A', site: 'oak', direction: 'inbound', status: 'completed', counterparty: 'Andes Coffee Traders', truck: 'truck-02', dock: 6, promised: -360, eta: -365, completed: -320, progress: 1, lines: [['GRO-3001', 60]] },
  { reference: 'S-1038A', site: 'oak', direction: 'inbound', status: 'completed', counterparty: 'Valvoline West', truck: 'truck-05', dock: 3, promised: -300, eta: -310, completed: -250, progress: 1, lines: [['AUT-5001', 40]] },
  // Dallas
  { reference: 'D-2201', site: 'dal', direction: 'inbound', status: 'at_dock', counterparty: 'Gulf Coast Electronics', truck: 'truck-06', dock: 1, promised: -15, eta: -18, completed: null, progress: 0.55, lines: [['ELX-1006', 6], ['ELX-1007', 120]] },
  { reference: 'D-2202', site: 'dal', direction: 'outbound', status: 'at_dock', counterparty: 'Austin Home & Garden', truck: 'truck-07', dock: 3, promised: -40, eta: -45, completed: null, progress: 0.3, lines: [['HOM-2004', 6], ['HOM-2005', 24]] },
  { reference: 'D-2203', site: 'dal', direction: 'inbound', status: 'in_transit', counterparty: 'Monterrey Auto Parts', truck: 'truck-08', dock: null, promised: 60, eta: 60, completed: null, progress: 0, lines: [['AUT-5004', 12], ['AUT-5003', 4]] },
  { reference: 'D-2204', site: 'dal', direction: 'outbound', status: 'scheduled', counterparty: 'Houston Pharmacy Network', truck: null, dock: null, promised: 180, eta: 180, completed: null, progress: 0, lines: [['PHA-6001', 30], ['PHA-6002', 60]] },
  { reference: 'D-2205', site: 'dal', direction: 'inbound', status: 'scheduled', counterparty: 'Lubbock Foods', truck: null, dock: null, promised: 360, eta: 360, completed: null, progress: 0, lines: [['GRO-3005', 80]] },
  { reference: 'D-2198', site: 'dal', direction: 'inbound', status: 'completed', counterparty: 'El Paso Snacks', truck: 'truck-09', dock: 2, promised: -420, eta: -400, completed: -350, progress: 1, lines: [['GRO-3004', 12]] },
  { reference: 'D-2199', site: 'dal', direction: 'outbound', status: 'completed', counterparty: 'Fort Worth Outfitters', truck: 'truck-06', dock: 4, promised: -540, eta: -545, completed: -500, progress: 1, lines: [['APP-4004', 50]] },
  { reference: 'D-2200', site: 'dal', direction: 'outbound', status: 'completed', counterparty: 'Plano Workwear', truck: 'truck-07', dock: 5, promised: -240, eta: -250, completed: -200, progress: 1, lines: [['APP-4003', 20]] },
  // Miami
  { reference: 'M-3301', site: 'mia', direction: 'inbound', status: 'at_dock', counterparty: 'Caribbean Fresh Imports', truck: 'truck-10', dock: 5, promised: -25, eta: -30, completed: null, progress: 0.65, lines: [['GRO-3008', 20], ['GRO-3006', 10]] },
  { reference: 'M-3302', site: 'mia', direction: 'outbound', status: 'at_yard', counterparty: 'Keys Resort Supply', truck: 'truck-11', dock: 1, promised: 15, eta: -5, completed: null, progress: 0, lines: [['APP-4005', 40], ['PHA-6003', 20]] },
  { reference: 'M-3303', site: 'mia', direction: 'inbound', status: 'in_transit', counterparty: 'Port Everglades Terminal', truck: 'truck-12', dock: null, promised: 40, eta: 75, completed: null, progress: 0, lines: [['ELX-1009', 30]] },
  { reference: 'M-3304', site: 'mia', direction: 'outbound', status: 'scheduled', counterparty: 'Orlando Theme Retail', truck: null, dock: null, promised: 200, eta: 200, completed: null, progress: 0, lines: [['HOM-2007', 25]] },
  { reference: 'M-3298', site: 'mia', direction: 'inbound', status: 'completed', counterparty: 'Havana Roasters', truck: 'truck-10', dock: 2, promised: -600, eta: -605, completed: -540, progress: 1, lines: [['GRO-3007', 60]] },
  { reference: 'M-3299', site: 'mia', direction: 'outbound', status: 'completed', counterparty: 'South Beach Optics', truck: 'truck-12', dock: 4, promised: -360, eta: -370, completed: -330, progress: 1, lines: [['APP-4006', 15]] },
  { reference: 'M-3300', site: 'mia', direction: 'inbound', status: 'completed', counterparty: 'Everglades Outdoor Co.', truck: 'truck-11', dock: 6, promised: -180, eta: -185, completed: -140, progress: 1, lines: [['PHA-6004', 50]] },
];

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

const siteId = (key: SiteKey): SiteId => `site-${key}`;
const dockId = (key: SiteKey, dockNumber: number): DockId => `dock-${key}-${dockNumber}`;
const shipmentId = (reference: string) => `shipment-${reference.toLowerCase()}` as const;

function truckPlacement(def: (typeof TRUCK_DEFS)[number]) {
  const slot = def.slot ?? 0;
  switch (def.status) {
    case 'loading':
    case 'unloading':
      return dockedTruck({ x: dockX(def.dock ?? 1), z: DOCK_WALL_Z });
    case 'waiting':
      return yardSlot(slot);
    case 'idle':
      return parkingSlot(slot);
    case 'in_transit':
      return roadSlot(slot);
  }
}

/**
 * Builds the demo dataset. Deterministic for a given `now`; all times are
 * relative to it so ETAs and delays look current whenever the app starts.
 */
export function createSeed(now: Date = new Date()): WarehouseData {
  const at = (minutes: number) => new Date(now.getTime() + minutes * 60_000).toISOString();

  const sites: Site[] = SITE_DEFS.map((def, i) => ({
    id: siteId(def.key),
    code: def.code,
    name: def.name,
    city: def.city,
    timezone: def.timezone,
    origin: { x: i * SITE_SPACING, z: 0 },
    building: { ...BUILDING },
    bounds: { ...SITE_BOUNDS },
  }));

  const docks: Dock[] = SITE_DEFS.flatMap((def) =>
    Array.from({ length: DOCK_COUNT }, (_, i) => {
      const number = i + 1;
      return {
        id: dockId(def.key, number),
        siteId: siteId(def.key),
        number,
        name: `Dock ${number}`,
        state: def.maintenanceDocks.includes(number) ? 'maintenance' : 'operational',
        position: { x: dockX(number), z: DOCK_WALL_Z },
        rotationY: FACING.yard,
        updatedAt: at(-720),
      } satisfies Dock;
    }),
  );

  const racks: Rack[] = SITE_DEFS.flatMap((def) =>
    RACK_COLUMNS_X.flatMap((x, column) =>
      RACK_ROWS_Z.map((z, row) => {
        const zone = x < 0 ? 'A' : 'B';
        const index = (column % 2) * RACK_ROWS_Z.length + row + 1;
        const code = `${zone}-${String(index).padStart(2, '0')}`;
        return {
          id: `rack-${def.key}-${code.toLowerCase()}`,
          siteId: siteId(def.key),
          code,
          zone,
          levels: RACK_LEVELS,
          size: { ...RACK_SIZE },
          position: { x, z },
          rotationY: 0,
        } satisfies Rack;
      }),
    ),
  );

  const trucks: Truck[] = TRUCK_DEFS.map((def, i) => ({
    id: def.id,
    name: def.name,
    carrier: def.carrier,
    siteId: siteId(def.site),
    status: def.status,
    dockId: def.dock === undefined ? null : dockId(def.site, def.dock),
    ...truckPlacement(def),
    updatedAt: at(-(i % 4)),
  }));

  let itemCounter = 0;
  const inventory: InventoryItem[] = SITE_DEFS.flatMap((def) => {
    const siteRacks = racks.filter((rack) => rack.siteId === siteId(def.key));
    return INVENTORY_DEFS[def.key].map(([sku, name, category, unit, quantity, reorderPoint], j) => {
      itemCounter += 1;
      const rack = siteRacks[j % siteRacks.length];
      if (!rack) throw new Error(`Seed: no rack for ${sku}`);
      return {
        id: `item-${String(itemCounter).padStart(3, '0')}`,
        sku,
        name,
        category,
        siteId: siteId(def.key),
        rackId: rack.id,
        level: (j + Math.floor(j / siteRacks.length)) % RACK_LEVELS,
        quantity,
        unit,
        reorderPoint,
        updatedAt: at(-((itemCounter * 37) % 720)),
      } satisfies InventoryItem;
    });
  });

  const itemIdBySku = new Map<string, InventoryItemId>(inventory.map((item) => [item.sku, item.id]));

  const shipments: Shipment[] = SHIPMENT_DEFS.map((def) => ({
    id: shipmentId(def.reference),
    reference: def.reference,
    siteId: siteId(def.site),
    direction: def.direction,
    status: def.status,
    counterparty: def.counterparty,
    truckId: def.truck,
    dockId: def.dock === null ? null : dockId(def.site, def.dock),
    promisedAt: at(def.promised),
    eta: at(def.eta),
    completedAt: def.completed === null ? null : at(def.completed),
    progress: def.progress,
    lines: def.lines.map(([sku, quantity]) => {
      const itemId = itemIdBySku.get(sku);
      if (!itemId) throw new Error(`Seed: unknown SKU ${sku} in ${def.reference}`);
      return { itemId, quantity };
    }),
    updatedAt: def.completed === null ? at(-1) : at(def.completed),
  }));

  const forklifts: Forklift[] = FORKLIFT_DEFS.map((def, i) => ({
    id: def.id,
    name: def.name,
    siteId: siteId(def.site),
    operator: def.operator,
    status: def.status,
    batteryPct: def.batteryPct,
    shipmentId: def.shipment === null ? null : shipmentId(def.shipment),
    position: { ...def.position },
    rotationY: def.rotationY,
    updatedAt: at(-(i % 3)),
  }));

  return { sites, docks, racks, trucks, forklifts, inventory, shipments };
}
