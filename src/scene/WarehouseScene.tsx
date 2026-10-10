import { Canvas } from '@react-three/fiber';
import { useMemo } from 'react';
import { NeutralToneMapping } from 'three';
import type { FloorPoint, FloorRect, SiteId, WarehouseData } from '../data/index.ts';
import { StrategyCamera, SunLight } from './camera.tsx';
import { ISO_OFFSET } from './iso.ts';
import { DockDoorModel, ForkliftModel, Placed, TruckModel } from './models.tsx';
import { palette } from './palette.ts';
import { RackField } from './RackField.tsx';
import { materials, unitBox } from './resources.ts';
import { SiteGround } from './SiteGround.tsx';

const MIN_ZOOM = 4;
const MAX_ZOOM = 40;
const INITIAL_ZOOM = 9;
/** Initial look-at point, site-local: building centre nudged towards the yard. */
const SITE_FOCUS: FloorPoint = { x: 0, z: -12 };

function worldBounds(data: WarehouseData): FloorRect {
  const rects = data.sites.map(({ origin, bounds }) => ({
    minX: origin.x + bounds.minX,
    maxX: origin.x + bounds.maxX,
    minZ: origin.z + bounds.minZ,
    maxZ: origin.z + bounds.maxZ,
  }));
  return {
    minX: Math.min(...rects.map((r) => r.minX)),
    maxX: Math.max(...rects.map((r) => r.maxX)),
    minZ: Math.min(...rects.map((r) => r.minZ)),
    maxZ: Math.max(...rects.map((r) => r.maxZ)),
  };
}

/** Pure view of the data: no state, no business rules. */
export function WarehouseScene({ data }: { data: WarehouseData }) {
  const origins = useMemo(() => new Map<SiteId, FloorPoint>(data.sites.map((s) => [s.id, s.origin])), [data.sites]);
  const bounds = useMemo(() => worldBounds(data), [data]);
  const focus = useMemo<FloorPoint>(() => {
    const origin = data.sites[0]?.origin ?? { x: 0, z: 0 };
    return { x: origin.x + SITE_FOCUS.x, z: origin.z + SITE_FOCUS.z };
  }, [data.sites]);

  const centreX = (bounds.minX + bounds.maxX) / 2;
  const centreZ = (bounds.minZ + bounds.maxZ) / 2;

  return (
    <Canvas
      shadows
      orthographic
      dpr={[1, 2]}
      gl={{ toneMapping: NeutralToneMapping }}
      camera={{ position: [focus.x + ISO_OFFSET.x, ISO_OFFSET.y, focus.z + ISO_OFFSET.z], zoom: INITIAL_ZOOM, near: 1, far: 1000 }}
    >
      <color attach="background" args={[palette.void]} />
      <hemisphereLight args={['#eef1f6', '#4a3f36', 0.9]} />
      <SunLight />
      <StrategyCamera bounds={bounds} focus={focus} minZoom={MIN_ZOOM} maxZoom={MAX_ZOOM} />

      <mesh geometry={unitBox} material={materials.ground} position={[centreX, -0.7, centreZ]} scale={[4000, 0.1, 4000]} />

      {data.sites.map((site) => (
        <group key={site.id} position={[site.origin.x, 0, site.origin.z]}>
          <SiteGround site={site} docks={data.docks.filter((d) => d.siteId === site.id)} />
          {data.docks
            .filter((d) => d.siteId === site.id)
            .map((dock) => (
              <Placed key={dock.id} placement={dock}>
                <DockDoorModel state={dock.state} />
              </Placed>
            ))}
          {data.trucks
            .filter((t) => t.siteId === site.id)
            .map((truck) => (
              <Placed key={truck.id} placement={truck}>
                <TruckModel carrier={truck.carrier} />
              </Placed>
            ))}
          {data.forklifts
            .filter((f) => f.siteId === site.id)
            .map((forklift) => (
              <Placed key={forklift.id} placement={forklift}>
                <ForkliftModel />
              </Placed>
            ))}
        </group>
      ))}

      <RackField racks={data.racks} origins={origins} />
    </Canvas>
  );
}
