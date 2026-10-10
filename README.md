# WareTrack

Warehouse operations viewed like a real-time strategy game: an isometric 3D map of
three distribution centres, live truck and forklift status, site KPIs and filters.

A Django API serves the operation per organization; a server-side worker simulates it and
pushes changes over WebSocket, so everyone in an organization sees the same live state.

## Run it locally

```bash
docker compose up -d --wait                               # PostgreSQL :5433, Redis :6379
cd backend && cp .env.example .env                        # set a secret key and a demo password
uv sync && uv run python manage.py migrate && uv run python manage.py seed_demo
uv run python manage.py runserver 8001                    # terminal 1: API + WebSockets
uv run python manage.py run_simulation                    # terminal 2: live worker
cd .. && npm install && npm run dev                       # terminal 3: http://localhost:5173
```

Sign in with `DEMO_USER_EMAIL` / `DEMO_USER_PASSWORD` from `backend/.env`. Vite proxies
`/api` and `/ws` to :8001, so the app, the refresh cookie and the socket share one origin.

## Scripts

| Command              | What it does                                              |
| -------------------- | --------------------------------------------------------- |
| `npm run dev`        | Dev server on http://localhost:5173, proxied to the API   |
| `npm run build`      | Type check, then production build                         |
| `npm run preview`    | Serve the production build                                |
| `npm run typecheck`  | `tsc -b`, including the API contract check                |
| `npm test`           | Vitest: seed, KPIs, patch merging, API client, live feed  |
| `npm run lint`       | Oxlint                                                    |
| `npm run api:schema` | Regenerate `openapi.yaml` from the backend                |
| `npm run api:types`  | Regenerate `src/api/schema.d.ts` from `openapi.yaml`      |

## Architecture

```
src/api/     HTTP client (JWT in memory, refresh cookie), live feed, API contract
src/app/     Session flow: sign-in, snapshot + live patches, resync, sign-out
src/data/    Typed model, site layout, test seed                  (no React, no three)
src/domain/  Pure rules: KPIs, filters, patch merging              (no React, no three)
src/store/   Zustand: app status, session, operation, selection    (state only)
src/scene/   React Three Fiber view: renders the store, reports clicks
src/ui/      Sign-in and status screens, HUD: top bar, filter dock, inspector
```

- `src/api/contract.ts` proves at compile time that the API's payloads fit the domain
  types, so a backend change that breaks the front fails `tsc`, not production.
- The live feed opens before the snapshot loads; patches received meanwhile are replayed
  on top of it, and merging ignores rows older than what is held. Before the access token
  expires, a successor socket takes over without a gap; after a drop, the feed reconnects
  with backoff and resyncs.
- Views read the store through narrow selectors; scene objects subscribe to their own
  entity only, so a patch re-renders just what changed.
- Rendering budget: each truck, forklift and dock is baked into one geometry (one draw
  call); racks are instanced (four draw calls for all of them). About 45 draw calls
  for a site in view.
- The 3D stack (three, R3F, drei, postprocessing) is split into a lazily loaded chunk;
  the HUD ships in ~80 kB gzipped.
## Backend (`backend/`)

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
uv run python manage.py runserver 8001     # API + WebSockets (ASGI via Daphne) on :8001, docs at /api/docs/
uv run python manage.py run_simulation     # live worker: one tick every 2 s, written and broadcast
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

### Live updates (WebSocket)

`ws://<host>/ws/v1/orgs/{org}/live/`, offering the subprotocols `waretrack.v1` and
`bearer.<access token>`: the token rides in the handshake header, never in the URL. Non-members,
bad or expired tokens are refused at the handshake; the socket closes with code `4401` when the
token expires, and the client reconnects with a fresh one.

`run_simulation` (port of `src/domain/simulation.ts`) reloads each organization, runs one
tick in memory, writes it in a few bulk statements ordered to satisfy the constraints, then
broadcasts one message per organization:

```json
{ "type": "patch", "at": "...", "trucks": [...], "forklifts": [...], "shipments": [...],
  "inventory": [...], "removedShipmentIds": [...] }
```

Entities are full rows in the snapshot shape, read back after the write: merge them by `id`.

## Roles and actions

| Action (inspector) | Endpoint | Minimum role |
| --- | --- | --- |
| Send a truck waiting in the yard to a free dock | `POST orgs/{org}/trucks/{id}/dock/` | operator |
| Put a forklift on a docked shipment, or release it | `POST orgs/{org}/forklifts/{id}/assign/` | operator |
| Send a forklift to the charger | `POST orgs/{org}/forklifts/{id}/charge/` | operator |
| Take a dock out of service, or put it back | `POST orgs/{org}/docks/{id}/state/` | admin |

Viewers follow the operation without changing it. The server enforces the matrix
(`backend/apps/accounts/roles.py`); the front end mirrors it to show only what a user can do.
A refused rule answers 409 with a stable `code` (`dock_occupied`, `no_operator`...) and a message.
Actions and simulation ticks share a per-organization lock, so a tick never overwrites an action.
Each action returns the patch it broadcasts, so the screen updates at once for everyone.

`seed_demo` creates `operator@…` and `viewer@…` accounts next to the owner (same password).
Add people with `uv run python manage.py add_member EMAIL --role operator` (password from
`$MEMBER_PASSWORD` or a prompt).

## Security

| Area | Control |
| --- | --- |
| Sessions | Access JWT (5 min) in memory only; refresh token in an httpOnly, `SameSite=Strict` cookie scoped to `/api/v1/auth/`, rotated and blacklisted after use. Production signs JWTs with their own `JWT_SIGNING_KEY`. |
| Passwords | Argon2; Django's validators (min. 10 characters, common and numeric passwords rejected). |
| Tenancy | Every data URL is resolved through the caller's memberships: other organizations answer 404, records included. |
| Abuse | Login 10/min and refresh 30/min per client, 600/min per user elsewhere; pages capped at 500 rows. Clients are identified by `REMOTE_ADDR` unless `NUM_PROXIES` says how many proxies to trust, so a forged `X-Forwarded-For` cannot reset the login throttle. |
| WebSocket | Token in the subprotocol (never the URL), origin checked against `ALLOWED_HOSTS`, membership checked at the handshake, socket closed when the token expires. |
| Front end | Production builds ship a Content-Security-Policy (same-origin scripts and connections, no inline scripts or `<style>`). Serve `frame-ancestors 'none'` as a header. |
| Production settings | HTTPS redirect, HSTS, secure cookies, `X-Frame-Options: DENY`; `check --deploy` runs in CI. |
| Supply chain | CI audits npm and Python dependencies; Dependabot keeps them and the pinned GitHub Actions current. |

## Conventions

Distances in metres, Y up, floor positions `{ x, z }` local to each site, `rotationY = 0`
faces the yard (-Z). Timestamps are ISO 8601 strings.
