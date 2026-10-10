import { lazy, Suspense, useEffect } from 'react';
import { boot } from './app/session.ts';
import { useWarehouse } from './store/warehouseStore.ts';
import { FilterDock } from './ui/FilterDock.tsx';
import { SignInScreen, StatusScreen } from './ui/Gate.tsx';
import { Inspector } from './ui/Inspector.tsx';
import { TopBar } from './ui/TopBar.tsx';

// The 3D stack is most of the bundle: load it after the HUD is on screen.
const WarehouseScene = lazy(() => import('./scene/WarehouseScene.tsx').then((m) => ({ default: m.WarehouseScene })));

/** RTS-style HUD: resources on top, commands bottom-left, unit details on the right. */
function Operations() {
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

export default function App() {
  const status = useWarehouse((s) => s.status);
  useEffect(boot, []);

  if (status === 'signed-out') return <SignInScreen />;
  if (status === 'ready') return <Operations />;
  return <StatusScreen />;
}
