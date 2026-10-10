import { BoxGeometry, MeshStandardMaterial } from 'three';
import { palette } from './palette.ts';

/**
 * GPU resources shared across the scene. Models are baked per object
 * (modelGeometry.ts); these serve the instanced racks, hit boxes and ground.
 */
export const unitBox = new BoxGeometry(1, 1, 1);

const solid = (color: string, roughness: number) => new MeshStandardMaterial({ color, roughness, metalness: 0.05, flatShading: true });

/** White base so per-instance colours show unaltered. */
export const instanceTinted = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, metalness: 0 });

export const materials = {
  ground: solid(palette.ground, 1),
  amber: solid(palette.amber, 0.6),
  steel: solid(palette.steel, 0.6),
  deck: solid(palette.deck, 0.8),
};