import type { ReactNode } from 'react';
import type { DockState, Placement } from '../data/index.ts';
import { bakedMaterial, geometryCache, type Part } from './modelGeometry.ts';
import { liveryFor, palette } from './palette.ts';

/** Positions children at a site-local placement. */
export function Placed({ placement, children }: { placement: Placement; children: ReactNode }) {
  return (
    <group position={[placement.position.x, 0, placement.position.z]} rotation={[0, placement.rotationY, 0]}>
      {children}
    </group>
  );
}

// All models face -Z (forward) and stand on y = 0. Each is baked into one
// geometry (see modelGeometry.ts): one draw call per object on screen.

const wheelPair = (x: number, y: number, z: number, radius: number, width: number): Part[] => [
  { shape: 'wheel', at: [-x, y, z], size: [radius, width, 0], color: palette.tire },
  { shape: 'wheel', at: [x, y, z], size: [radius, width, 0], color: palette.tire },
];

/** Box truck, ~10 m long. Cab at the front (-Z), cargo box over the rear. */
const truckGeometry = geometryCache((carrier: string) => {
  const { cab, body } = liveryFor(carrier);
  return [
    { at: [0, 0.75, 0], size: [2.1, 0.35, 9.6], color: palette.steelDark },
    { at: [0, 2.0, -3.75], size: [2.5, 2.4, 2.3], color: cab },
    { at: [0, 2.55, -4.91], size: [2.2, 0.85, 0.05], color: palette.glass },
    { at: [0, 1.05, -4.95], size: [2.4, 0.35, 0.12], color: palette.steelDark },
    { at: [0, 2.7, 1.2], size: [2.6, 3.1, 7.4], color: body },
    { at: [0, 1.3, 4.92], size: [2.6, 0.12, 0.08], color: palette.amber },
    ...[-3.9, 2.4, 3.75].flatMap((z) => wheelPair(1.15, 0.5, z, 0.5, 0.35)),
  ];
});

export function TruckModel({ carrier }: { carrier: string }) {
  return <mesh geometry={truckGeometry(carrier)} material={bakedMaterial} castShadow receiveShadow />;
}

/** Counterbalance forklift, ~2.6 m long with forks. */
const forkliftGeometry = geometryCache((): Part[] => [
  { at: [0, 0.75, 0.1], size: [1.2, 0.7, 2.0], color: palette.forklift },
  { at: [0, 0.95, 1.0], size: [1.2, 0.85, 0.5], color: palette.steelDark },
  { at: [0, 1.3, 0.35], size: [0.6, 0.4, 0.5], color: palette.steelDark },
  ...[-0.5, 0.5].flatMap((x) => [-0.45, 0.8].map((z): Part => ({ at: [x, 1.75, z], size: [0.07, 1.2, 0.07], color: palette.steelDark }))),
  { at: [0, 2.37, 0.18], size: [1.15, 0.07, 1.4], color: palette.steelDark },
  { at: [-0.35, 1.35, -0.95], size: [0.12, 2.7, 0.12], color: palette.steel },
  { at: [0.35, 1.35, -0.95], size: [0.12, 2.7, 0.12], color: palette.steel },
  { at: [0, 0.5, -1.06], size: [0.9, 0.55, 0.08], color: palette.steel },
  { at: [-0.25, 0.12, -1.7], size: [0.12, 0.06, 1.2], color: palette.steel },
  { at: [0.25, 0.12, -1.7], size: [0.12, 0.06, 1.2], color: palette.steel },
  ...[-0.6, 0.8].flatMap((z) => wheelPair(0.58, 0.3, z, 0.3, 0.21)),
]);

export function ForkliftModel() {
  return <mesh geometry={forkliftGeometry('forklift')} material={bakedMaterial} castShadow receiveShadow />;
}

export const DOCK_OPENING = 5.3;

/** Dock door set into the wall at z = 0; bumpers and status lamp face the yard (-Z). */
const dockGeometry = geometryCache((state: DockState): Part[] => {
  const half = DOCK_OPENING / 2;
  return [
    { at: [-half + 0.2, 2.5, 0], size: [0.4, 5, 0.7], color: palette.steelDark },
    { at: [half - 0.2, 2.5, 0], size: [0.4, 5, 0.7], color: palette.steelDark },
    { at: [0, 4.95, 0], size: [DOCK_OPENING, 0.9, 0.7], color: palette.steelDark },
    { at: [0, 2.25, 0], size: [4.5, 4.5, 0.12], color: palette.door },
    ...[0.8, 1.7, 2.6, 3.5].map((y): Part => ({ at: [0, y, -0.07], size: [4.5, 0.05, 0.02], color: palette.steel })),
    { at: [-1.8, 0.5, -0.5], size: [0.3, 0.6, 0.3], color: palette.amber },
    { at: [1.8, 0.5, -0.5], size: [0.3, 0.6, 0.3], color: palette.amber },
    { at: [0, 0.02, 1.1], size: [4.3, 0.04, 2.0], color: palette.steel },
    { at: [half - 0.2, 4.95, -0.36], size: [0.25, 0.25, 0.05], color: state === 'operational' ? palette.lampOk : palette.lampOff },
  ];
});

export function DockDoorModel({ state }: { state: DockState }) {
  return <mesh geometry={dockGeometry(state)} material={bakedMaterial} castShadow receiveShadow />;
}
