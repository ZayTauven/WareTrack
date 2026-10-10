import { Edges } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { EffectComposer, Outline, Selection, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { FloorPoint, FloorRect, ForkliftId, Rack, Site, SiteId, TruckId, WarehouseData } from '../data/index.ts';
import { byId } from '../domain/selectors.ts';
import { useWarehouse } from '../store/warehouseStore.ts';
import { StrategyCamera, SunLight } from './camera.tsx';
import { Movable, Selectable } from './interaction.tsx';
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
const OUTLINE_COLOR = 0xf0a53a;

function worldBounds(sites: WarehouseData['sites']): FloorRect {
  const rects = sites.map(({ origin, bounds }) => ({
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

// Each live object subscribes to its own entity only, so a tick re-renders
// just the objects that changed, never the whole scene.

function TruckNode({ id }: { id: TruckId }) {
  const truck = useWarehouse((s) => byId(s.data.trucks, id));
  if (!truck) return null;
  return (
    <Selectable target={{ kind: 'truck', id }}>
      <Movable placement={truck}>
        <TruckModel carrier={truck.carrier} />
      </Movable>
    </Selectable>
  );
}

function ForkliftNode({ id }: { id: ForkliftId }) {
  const forklift = useWarehouse((s) => byId(s.data.forklifts, id));
  if (!forklift) return null;
  return (
    <Selectable target={{ kind: 'forklift', id }}>
      <Movable placement={forklift}>
        <ForkliftModel />
      </Movable>
    </Selectable>
  );
}

/** Invisible click targets for the instanced racks, plus the selected rack's highlight. */
function RackTargets({ racks }: { racks: Rack[] }) {
  const selectedId = useWarehouse((s) => (s.selection?.kind === 'rack' ? s.selection.id : null));
  return (
    <>
      {racks.map((rack) => {
        const { length, depth, height } = rack.size;
        const selected = rack.id === selectedId;
        return (
          <Placed key={rack.id} placement={rack}>
            <Selectable target={{ kind: 'rack', id: rack.id }} outline={false}>
              <mesh geometry={unitBox} position={[0, height / 2, 0]} scale={[length, height, depth]} visible={false} />
            </Selectable>
            {selected && (
              <mesh geometry={unitBox} position={[0, height / 2, 0]} scale={[length + 0.4, height + 0.3, depth + 0.4]} raycast={() => null}>
                <meshBasicMaterial color={palette.amber} transparent opacity={0.1} depthWrite={false} />
                <Edges color={palette.amber} />
              </mesh>
            )}
          </Placed>
        );
      })}
    </>
  );
}

function SiteLayer({ site }: { site: Site }) {
  const docks = useWarehouse(useShallow((s) => s.data.docks.filter((d) => d.siteId === site.id)));
  const racks = useWarehouse(useShallow((s) => s.data.racks.filter((r) => r.siteId === site.id)));
  const truckIds = useWarehouse(useShallow((s) => s.data.trucks.filter((t) => t.siteId === site.id).map((t) => t.id)));
  const forkliftIds = useWarehouse(useShallow((s) => s.data.forklifts.filter((f) => f.siteId === site.id).map((f) => f.id)));

  return (
    <group position={[site.origin.x, 0, site.origin.z]}>
      <SiteGround site={site} docks={docks} />
      {docks.map((dock) => (
        <Selectable key={dock.id} target={{ kind: 'dock', id: dock.id }}>
          <Placed placement={dock}>
            <DockDoorModel state={dock.state} />
          </Placed>
        </Selectable>
      ))}
      {truckIds.map((id) => (
        <TruckNode key={id} id={id} />
      ))}
      {forkliftIds.map((id) => (
        <ForkliftNode key={id} id={id} />
      ))}
      <RackTargets racks={racks} />
    </group>
  );
}

/** View of the store: renders and reports clicks, holds no business rules. */
export function WarehouseScene() {
  const sites = useWarehouse((s) => s.data.sites);
  const racks = useWarehouse((s) => s.data.racks);
  const clearSelection = useWarehouse((s) => s.clearSelection);

  const origins = useMemo(() => new Map<SiteId, FloorPoint>(sites.map((s) => [s.id, s.origin])), [sites]);
  const bounds = useMemo(() => worldBounds(sites), [sites]);
  const focus = useMemo<FloorPoint>(() => {
    const origin = sites[0]?.origin ?? { x: 0, z: 0 };
    return { x: origin.x + SITE_FOCUS.x, z: origin.z + SITE_FOCUS.z };
  }, [sites]);

  return (
    <Canvas
      shadows="percentage"
      orthographic
      dpr={[1, 2]}
      camera={{ position: [focus.x + ISO_OFFSET.x, ISO_OFFSET.y, focus.z + ISO_OFFSET.z], zoom: INITIAL_ZOOM, near: 1, far: 1000 }}
      onPointerMissed={clearSelection}
    >
      <color attach="background" args={[palette.void]} />
      <hemisphereLight args={['#eef1f6', '#4a3f36', 0.9]} />
      <SunLight />
      <StrategyCamera bounds={bounds} focus={focus} minZoom={MIN_ZOOM} maxZoom={MAX_ZOOM} />

      <mesh
        geometry={unitBox}
        material={materials.ground}
        position={[(bounds.minX + bounds.maxX) / 2, -0.7, (bounds.minZ + bounds.maxZ) / 2]}
        scale={[4000, 0.1, 4000]}
      />

      <Selection>
        <EffectComposer multisampling={4} autoClear={false}>
          <Outline visibleEdgeColor={OUTLINE_COLOR} hiddenEdgeColor={OUTLINE_COLOR} edgeStrength={8} blur />
          <ToneMapping mode={ToneMappingMode.NEUTRAL} />
        </EffectComposer>
        {sites.map((site) => (
          <SiteLayer key={site.id} site={site} />
        ))}
      </Selection>

      <RackField racks={racks} origins={origins} />
    </Canvas>
  );
}
