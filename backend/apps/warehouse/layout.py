"""
Site-local floor plan shared by every site. Port of the front end's src/data/layout.ts;
the two must agree, since the scene places objects from these coordinates.
"""

import math
from dataclasses import dataclass


@dataclass(frozen=True)
class Placement:
    x: float
    z: float
    rotation_y: float


DOCK_COUNT = 6
DOCK_SPACING = 9
DOCKED_TRUCK_OFFSET = 6
YARD_WAITING_Z = -38
YARD_PARKING_Z = -48
ROAD_Z = -58
STAGING_Z = -14
PICKING_Z = -8
PICKING_X_RANGE = 26

RACK_COLUMNS_X = (-21, -7, 7, 21)
RACK_ROWS_Z = (-6, 3, 12)
RACK_SIZE = {'length': 10.0, 'depth': 1.2, 'height': 4.5}
RACK_LEVELS = 4

BUILDING = {'width': 60.0, 'depth': 40.0}
SITE_BOUNDS = {'min_x': -40.0, 'max_x': 40.0, 'min_z': -64.0, 'max_z': 26.0}
SITE_SPACING = 150
DOCK_WALL_Z = -BUILDING['depth'] / 2

CHARGER = (28.0, 17.0)
SLOT_COUNT = 5


class Facing:
    YARD = 0.0
    BUILDING = math.pi
    EAST = -math.pi / 2


def dock_x(number: int) -> float:
    return -((DOCK_COUNT - 1) * DOCK_SPACING) / 2 + (number - 1) * DOCK_SPACING


def yard_slot(slot: int) -> Placement:
    return Placement(-24 + slot * 12, YARD_WAITING_Z, Facing.BUILDING)


def parking_slot(slot: int) -> Placement:
    return Placement(24 - slot * 12, YARD_PARKING_Z, Facing.BUILDING)


def road_slot(slot: int) -> Placement:
    return Placement(-30 + slot * 15, ROAD_Z, Facing.EAST)


def docked_truck(dock_x_pos: float, dock_z_pos: float) -> Placement:
    return Placement(dock_x_pos, dock_z_pos - DOCKED_TRUCK_OFFSET, Facing.YARD)


def staging_point(dock_x_pos: float) -> tuple[float, float]:
    return dock_x_pos + 2, STAGING_Z
