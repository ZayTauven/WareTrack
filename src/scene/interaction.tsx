import { useCursor } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { useFrame } from '@react-three/fiber';
import { Select } from '@react-three/postprocessing';
import { useRef, useState, type ReactNode } from 'react';
import { MathUtils, type Group } from 'three';
import type { Placement } from '../data/index.ts';
import { isSelected, useWarehouse, type Selection } from '../store/warehouseStore.ts';

/**
 * Click-to-select wrapper. `outline` adds the object to the outline pass;
 * objects drawn by instancing (racks) render their own highlight instead.
 */
export function Selectable({ target, outline = true, children }: { target: Selection; outline?: boolean; children: ReactNode }) {
  const selected = useWarehouse((s) => isSelected(s.selection, target));
  const select = useWarehouse((s) => s.select);
  const [hovered, setHovered] = useState(false);
  useCursor(hovered);

  const group = (
    <group
      onClick={(event: ThreeEvent<MouseEvent>) => {
        event.stopPropagation();
        select(target);
      }}
      onPointerOver={(event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation();
        setHovered(true);
      }}
      onPointerOut={() => setHovered(false)}
    >
      {children}
    </group>
  );

  return outline ? <Select enabled={selected}>{group}</Select> : group;
}

const EASE_RATE = 3.5;

/**
 * Glides to the latest placement instead of jumping on each live update.
 * The initial placement is applied once; later ones are eased in useFrame.
 */
export function Movable({ placement, children }: { placement: Placement; children: ReactNode }) {
  const ref = useRef<Group>(null);
  const [initial] = useState(placement);

  useFrame((_, delta) => {
    const group = ref.current;
    if (!group) return;
    const k = 1 - Math.exp(-delta * EASE_RATE);
    group.position.x += (placement.position.x - group.position.x) * k;
    group.position.z += (placement.position.z - group.position.z) * k;
    const turn = MathUtils.euclideanModulo(placement.rotationY - group.rotation.y + Math.PI, Math.PI * 2) - Math.PI;
    group.rotation.y += turn * k;
  });

  return (
    <group ref={ref} position={[initial.position.x, 0, initial.position.z]} rotation={[0, initial.rotationY, 0]}>
      {children}
    </group>
  );
}
