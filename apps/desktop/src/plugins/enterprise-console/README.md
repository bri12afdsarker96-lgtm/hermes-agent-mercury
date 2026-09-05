# Enterprise Console (plugin)

Phase-1 operator console for a **Hermes_AI** web server, shipped as a bundled desktop
plugin (`defaultEnabled: false`). Pure SDK consumer — one `/console` route + a sidebar
entry, no core edits, no shared-root files.

## Principles

- **Server is the authority.** Identity, tenant, permission, and capability all come from
  `GET /api/whoami`. The console holds no second identity authority and makes no local
  permission decision. `PermissionGate` / `CapabilityGate` are UI display control only.
- **Capability Truth.** Every capability shows the server's maturity verdict
  (`LIVE/DEV/CONTRACT/PLANNED`); DEV/CONTRACT/PLANNED never renders as production-live.
- **Secret hygiene.** The bearer is entered transiently in the renderer at connect and
  cleared from the input on handoff; thereafter **main owns the session credential** (per
  window, fenced by an opaque `sessionId`) — never persisted (only the non-secret base URL
  is), never logged. Without the desktop bridge the transport **fails closed** (no
  renderer-direct-fetch fallback). Connector/provider secrets are never shown in plaintext.
- **No fabrication.** Pages with no server route render an honest "server API missing"
  state; they are not faked on the client. See `docs/enterprise-console/INTERFACE_FREEZE.md`.

## Layout

- `plugin.tsx` — registers the route + sidebar nav + i18n; installs the secure transport.
- `transport.ts` — the `HermesTransport` contract every page depends on (pages never see a
  token). `ctx.rest` is namespace-locked to `/api/plugins/<id>/*` and cannot reach the
  Hermes core `/api/*`, so the console brings its own transport.
- `ipc-transport.ts` — **production** transport: renderer → preload/IPC → main → HTTPS
  (reuses the desktop's main `fetchJson`); the bearer lives in the main process only.
- `fetch-transport.ts` — DEV/test adapter (direct renderer fetch); swapped out for the IPC
  transport when the desktop bridge is present.
- `fake-transport.ts` — a `HermesTransport` for tests (no network, no credential).
- `session.ts` — connect / whoami; persists only the base URL (never the bearer).
- `capabilities.ts` / `gate.tsx` — UI-only permission + capability gates.
- `catalog.ts` — the 13-page interface freeze, encoded.
- `console.tsx` — the shell (connect gate → sub-nav + content).
- `page-dashboard.tsx` — the first fully-live page (health + metrics + whoami).
- `page-placeholder.tsx` — honest blocked / partial / denied / pending states.

## Config

Point the console at a running Hermes web server (base URL) and connect with a principal
bearer. The server establishes the session via `/api/whoami`.

## Test

`npm run test:ui -- src/plugins/enterprise-console` (from `apps/desktop`).
