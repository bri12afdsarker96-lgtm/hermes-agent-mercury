# Enterprise Console — Dev Log (LANE-B, Mercury-side)

> C8 process log for gate `P3-M4A-DESKTOP-ASSISTANT-CONSOLE-01`. Mercury-owned docs
> only; no Hermes_AI docs are touched by this lane.

## Entry 1 — kickoff, census, freeze, first verified slice

**Changed files**
- New bundled plugin `src/plugins/enterprise-console/` (leaf files only; no shared-root
  or core file changed): `plugin.tsx`, `console.tsx`, `connect-form.tsx`,
  `page-dashboard.tsx`, `page-placeholder.tsx`, `hermes-client.ts`, `session.ts`,
  `capabilities.ts`, `gate.tsx`, `status-badge.tsx`, `catalog.ts`, `types.ts`, `i18n.ts`
  + 6 `*.test.ts(x)`.
- Docs: `docs/enterprise-console/INTERFACE_FREEZE.md`, this log,
  `src/plugins/enterprise-console/README.md`.

**Why (incl. rejected options)**
- **LIVE GUARD:** Mercury `main` `60c2ed5` (matches expected snapshot), no open PR.
  Hermes_AI already serves a full single-file console `webconsole/index.html` via
  `hermes_devices/webserver.py` (64 `/api/*`). Per TOTAL-CONTROL: that "数字员工指挥台"
  is **not applicable this stage** → **REJECTED** as a reuse base (also fails the testability
  bar: unsafe-inline CSP, no components, no routing/state). Mercury `apps/desktop` is the
  upstream agent chat desktop — reused as the **stack/shell** only.
- **REUSE-GATE-0:** desktop shell/router/state/UI/i18n/test/CI → ADOPT (Kanban plugin
  pattern); enterprise pages → NEW-JUSTIFIED (no such surface exists in any writable repo,
  and Hermes_AI/webconsole is off-limits to LANE-B).
- **REST seam:** `ctx.rest` is namespace-locked to `/api/plugins/<id>/*`; it cannot reach
  Hermes core `/api/*`. Chose Option B (plugin-local `fetch` client, in-memory bearer) —
  **rejected** Option A (namespaced server endpoints) because it needs an A-line Hermes_AI
  change; deferred to TC.
- **Authority discipline:** the server owns identity/tenant/permission/capability; the
  console mirrors `/api/whoami`, holds no second identity authority, persists no secret,
  and gates UI only (server still enforces). Blocked pages render honest gaps, never fakes.

**How verified (incl. failures)**
- `tsc -p . --noEmit`: 0 errors (project-wide, incl. tests). Fixed 2 iterations: a
  `no-restricted-imports` plugin-fence violation (flattened the `pages/` subdir — `../`
  is banned) and a `vitest .mock.calls` typing cast.
- `eslint src/plugins/enterprise-console`: clean.
- `vitest run --project ui src/plugins/enterprise-console`: **6 files, 25 tests pass** —
  REST client (auth header, 401/403/501 mapping, no secret leak, fail-closed), session
  (only base URL persisted, bearer never stored, fail-closed on auth error, disposer wipe),
  capability truth (DEV never enabled/live), permission + capability gates, shell (connect
  gate, 13-page nav, blocked honesty, permission-denied UI), dashboard (live health + DEV
  maturity badge).

**Remaining risk / not executed**
- Only Dashboard/Health is built; the other 6 READY pages render an honest "pending"
  state (server contract confirmed, UI to follow) and the 3 BLOCKED + 2 PARTIAL pages
  render honest gap states. No page fabricates server authority.
- Not executed: Electron packaging tests, Playwright E2E (renderer-only slice; E2E
  selectors are frozen in `INTERFACE_FREEZE.md` for LANE-C).
- SERVER_API_GAP 1–5 + REST-seam Option A returned to TOTAL-CONTROL.
- `READY = NO`, `MERGE = NO`.
