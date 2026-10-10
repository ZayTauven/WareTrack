import { Grid } from '@react-three/drei';
import { useEffect, useMemo } from 'react';
import type { Dock, Site } from '../data/index.ts';
import { ROAD_Z } from '../data/layout.ts';
import { DOCK_OPENING } from './models.tsx';
import { bakedMaterial, buildModel, type Part } from './modelGeometry.ts';
import { palette } from './palette.ts';

const WALL = 0.6;
const WALL_HEIGHT = 6;
const CURB_HEIGHT = 1;
const STRIPE_HEIGHT = 1.2;
const LINE = 0.15;
const BAY_LINE_LENGTH = 12;
const ROAD_WIDTH = 8;
const STAGING_DEPTH = 10.5;

/** Spans [from, to] minus the given openings, as [start, end] pairs. */
function wallSegments(from: number, to: number, openings: number[], width: number): [number, number][] {
  const segments: [number, number][] = [];
  let cursor = from;
  for (const centre of [...openings].sort((a, b) => a - b)) {
    if (centre - width / 2 > cursor) segments.push([cursor, centre - width / 2]);
    cursor = centre + width / 2;
  }
  if (cursor < to) segments.push([cursor, to]);
  return segments;
}

/**
 * Building shell, floor and yard for one site, in site-local space.
 * Walls facing the camera (yard side and +X) are cut down to curbs, diorama style,
 * so the floor stays readable from the isometric view.
 */
interface GroundParts {
  /** Floor, markings, yard and road: receive shadows only. */
  flat: Part[];
  /** Walls and curbs: cast and receive shadows. */
  walls: Part[];
}

function groundParts(site: Site, docks: Dock[]): GroundParts {
  const { width, depth } = site.building;
  const { bounds } = site;
  const halfW = width / 2;
  const halfD = depth / 2;
  const yardDepth = -halfD - WALL - bounds.minZ;
  const yardCentreZ = (bounds.minZ - halfD - WALL) / 2;
  const boundsWidth = bounds.maxX - bounds.minX;
  const boundsCentreX = (bounds.minX + bounds.maxX) / 2;

  const flat: Part[] = [
    // Slab and floor
    { at: [0, -0.31, 0], size: [width + 2 * WALL, 0.58, depth + 2 * WALL], color: palette.slab },
    { at: [0, -0.01, 0], size: [width, 0.02, depth], color: palette.floor },
    // Floor markings: staging lane behind the docks
    { at: [0, 0.008, -halfD + STAGING_DEPTH], size: [width - 2, 0.01, LINE], color: palette.amber },
    { at: [-halfW + 1, 0.008, -halfD + STAGING_DEPTH / 2], size: [LINE, 0.01, STAGING_DEPTH], color: palette.amber },
    { at: [halfW - 1, 0.008, -halfD + STAGING_DEPTH / 2], size: [LINE, 0.01, STAGING_DEPTH], color: palette.amber },
    // Amber safety band along the back walls
    { at: [0, STRIPE_HEIGHT / 2, halfD - 0.02], size: [width, STRIPE_HEIGHT, 0.04], color: palette.amber },
    { at: [-halfW + 0.02, STRIPE_HEIGHT / 2, 0], size: [0.04, STRIPE_HEIGHT, depth], color: palette.amber },
    // Yard, truck bays and approach road
    { at: [boundsCentreX, -0.06, yardCentreZ], size: [boundsWidth, 0.1, yardDepth], color: palette.asphalt },
    ...docks.flatMap((dock) =>
      [-1.9, 1.9].map((offset): Part => ({
        at: [dock.position.x + offset, -0.005, -halfD - WALL - BAY_LINE_LENGTH / 2],
        size: [LINE, 0.01, BAY_LINE_LENGTH],
        color: palette.amber,
      })),
    ),
    { at: [boundsCentreX, -0.005, ROAD_Z], size: [boundsWidth, 0.01, ROAD_WIDTH], color: palette.road },
    { at: [boundsCentreX, 0.001, ROAD_Z], size: [boundsWidth, 0.01, LINE], color: palette.roadLine },
  ];

  const walls: Part[] = [
    // Back walls (+Z, -X) at full height
    { at: [0, WALL_HEIGHT / 2, halfD + WALL / 2], size: [width + 2 * WALL, WALL_HEIGHT, WALL], color: palette.wall },
    { at: [-halfW - WALL / 2, WALL_HEIGHT / 2, 0], size: [WALL, WALL_HEIGHT, depth], color: palette.wall },
    // Front walls cut down to curbs; the yard-side curb leaves room for the dock doors
    { at: [halfW + WALL / 2, CURB_HEIGHT / 2, 0], size: [WALL, CURB_HEIGHT, depth + 2 * WALL], color: palette.wall },
    ...wallSegments(-halfW - WALL, halfW + WALL, docks.map((d) => d.position.x), DOCK_OPENING).map(
      ([start, end]): Part => ({
        at: [(start + end) / 2, CURB_HEIGHT / 2, -halfD - WALL / 2],
        size: [end - start, CURB_HEIGHT, WALL],
        color: palette.wall,
      }),
    ),
  ];

  return { flat, walls };
}

/**
 * Building shell, floor and yard for one site, in site-local space, baked into
 * two draw calls plus the grid. Walls facing the camera (yard side and +X) are
 * cut down to curbs, diorama style, so the floor stays readable.
 */
export function SiteGround({ site, docks }: { site: Site; docks: Dock[] }) {
  const geometry = useMemo(() => {
    const parts = groundParts(site, docks);
    return { flat: buildModel(parts.flat), walls: buildModel(parts.walls) };
  }, [site, docks]);

  useEffect(
    () => () => {
      geometry.flat.dispose();
      geometry.walls.dispose();
    },
    [geometry],
  );

  return (
    <group>
      <mesh geometry={geometry.flat} material={bakedMaterial} receiveShadow />
      <mesh geometry={geometry.walls} material={bakedMaterial} castShadow receiveShadow />
      <Grid
        position={[0, 0.006, 0]}
        args={[site.building.width, site.building.depth]}
        cellSize={2}
        cellThickness={0.6}
        cellColor={palette.gridCell}
        sectionSize={10}
        sectionThickness={1}
        sectionColor={palette.gridSection}
        fadeDistance={10_000}
        fadeStrength={0}
      />
    </group>
  );
}