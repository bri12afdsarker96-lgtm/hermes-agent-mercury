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
- **Secret hygiene.** The session bearer lives in memory only — never persisted (only the
  non-secret base URL is), never logged; connector/provider secrets are never shown in
  plaintext (the server never returns them).
- **No fabrication.** Pages with no server route render an honest "server API missing"
  state; they are not faked on the client. See `docs/enterprise-console/INTERFACE_FREEZE.md`.

## Layout

- `plugin.tsx` — registers the route + sidebar nav + i18n.
- `hermes-client.ts` — plugin-local `fetch` door to the Hermes core `/api/*` (the desktop's
  `ctx.rest` is namespace-locked and cannot reach it).
- `session.ts` — connect / whoami / in-memory bearer; persists only the base URL.
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
