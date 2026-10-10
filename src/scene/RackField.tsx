import { useLayoutEffect, useMemo, useRef } from 'react';
import { Color, Matrix4, Quaternion, Vector3, type InstancedMesh, type Material } from 'three';
import type { FloorPoint, Rack, SiteId } from '../data/index.ts';
import { seededRandom } from '../domain/random.ts';
import { palette } from './palette.ts';
import { instanceTinted, materials, unitBox } from './resources.ts';

const BAYS = 4;
const POST = 0.1;
const BEAM_HEIGHT = 0.12;
const BEAM_DEPTH = 0.08;
const DECK = 0.04;

const UP = new Vector3(0, 1, 0);
const NO_ROTATION = new Quaternion();

interface RackParts {
  posts: Matrix4[];
  beams: Matrix4[];
  decks: Matrix4[];
  boxes: Matrix4[];
  boxColors: Color[];
}

/** World-space instance matrices for every rack part, built once per rack list. */
function buildRackParts(racks: Rack[], origins: Map<SiteId, FloorPoint>): RackParts {
  const parts: RackParts = { posts: [], beams: [], decks: [], boxes: [], boxColors: [] };
  const rackMatrix = new Matrix4();
  const local = new Matrix4();
  const position = new Vector3();
  const scale = new Vector3();
  const rotation = new Quaternion();

  for (const rack of racks) {
    const origin = origins.get(rack.siteId) ?? { x: 0, z: 0 };
    rackMatrix.compose(
      position.set(origin.x + rack.position.x, 0, origin.z + rack.position.z),
      rotation.setFromAxisAngle(UP, rack.rotationY),
      scale.set(1, 1, 1),
    );
    const add = (list: Matrix4[], x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
      list.push(rackMatrix.clone().multiply(local.compose(position.set(x, y, z), NO_ROTATION, scale.set(sx, sy, sz))));
    };

    const { length, depth, height } = rack.size;
    const levelHeight = height / rack.levels;
    const bayWidth = length / BAYS;

    for (let bay = 0; bay <= BAYS; bay++) {
      for (const z of [-depth / 2, depth / 2]) add(parts.posts, -length / 2 + bay * bayWidth, height / 2, z, POST, height, POST);
    }
    for (let level = 1; level <= rack.levels; level++) {
      const y = level * levelHeight;
      for (const z of [-depth / 2, depth / 2]) add(parts.beams, 0, y, z, length, BEAM_HEIGHT, BEAM_DEPTH);
      if (level < rack.levels) add(parts.decks, 0, y + BEAM_HEIGHT / 2, 0, length, DECK, depth);
    }

    const random = seededRandom(rack.id);
    for (let level = 0; level < rack.levels; level++) {
      const base = level === 0 ? 0 : level * levelHeight + BEAM_HEIGHT / 2 + DECK / 2;
      const headroom = levelHeight - BEAM_HEIGHT - DECK - 0.1;
      for (let bay = 0; bay < BAYS; bay++) {
        if (random() < 0.18) continue;
        const count = 1 + Math.floor(random() * 3);
        const slot = (bayWidth - POST - 0.1) / count;
        for (let i = 0; i < count; i++) {
          const w = slot * (0.78 + random() * 0.17);
          const h = headroom * (0.45 + random() * 0.5);
          const d = depth * (0.7 + random() * 0.2);
          const x = -length / 2 + bay * bayWidth + POST / 2 + 0.05 + slot * (i + 0.5);
          add(parts.boxes, x, base + h / 2, (random() - 0.5) * 0.1, w, h, d);
          parts.boxColors.push(new Color(palette.boxes[Math.floor(random() * palette.boxes.length)] ?? palette.amber));
        }
      }
    }
  }
  return parts;
}

function InstancedPart({ matrices, colors, material }: { matrices: Matrix4[]; colors?: Color[]; material: Material }) {
  const ref = useRef<InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
    colors?.forEach((color, i) => mesh.setColorAt(i, color));
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [matrices, colors]);

  return <instancedMesh key={matrices.length} ref={ref} args={[unitBox, material, matrices.length]} castShadow receiveShadow />;
}

/**
 * Every rack of every site in four draw calls (posts, beams, decks, boxes).
 * Racks are static, so instancing costs nothing in flexibility here.
 */
export function RackField({ racks, origins }: { racks: Rack[]; origins: Map<SiteId, FloorPoint> }) {
  const parts = useMemo(() => buildRackParts(racks, origins), [racks, origins]);
  return (
    <group>
      <InstancedPart matrices={parts.posts} material={materials.steel} />
      <InstancedPart matrices={parts.beams} material={materials.amber} />
      <InstancedPart matrices={parts.decks} material={materials.deck} />
      <InstancedPart matrices={parts.boxes} colors={parts.boxColors} material={instanceTinted} />
    </group>
  );
}
