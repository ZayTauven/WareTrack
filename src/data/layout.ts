import type { FloorPoint, Placement } from './types.ts';

/**
 * Site-local floor plan shared by every site: where docks, racks and the
 * yard sit, and where trucks and forklifts stand in each situation.
 */

export const DOCK_COUNT = 6;
export const DOCK_SPACING = 9;
/** Distance from the dock door to the centre of a docked truck. */
export const DOCKED_TRUCK_OFFSET = 6;

export const YARD_WAITING_Z = -38;
export const YARD_PARKING_Z = -48;
export const ROAD_Z = -58;
/** Lane behind the dock doors where forklifts stage pallets. */
export const STAGING_Z = -14;
/** Aisle in front of the first rack row, where forklifts pick. */
export const PICKING_Z = -8;
export const PICKING_X_RANGE = 26;

export const RACK_COLUMNS_X = [-21, -7, 7, 21];
export const RACK_ROWS_Z = [-6, 3, 12];

export const CHARGER: FloorPoint = { x: 28, z: 17 };

/** rotationY values. At 0 an object faces -Z, towards the yard. */
export const FACING = {
  yard: 0,
  building: Math.PI,
  east: -Math.PI / 2,
} as const;

/** Truck slots per yard row and on the approach road. */
export const SLOT_COUNT = 5;

export const dockX = (dockNumber: number) => -((DOCK_COUNT - 1) * DOCK_SPACING) / 2 + (dockNumber - 1) * DOCK_SPACING;

export const yardSlot = (slot: number): Placement => ({ position: { x: -24 + slot * 12, z: YARD_WAITING_Z }, rotationY: FACING.building });
export const parkingSlot = (slot: number): Placement => ({ position: { x: 24 - slot * 12, z: YARD_PARKING_Z }, rotationY: FACING.building });
export const roadSlot = (slot: number): Placement => ({ position: { x: -30 + slot * 15, z: ROAD_Z }, rotationY: FACING.east });

export const dockedTruck = (dockPosition: FloorPoint): Placement => ({
  position: { x: dockPosition.x, z: dockPosition.z - DOCKED_TRUCK_OFFSET },
  rotationY: FACING.yard,
});

export const stagingPoint = (dockPosition: FloorPoint): FloorPoint => ({ x: dockPosition.x + 2, z: STAGING_Z });
