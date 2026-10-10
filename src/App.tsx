import { useState } from 'react';
import { createSeed } from './data/index.ts';
import { WarehouseScene } from './scene/WarehouseScene.tsx';

export default function App() {
  const [data] = useState(createSeed);
  return (
    <main className="app">
      <WarehouseScene data={data} />
      <p className="hint">Drag to pan · Scroll to zoom</p>
    </main>
  );
}
