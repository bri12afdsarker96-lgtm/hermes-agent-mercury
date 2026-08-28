# Enterprise Console — Dev Log (LANE-B, Mercury-side)

> C8 process log for gate `P3-M4A-DESKTOP-ASSISTANT-CONSOLE-01`. Mercury-owned docs
> only; no Hermes_AI docs are touched by this lane.

## Entry 2 — transport amendment (HermesTransport + secure main-process WRAP)

**Changed files**
- Plugin (leaf): `transport.ts` (new — interface + `$transport` + get/useTransport +
  `dispose`), `fetch-transport.ts` (was `hermes-client.ts`; `FetchHermesTransport` DEV
  adapter + exported `codeForStatus`), `fake-transport.ts` (new), `ipc-transport.ts` (new
  — production `IpcHermesTransport`), `session.ts` (drop public `$token`; swappable
  `transportFactory`; `dispose` on teardown), `page-dashboard.tsx` (`useTransport`),
  `plugin.tsx` (install IPC factory when bridge present) + tests
  (`transport.test.ts`, `ipc-transport.test.ts`, reworked `fetch-transport`/`session`/
  `page-dashboard` tests).
- Core (Integrator, minimal, additive): `electron/main.ts` (+`hermes:enterprise:*` IPC
  handlers reusing `fetchJson`; session bearer held in main memory only), `electron/
  preload.ts` (+`enterprise` bridge), `src/global.d.ts` (+`hermesDesktop.enterprise` type).
- Docs: `INTERFACE_FREEZE.md` transport section amended; catalog follow-up note corrected.

**Why (incl. corrections to my own prior call)**
- TOTAL-CONTROL flagged renderer-direct-fetch as a HIGH item. I initially judged the
  plugin-local `fetch` (Option B) an acceptable LANE-B-scoped choice. **That was wrong on
  the merits, and the B-T census proved it:** the Hermes server emits **no CORS** and
  enforces a **strict Origin allowlist** (`webserver.py:3240-3242`), so a renderer
  `file://` fetch is both CORS-blocked and Origin-rejected — it would not even function
  against a strict-mode server, independent of the (real) credential-surface concern.
- B-T1/B-T2 census → **WRAP**: the desktop main already owns `fetchJson`
  (`electron/main.ts:4762`; node https, `options.bearer` → `Authorization: Bearer`, no
  redirect-follow). Reused it behind a new minimal IPC bridge rather than building any
  networking framework or relaxing server CORS.
- B-T3/B-T4 security: window baseline PASS; **no server refresh contract** → none
  fabricated; safeStorage deferred; one follow-up = renderer CSP `connect-src`.
- Scope guard: this is a bounded transport remediation, not target expansion — pages are
  byte-unchanged except `page-dashboard` swapping `apiRequest` for `useTransport`.

**How verified**
- `tsc -p .` (renderer) 0 errors; `tsc -p tsconfig.electron.json` (main + preload) 0
  errors; `eslint` clean on plugin + `electron/main.ts` + `electron/preload.ts` +
  `global.d.ts`; `vitest --project ui` **8 files / 34 tests pass** (adds transport
  delegation, getTransport-fail, Fake/Ipc transports, IPC token-to-main-once + bearer
  never in renderer, error-code mapping, dispose→main clear). No regression in the
  electron `renderer-bundle` test.

**Remaining / not executed**
- Renderer CSP `connect-src` hardening (defense-in-depth follow-up).
- End-to-end run inside a packaged Electron shell (validated by types + unit; E2E is
  Lane-C). `READY = NO`, `MERGE = NO`.

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
