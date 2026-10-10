import { lazy, Suspense } from 'react';
import { useSimulation, useWarehouse } from './store/warehouseStore.ts';
import { FilterDock } from './ui/FilterDock.tsx';
import { Inspector } from './ui/Inspector.tsx';
import { TopBar } from './ui/TopBar.tsx';

// The 3D stack is most of the bundle: load it after the HUD is on screen.
const WarehouseScene = lazy(() => import('./scene/WarehouseScene.tsx').then((m) => ({ default: m.WarehouseScene })));

/** RTS-style HUD: resources on top, commands bottom-left, unit details on the right. */
export default function App() {
  useSimulation();
  const inspecting = useWarehouse((s) => s.selection !== null);
  return (
    <main className="app" data-inspecting={inspecting || undefined}>
      <Suspense fallback={<p className="scene-loading">Loading the 3D view…</p>}>
        <WarehouseScene />
      </Suspense>
      <TopBar />
      <p className="hint">Drag to pan · Scroll to zoom · Click a unit to inspect</p>
      <FilterDock />
      <Inspector />
    </main>
  );
}
