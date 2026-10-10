import { MapControls } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useCallback, useLayoutEffect, useRef, type ComponentRef } from 'react';
import { MathUtils, Vector3, type DirectionalLight } from 'three';
import type { FloorPoint, FloorRect } from '../data/index.ts';
import { ISO_OFFSET } from './iso.ts';

type Controls = ComponentRef<typeof MapControls>;

/** Moves target and camera together so the viewing angle never changes. */
function panTo(controls: Controls, x: number, z: number) {
  const dx = x - controls.target.x;
  const dz = z - controls.target.z;
  if (dx === 0 && dz === 0) return;
  controls.target.x = x;
  controls.target.z = z;
  controls.object.position.x += dx;
  controls.object.position.z += dz;
}

/**
 * RTS camera: drag to pan on the ground plane, wheel to zoom, no rotation.
 * The look-at point is clamped to `bounds` so the map can never be left.
 */
export function StrategyCamera({ bounds, focus, minZoom, maxZoom }: { bounds: FloorRect; focus: FloorPoint; minZoom: number; maxZoom: number }) {
  const ref = useRef<Controls>(null);

  useLayoutEffect(() => {
    const controls = ref.current;
    if (!controls) return;
    panTo(controls, focus.x, focus.z);
    controls.update();
  }, [focus]);

  const clamp = useCallback(() => {
    const controls = ref.current;
    if (!controls) return;
    panTo(
      controls,
      MathUtils.clamp(controls.target.x, bounds.minX, bounds.maxX),
      MathUtils.clamp(controls.target.z, bounds.minZ, bounds.maxZ),
    );
  }, [bounds]);

  return <MapControls ref={ref} makeDefault enableRotate={false} minZoom={minZoom} maxZoom={maxZoom} dampingFactor={0.12} onChange={clamp} />;
}

/** Low, from the camera's right: long shadows falling left across the floor. */
const SUN_OFFSET = new Vector3(-45, 55, -15);
const SHADOW_EXTENT = 70;

/**
 * Key light that follows the camera so a tight, sharp shadow map always covers
 * what is on screen, whichever site is in view.
 */
export function SunLight() {
  const ref = useRef<DirectionalLight>(null);

  useFrame(({ camera }) => {
    const light = ref.current;
    if (!light) return;
    const target = light.target.position.copy(camera.position).sub(ISO_OFFSET).setY(0);
    light.position.copy(target).add(SUN_OFFSET);
    light.target.updateMatrixWorld();
  });

  return (
    <directionalLight
      ref={ref}
      intensity={3.2}
      color="#fff4e2"
      castShadow
      shadow-mapSize={[2048, 2048]}
      shadow-bias={-0.0004}
      shadow-normalBias={0.04}
      shadow-camera-left={-SHADOW_EXTENT}
      shadow-camera-right={SHADOW_EXTENT}
      shadow-camera-top={SHADOW_EXTENT}
      shadow-camera-bottom={-SHADOW_EXTENT}
      shadow-camera-near={1}
      shadow-camera-far={200}
    />
  );
}
