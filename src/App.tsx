import { WarehouseScene } from './scene/WarehouseScene.tsx';
import { useSimulation } from './store/warehouseStore.ts';
import { Inspector } from './ui/Inspector.tsx';

export default function App() {
  useSimulation();
  return (
    <main className="app">
      <WarehouseScene />
      <Inspector />
      <p className="hint">Drag to pan · Scroll to zoom · Click a unit to inspect</p>
    </main>
  );
}
