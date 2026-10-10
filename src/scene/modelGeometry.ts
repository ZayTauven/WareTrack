import { BoxGeometry, Color, CylinderGeometry, Float32BufferAttribute, Matrix4, MeshStandardMaterial, Quaternion, Vector3, type BufferGeometry } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

type Vec3 = [number, number, number];

/** One low-poly part: a box, or a wheel (cylinder with its axle along X). */
export interface Part {
  shape?: 'box' | 'wheel';
  at: Vec3;
  /** Box: width, height, depth. Wheel: radius, width (radius again ignored). */
  size: Vec3;
  color: string;
}

const box = new BoxGeometry(1, 1, 1);
const wheel = new CylinderGeometry(1, 1, 1, 12).rotateZ(Math.PI / 2);
const NO_ROTATION = new Quaternion();

/**
 * Bakes a list of parts into ONE geometry with per-vertex colours, so a whole
 * model renders in a single draw call (and a single shadow-map draw).
 */
export function buildModel(parts: readonly Part[]): BufferGeometry {
  const matrix = new Matrix4();
  const color = new Color();
  const pieces = parts.map((part) => {
    const [x, y, z] = part.at;
    const [a, b, c] = part.size;
    const scale = part.shape === 'wheel' ? new Vector3(b, a, a) : new Vector3(a, b, c);
    const piece = (part.shape === 'wheel' ? wheel : box).clone().applyMatrix4(matrix.compose(new Vector3(x, y, z), NO_ROTATION, scale));
    color.set(part.color);
    const count = piece.getAttribute('position').count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) color.toArray(colors, i * 3);
    piece.setAttribute('color', new Float32BufferAttribute(colors, 3));
    piece.deleteAttribute('uv');
    return piece;
  });
  const merged = mergeGeometries(pieces);
  pieces.forEach((piece) => piece.dispose());
  if (!merged) throw new Error('buildModel: parts have incompatible attributes');
  merged.computeBoundingSphere();
  return merged;
}

/** Shared material for every baked model. */
export const bakedMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.05, flatShading: true });

/** Memoises baked geometries by key (carrier livery, dock state...). */
export function geometryCache<K extends string>(build: (key: K) => readonly Part[]) {
  const cache = new Map<K, BufferGeometry>();
  return (key: K) => {
    let geometry = cache.get(key);
    if (!geometry) {
      geometry = buildModel(build(key));
      cache.set(key, geometry);
    }
    return geometry;
  };
}
