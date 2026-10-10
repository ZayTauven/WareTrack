import { Vector3 } from 'three';

/**
 * Camera offset from the point it looks at. Equal X/Y/Z magnitudes give a true
 * isometric view (35.26° elevation, 45° azimuth); -Z puts the yard in the foreground.
 */
export const ISO_OFFSET = new Vector3(1, 1, -1).multiplyScalar(150);
