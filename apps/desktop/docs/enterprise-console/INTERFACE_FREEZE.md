# DESKTOP_PHASE1_INTERFACE_FREEZE — Enterprise Assistant Console (LANE-B)

> Gate: `P3-M4A-DESKTOP-ASSISTANT-CONSOLE-01` · Repo: `hermes-agent-mercury` · Branch:
> `claude/p3-m4a-desktop-assistant-console-01` (cut from Mercury `main` `60c2ed5`).
> Server authority source (read-only): `Hermes_AI` `hermes_devices/webserver.py`
> (`http.server`, 64 `/api/*` routes). This freeze is derived from a live B3
> server-contract census + a B1/B2 desktop-architecture census.

## Architecture (frozen)

- **Presentation / control plane:** Mercury `apps/desktop` (Electron + React + Vite +
  shadcn + nanostores + React Query). The console ships as a **bundled plugin**
  `src/plugins/enterprise-console/` (`defaultEnabled: false`), one `/console` route
  + one sidebar entry, following the Kanban plugin pattern — **zero core edits, zero
  shared-root files changed**.
- **Authority:** the Hermes server owns identity / tenant / permission / capability.
  The console reads `GET /api/whoami` and mirrors it; it defines no second identity
  authority and makes no local permission decision. `PermissionGate` / `CapabilityGate`
  are **UI display control only**, never a security boundary.
- **REST seam (decision — see §GAP-0):** the desktop's `ctx.rest` is namespace-locked
  to `/api/plugins/<id>/*` and cannot reach Hermes's core `/api/*`. LANE-B therefore
  uses a **plugin-local `fetch` client** (`hermes-client.ts`) targeting a configurable
  Hermes base URL with an **in-memory** session bearer (never persisted, never logged).
  This needs **no Hermes_AI change** and no desktop-core change.
- **Capability Truth:** every capability is rendered with the server's own maturity
  verdict (`product_capabilities[cap].status` = LIVE/DEV/CONTRACT/PLANNED). DEV/CONTRACT/
  PLANNED is never shown as production-live.

## Per-page freeze

| PAGE | SERVER API (Hermes `/api/*`) | AUTHORITY | R/W | PERMISSION | CAPABILITY | CLIENT | STATE MODEL | ERROR MODEL | E2E SELECTOR | STATUS |
|---|---|---|---|---|---|---|---|---|---|---|
| Dashboard / Health | `GET /api/health` (public), `GET /api/metrics`, `GET /api/whoami` | server | R | `metrics.view` | `metrics` | React Query poll | loading/empty/error/live | `HermesApiError` code | `console-page-dashboard`, `console-health-ok` | **READY (built)** |
| WeCom | `GET /api/connectors`, `/api/connector-schema` (static schema only) | server | — | — | — | — | blocked | — | `console-page-wecom` | **BLOCKED** (GAP-1) |
| Identity / ChannelBinding | `GET/POST /api/principals`, `/api/whoami`, `/api/delegations` | server | R/W | `principal.crud` | — | plugin REST | partial | code | `console-page-identity` | **PARTIAL** (ChannelBinding missing) |
| WeCom Conversations | `GET /api/delivery-outbox` (read-only) | server | R | `delivery.read` | `delivery` | plugin REST | partial (outbound only) | code | `console-page-conversations` | **PARTIAL** (inbound/held/recovery missing) |
| Task | `GET /api/biz-tasks`, `/api/biz-task-assignments`, POST create/retry/close/escalate/claim/resolve | server | R/W | `biztask.read` (+write perms) | `biz_tasks` | plugin REST | ready | code | `console-page-tasks` | **READY** (pending build) |
| Business Follow-up | — (domain `enterprise/followup.py` exists; no HTTP route) | server | — | — | — | — | blocked | — | `console-page-followup` | **BLOCKED** (GAP-3, cross-lane) |
| Reminder | `GET /api/reminders`, POST reminder-create/cancel | server | R/W | `reminder.read` | `reminders` | plugin REST | ready | code | `console-page-reminders` | **READY** (pending build) |
| Enterprise Knowledge | `/api/knowledge-*` (upload/preview/commit/rollback/delete/committed), `/api/kb-gaps`, `kb-gap-author/reject` | server | R/W | `kb.author` / `kb.commit` | `knowledge_rag` = **DEV** | plugin REST + SSE | ready-dev | code | `console-page-knowledge` | **READY-DEV** (show maturity) |
| Human Handoff | `GET /api/handoffs`, `/api/handoff-team`, POST claim/reply/requeue/reassign/preempt/reset | server | R/W | `inbox.list` (+claim/reply) | `handoff` | plugin REST | ready | code (501 if inbox unassembled) | `console-page-handoff` | **READY** (pending build) |
| Alerts / Exceptions | `GET /api/metrics/alerts`, `/api/metrics` (`errors.*`) | server | R | `metrics.view` | `metrics` | React Query poll | ready | code | `console-page-alerts` | **READY** (pending build) |
| Provider | `GET /api/providers`, POST select-provider / set-provider-key | server (super_admin) | R/W | `provider.set` / `provider.set_key` | — | plugin REST | ready (secrets never returned) | code | `console-page-provider` | **READY** (pending build) |
| Usage / Budget | `GET/POST /api/tenant-profile` (budget), `GET /api/metrics` (counters) | server | R/W (budget) | `metrics.view` / `tenant.profile.*` | — | plugin REST | partial | code | `console-page-usage` | **PARTIAL** (no realtime usage endpoint) |
| Audit Replay | — (`ops/audit.py` append-only write; no read route) | server | — | — | — | — | blocked | — | `console-page-audit` | **BLOCKED** (GAP-2) |

Freeze encoded in code: `src/plugins/enterprise-console/catalog.ts`.

## Auth backbone (frozen contract)

- `GET /api/whoami` → `principal_id, name, tenant_id, role, effective_permissions[]`
  (or `perms_effective[]`), `product_capabilities{cap:{enabled,status}}`,
  `capability_revision`, `data_scope`, `handoff_claim_timeout_s`, `kb_supported_extensions`.
- Bearer token (`HERMES_AUTH_MODE` off/strict); tenant server-enforced; secrets
  (`/api/providers`, `set-provider-key`, connector secrets) never returned in plaintext.
- Permission match mirrors `ops/auth.py` wildcard (`*`, `kb.*`) — UI hint only.

## SERVER_API_GAP (return to TOTAL-CONTROL)

These pages have **no server authority**; the console renders an honest "server API
missing" state and does **not** fabricate them.

- **GAP-0 (architecture decision, resolved LANE-B-side):** REST seam. LANE-B adopts the
  plugin-local `fetch` client (Option B) — no Hermes_AI change. Option A (mount console
  endpoints under `/api/plugins/enterprise-console/` on the Hermes server) is a future
  server-side option that would require an A-line change; deferred to TC.
- **GAP-1 · WeCom (page 2) — SERVER_AUTHORITY_MISSING.** No per-tenant connector config
  store, no callback-health probe, no secret state machine (configured/missing/invalid/
  rotated). Needs a server-side connector-config authority + WeCom callback health route.
- **GAP-2 · Audit Replay (page 13) — API_MISSING.** Audit is append-only write; needs a
  read/replay route (a web `/api/*` route, does not consume the MCP 20/20 budget).
- **GAP-3 · Business Follow-up (page 6) — API_MISSING (cross-lane).** `enterprise/followup.py`
  state machine exists but exposes no HTTP route; this is the very core under construction
  on the Hermes-side branch `codex/p3-m35-f-business-followup-core`. The Follow-up page is
  blocked until that lane lands `/api/*` follow-up routes.
- **GAP-4 · ChannelBinding (page 3 partial) — API_MISSING.** `PgChannelBindingStore` has no
  create/revoke/list route.
- **GAP-5 · Usage metering (page 12 partial) — PARTIAL.** No realtime token-usage/spend
  read endpoint; only event counters + budget config.

## Scope

- Phase-2 frozen (not built, not a gate condition): Android device pages, ADB, scrcpy,
  MediaProjection, WebRTC/live screen, Feishu, advanced WeCom, advanced BI.
- `READY = NO`, `MERGE = NO`, `PREPROD/PRODUCTION = NOT AUTHORIZED`. Construction /
  draft-PR / push only.
