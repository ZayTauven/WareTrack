import type { ReactNode } from 'react';
import type { Material } from 'three';
import type { DockState, Placement } from '../data/index.ts';
import { liveryFor } from './palette.ts';
import { materials, solid, unitBox, wheel } from './resources.ts';

type Vec3 = [number, number, number];

/** A scaled unit box: the only primitive most models need. */
export function Block({ at, size, material, shadow = true }: { at: Vec3; size: Vec3; material: Material; shadow?: boolean }) {
  return <mesh geometry={unitBox} material={material} position={at} scale={size} castShadow={shadow} receiveShadow />;
}

function Wheel({ at, scale = 1 }: { at: Vec3; scale?: number }) {
  return <mesh geometry={wheel} material={materials.tire} position={at} scale={scale} castShadow />;
}

/** Positions children at a site-local placement. */
export function Placed({ placement, children }: { placement: Placement; children: ReactNode }) {
  return (
    <group position={[placement.position.x, 0, placement.position.z]} rotation={[0, placement.rotationY, 0]}>
      {children}
    </group>
  );
}

// All models face -Z (forward) and stand on y = 0.

/** Box truck, ~10 m long. Cab at the front (-Z), cargo box over the rear. */
export function TruckModel({ carrier }: { carrier: string }) {
  const livery = liveryFor(carrier);
  const cab = solid(livery.cab, 0.55);
  const body = solid(livery.body, 0.75);
  return (
    <group>
      <Block at={[0, 0.75, 0]} size={[2.1, 0.35, 9.6]} material={materials.steelDark} />
      <Block at={[0, 2.0, -3.75]} size={[2.5, 2.4, 2.3]} material={cab} />
      <Block at={[0, 2.55, -4.91]} size={[2.2, 0.85, 0.05]} material={materials.glass} shadow={false} />
      <Block at={[0, 1.05, -4.95]} size={[2.4, 0.35, 0.12]} material={materials.steelDark} shadow={false} />
      <Block at={[0, 2.7, 1.2]} size={[2.6, 3.1, 7.4]} material={body} />
      <Block at={[0, 1.3, 4.92]} size={[2.6, 0.12, 0.08]} material={materials.amber} shadow={false} />
      {[-3.9, 2.4, 3.75].flatMap((z) => [
        <Wheel key={`l${z}`} at={[-1.15, 0.5, z]} />,
        <Wheel key={`r${z}`} at={[1.15, 0.5, z]} />,
      ])}
    </group>
  );
}

/** Counterbalance forklift, ~2.6 m long with forks. */
export function ForkliftModel() {
  return (
    <group>
      <Block at={[0, 0.75, 0.1]} size={[1.2, 0.7, 2.0]} material={materials.forklift} />
      <Block at={[0, 0.95, 1.0]} size={[1.2, 0.85, 0.5]} material={materials.steelDark} />
      <Block at={[0, 1.3, 0.35]} size={[0.6, 0.4, 0.5]} material={materials.steelDark} />
      {[-0.5, 0.5].flatMap((x) =>
        [-0.45, 0.8].map((z) => <Block key={`${x}${z}`} at={[x, 1.75, z]} size={[0.07, 1.2, 0.07]} material={materials.steelDark} />),
      )}
      <Block at={[0, 2.37, 0.18]} size={[1.15, 0.07, 1.4]} material={materials.steelDark} />
      <Block at={[-0.35, 1.35, -0.95]} size={[0.12, 2.7, 0.12]} material={materials.steel} />
      <Block at={[0.35, 1.35, -0.95]} size={[0.12, 2.7, 0.12]} material={materials.steel} />
      <Block at={[0, 0.5, -1.06]} size={[0.9, 0.55, 0.08]} material={materials.steel} />
      <Block at={[-0.25, 0.12, -1.7]} size={[0.12, 0.06, 1.2]} material={materials.steel} />
      <Block at={[0.25, 0.12, -1.7]} size={[0.12, 0.06, 1.2]} material={materials.steel} />
      {[-0.6, 0.8].flatMap((z) => [
        <Wheel key={`l${z}`} at={[-0.58, 0.3, z]} scale={0.6} />,
        <Wheel key={`r${z}`} at={[0.58, 0.3, z]} scale={0.6} />,
      ])}
    </group>
  );
}

export const DOCK_OPENING = 5.3;

/** Dock door set into the wall at z = 0; bumpers and status lamp face the yard (-Z). */
export function DockDoorModel({ state }: { state: DockState }) {
  const half = DOCK_OPENING / 2;
  return (
    <group>
      <Block at={[-half + 0.2, 2.5, 0]} size={[0.4, 5, 0.7]} material={materials.steelDark} />
      <Block at={[half - 0.2, 2.5, 0]} size={[0.4, 5, 0.7]} material={materials.steelDark} />
      <Block at={[0, 4.95, 0]} size={[DOCK_OPENING, 0.9, 0.7]} material={materials.steelDark} />
      <Block at={[0, 2.25, 0]} size={[4.5, 4.5, 0.12]} material={materials.door} />
      {[0.8, 1.7, 2.6, 3.5].map((y) => (
        <Block key={y} at={[0, y, -0.07]} size={[4.5, 0.05, 0.02]} material={materials.steel} shadow={false} />
      ))}
      <Block at={[-1.8, 0.5, -0.5]} size={[0.3, 0.6, 0.3]} material={materials.amber} />
      <Block at={[1.8, 0.5, -0.5]} size={[0.3, 0.6, 0.3]} material={materials.amber} />
      <Block at={[0, 0.02, 1.1]} size={[4.3, 0.04, 2.0]} material={materials.steel} shadow={false} />
      <Block
        at={[half - 0.2, 4.95, -0.36]}
        size={[0.25, 0.25, 0.05]}
        material={state === 'operational' ? materials.lampOk : materials.lampOff}
        shadow={false}
      />
    </group>
  );
}
