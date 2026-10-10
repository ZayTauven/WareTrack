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

## Backend (`backend/`, in progress)

Django + PostgreSQL, multi-tenant: `Organization` → `Membership` (role) → `Site` → docks,
racks, trucks, forklifts, inventory, shipments. Invariants a row can express (a truck sits
at a dock only while handling, one truck per dock, one active shipment per truck, …) are
database constraints.

```bash
docker compose up -d --wait                # PostgreSQL on 5433, Redis on 6379
cd backend
cp .env.example .env                       # then set a secret key and demo password
uv sync
uv run python manage.py migrate
uv run python manage.py seed_demo          # demo organization + owner account
uv run python manage.py runserver 8001     # API on :8001, docs at /api/docs/
uv run pytest
uv run ruff check . && uv run ruff format --check .
```

### API (`/api/v1`)

| Endpoint | |
| --- | --- |
| `POST auth/login/` · `auth/refresh/` · `auth/logout/` | JWT. Access token (5 min) in the body; refresh token in an httpOnly, SameSite=Strict cookie scoped to `/api/v1/auth/`, rotated and blacklisted after use |
| `GET me/` | Current user and their organizations (role per organization) |
| `GET orgs/{org}/snapshot/` | The whole operation in the front end's `WarehouseData` shape |
| `GET orgs/{org}/{sites,docks,racks,trucks,forklifts,inventory,shipments}/` | Paginated lists and details, `?site=` and (where relevant) `?status=` filters |
| `GET orgs/{org}/sites/{id}/kpis/` | Site KPIs computed in SQL, same definitions as `src/domain/kpis.ts` |

Non-members get 404 for an organization, never 403. `openapi.yaml` is the contract:
`npm run api:schema` regenerates it from the backend, `npm run api:types` turns it into
`src/api/schema.d.ts`.

## Conventions

Distances in metres, Y up, floor positions `{ x, z }` local to each site, `rotationY = 0`
faces the yard (-Z). Timestamps are ISO 8601 strings.
