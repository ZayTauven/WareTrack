import { WarehouseScene } from './scene/WarehouseScene.tsx';
import { useSimulation, useWarehouse } from './store/warehouseStore.ts';
import { FilterDock } from './ui/FilterDock.tsx';
import { Inspector } from './ui/Inspector.tsx';
import { TopBar } from './ui/TopBar.tsx';

/** RTS-style HUD: resources on top, commands bottom-left, unit details on the right. */
export default function App() {
  useSimulation();
  const inspecting = useWarehouse((s) => s.selection !== null);
  return (
    <main className="app" data-inspecting={inspecting || undefined}>
      <WarehouseScene />
      <TopBar />
      <p className="hint">Drag to pan · Scroll to zoom · Click a unit to inspect</p>
      <FilterDock />
      <Inspector />
    </main>
  );
}
