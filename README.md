# WareTrack

Warehouse operations viewed like a real-time strategy game: an isometric 3D map of
three distribution centres, live truck and forklift status, site KPIs and filters.

Front end only for now. Live updates come from a simulation; the store is the single
seam where a real feed (WebSocket, Django Channels) will plug in.

## Scripts

| Command             | What it does                              |
| ------------------- | ----------------------------------------- |
| `npm run dev`       | Dev server on http://localhost:5173       |
| `npm run build`     | Type check, then production build         |
| `npm run preview`   | Serve the production build                |
| `npm run typecheck` | `tsc -b`                                  |
| `npm test`          | Vitest: seed integrity, simulation, KPIs  |
| `npm run lint`      | Oxlint                                    |

## Architecture

```
src/data/    Typed model, site layout, deterministic seed      (no React, no three)
src/domain/  Pure rules: simulation, KPIs, filters, invariants (no React, no three)
src/store/   Zustand: state, selection, filters, 2 s tick      (wires domain to views)
src/scene/   React Three Fiber view: renders the store, reports clicks
src/ui/      HUD: top bar, filter dock, inspector panel
```

- Views read the store through narrow selectors; scene objects subscribe to their own
  entity only, so a tick re-renders just what changed.
- Business rules live in `domain/` and are unit-tested; `findViolations` checks the
  operational invariants over long simulated runs.
- Rendering budget: each truck, forklift and dock is baked into one geometry (one draw
  call); racks are instanced (four draw calls for all of them). About 45 draw calls
  for a site in view.
- The 3D stack (three, R3F, drei, postprocessing) is split into a lazily loaded chunk;
  the HUD ships in ~80 kB gzipped.

## Conventions

Distances in metres, Y up, floor positions `{ x, z }` local to each site, `rotationY = 0`
faces the yard (-Z). Timestamps are ISO 8601 strings.
