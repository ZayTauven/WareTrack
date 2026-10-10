import { Grid } from '@react-three/drei';
import type { Dock, Site } from '../data/index.ts';
import { Block, DOCK_OPENING } from './models.tsx';
import { palette } from './palette.ts';
import { materials } from './resources.ts';

const WALL = 0.6;
const WALL_HEIGHT = 6;
const CURB_HEIGHT = 1;
const STRIPE_HEIGHT = 1.2;
const LINE = 0.15;
const BAY_LINE_LENGTH = 12;
const ROAD_Z = -58;
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
export function SiteGround({ site, docks }: { site: Site; docks: Dock[] }) {
  const { width, depth } = site.building;
  const { bounds } = site;
  const halfW = width / 2;
  const halfD = depth / 2;
  const yardDepth = -halfD - WALL - bounds.minZ;
  const yardCentreZ = (bounds.minZ - halfD - WALL) / 2;
  const boundsWidth = bounds.maxX - bounds.minX;
  const boundsCentreX = (bounds.minX + bounds.maxX) / 2;

  return (
    <group>
      {/* Slab and floor */}
      <Block at={[0, -0.31, 0]} size={[width + 2 * WALL, 0.58, depth + 2 * WALL]} material={materials.slab} shadow={false} />
      <Block at={[0, -0.01, 0]} size={[width, 0.02, depth]} material={materials.floor} shadow={false} />
      <Grid
        position={[0, 0.006, 0]}
        args={[width, depth]}
        cellSize={2}
        cellThickness={0.6}
        cellColor={palette.gridCell}
        sectionSize={10}
        sectionThickness={1}
        sectionColor={palette.gridSection}
        fadeDistance={10_000}
        fadeStrength={0}
      />

      {/* Floor markings: staging lane behind the docks */}
      <Block at={[0, 0.008, -halfD + STAGING_DEPTH]} size={[width - 2, 0.01, LINE]} material={materials.amber} shadow={false} />
      <Block at={[-halfW + 1, 0.008, -halfD + STAGING_DEPTH / 2]} size={[LINE, 0.01, STAGING_DEPTH]} material={materials.amber} shadow={false} />
      <Block at={[halfW - 1, 0.008, -halfD + STAGING_DEPTH / 2]} size={[LINE, 0.01, STAGING_DEPTH]} material={materials.amber} shadow={false} />

      {/* Back walls (+Z, -X) at full height with an amber safety band */}
      <Block at={[0, WALL_HEIGHT / 2, halfD + WALL / 2]} size={[width + 2 * WALL, WALL_HEIGHT, WALL]} material={materials.wall} />
      <Block at={[-halfW - WALL / 2, WALL_HEIGHT / 2, 0]} size={[WALL, WALL_HEIGHT, depth]} material={materials.wall} />
      <Block at={[0, STRIPE_HEIGHT / 2, halfD - 0.02]} size={[width, STRIPE_HEIGHT, 0.04]} material={materials.amber} shadow={false} />
      <Block at={[-halfW + 0.02, STRIPE_HEIGHT / 2, 0]} size={[0.04, STRIPE_HEIGHT, depth]} material={materials.amber} shadow={false} />

      {/* Front walls cut down to curbs; the yard-side curb leaves room for the dock doors */}
      <Block at={[halfW + WALL / 2, CURB_HEIGHT / 2, 0]} size={[WALL, CURB_HEIGHT, depth + 2 * WALL]} material={materials.wall} />
      {wallSegments(-halfW - WALL, halfW + WALL, docks.map((d) => d.position.x), DOCK_OPENING).map(([start, end]) => (
        <Block
          key={start}
          at={[(start + end) / 2, CURB_HEIGHT / 2, -halfD - WALL / 2]}
          size={[end - start, CURB_HEIGHT, WALL]}
          material={materials.wall}
        />
      ))}

      {/* Yard, truck bays and approach road */}
      <Block at={[boundsCentreX, -0.06, yardCentreZ]} size={[boundsWidth, 0.1, yardDepth]} material={materials.asphalt} shadow={false} />
      {docks.flatMap((dock) =>
        [-1.9, 1.9].map((offset) => (
          <Block
            key={`${dock.id}${offset}`}
            at={[dock.position.x + offset, -0.005, -halfD - WALL - BAY_LINE_LENGTH / 2]}
            size={[LINE, 0.01, BAY_LINE_LENGTH]}
            material={materials.amber}
            shadow={false}
          />
        )),
      )}
      <Block at={[boundsCentreX, -0.005, ROAD_Z]} size={[boundsWidth, 0.01, ROAD_WIDTH]} material={materials.road} shadow={false} />
      <Block at={[boundsCentreX, 0.001, ROAD_Z]} size={[boundsWidth, 0.01, LINE]} material={materials.roadLine} shadow={false} />
    </group>
  );
}
