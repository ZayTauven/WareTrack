import { BoxGeometry, CylinderGeometry, MeshStandardMaterial } from 'three';
import { palette } from './palette.ts';

/**
 * Geometries and materials shared by every model. Low-poly shapes are unit
 * boxes scaled per mesh, so the whole scene uses a handful of GPU buffers.
 */
export const unitBox = new BoxGeometry(1, 1, 1);

/** Radius 0.5, axle along X. */
export const wheel = new CylinderGeometry(0.5, 0.5, 0.35, 12).rotateZ(Math.PI / 2);

const materialCache = new Map<string, MeshStandardMaterial>();

/** One material per colour, created on first use. */
export function solid(color: string, roughness = 0.85): MeshStandardMaterial {
  const key = `${color}/${roughness}`;
  let material = materialCache.get(key);
  if (!material) {
    material = new MeshStandardMaterial({ color, roughness, metalness: 0.05, flatShading: true });
    materialCache.set(key, material);
  }
  return material;
}

/** White base so per-instance colours show unaltered. */
export const instanceTinted = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, metalness: 0 });

export const materials = {
  ground: solid(palette.ground, 1),
  slab: solid(palette.slab),
  floor: solid(palette.floor, 0.95),
  wall: solid(palette.wall),
  amber: solid(palette.amber, 0.6),
  asphalt: solid(palette.asphalt, 1),
  road: solid(palette.road, 1),
  roadLine: solid(palette.roadLine, 0.8),
  steel: solid(palette.steel, 0.6),
  steelDark: solid(palette.steelDark, 0.7),
  deck: solid(palette.deck, 0.8),
  door: solid(palette.door, 0.7),
  glass: solid(palette.glass, 0.2),
  tire: solid(palette.tire, 1),
  forklift: solid(palette.forklift, 0.6),
  lampOk: new MeshStandardMaterial({ color: palette.lampOk, emissive: palette.lampOk, emissiveIntensity: 1.5 }),
  lampOff: new MeshStandardMaterial({ color: palette.lampOff, emissive: palette.lampOff, emissiveIntensity: 1.5 }),
};
