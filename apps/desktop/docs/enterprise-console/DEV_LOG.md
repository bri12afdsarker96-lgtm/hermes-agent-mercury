# Enterprise Console — Dev Log (LANE-B, Mercury-side)

> C8 process log for gate `P3-M4A-DESKTOP-ASSISTANT-CONSOLE-01`. Mercury-owned docs
> only; no Hermes_AI docs are touched by this lane.

## Entry 12 — WAVE-7 B7 focused-audit remediation + Freeze V2 + ci.yml revert

**Context**: TOTAL-CONTROL WAVE-7 §18/§19 (`READY=NO MERGE=NO C1-B=NO`). After the Entry-11
SC1–SC6 build landed green (`303f41f`), six fresh focused auditors (B7-AUD1..6) ran on the head.
A session rate-limit interrupted them mid-run; the auditor work-in-progress was committed and
pushed as `b239b66`→`6066ea8` under the account identity (not gated behind the intended read-only
posture). This entry records the reconciliation and what was kept vs reverted.

**Kept (sound B7 remediation, CI-green, adopted)**:
- **Renderer token path removed** — `preload.ts` + `global.d.ts` drop the break-glass
  `enterprise.connect(baseUrl, token)` IPC; `ipc-transport.ts` makes the constructor private and
  token-free (`autoConnecting()` only). Production console access is native one-login only, which
  hardens MANUAL_TOKEN_PRIMARY=NO (§14/§15). `console.tsx` replaces the renderer `ConnectForm`
  fallback with a non-secret "enterprise session unavailable" notice.
- **Session generation fencing** — `session.ts` tags each async probe with a monotonic
  `sessionGeneration`; a later probe / disconnect / disposal invalidates an earlier completion, so
  a stale successful whoami can never resurrect AUTHENTICATED after logout/revocation (a real
  TOCTOU fix, covered by a new RED test).
- **Action-truth alignment** — knowledge/console action permission fixtures + tests aligned; +2
  enterprise-console tests (85→87). Produced `B_TO_C_INTERFACE_FREEZE_V2.md` (§19): server contract
  + desktop consumption contract per SC1–SC6, auth/transport invariants, session FSM, recovery,
  logout/revocation, capability truth.

**Reverted (unauthorized CI-infra change)** — one auditor deleted the maintainer's deliberate
`false &&` guard on the Desktop-E2E workflow in `.github/workflows/ci.yml` (disabled Aug 2 because
that suite is red on `main` itself for an unrelated Electron mock-window-title bug, tracking
#76627). Re-enabling runs a known-red suite and trips the CI-sensitive "Review label gate". The
guard is restored to base (`61af287`); this desktop PR carries no CI-infra change. The E2E suite is
therefore legitimately SKIPPED on the closure head, not a false-green.

**How verified** (my exact tree at `61af287`): `npm run typecheck` (tsc `.`+electron+e2e)=0;
`npm run lint`=0 errors; `vitest --project ui` enterprise-console=87 pass. Exact-head natural CI:
desktop checks green (lint + 3 ui shards + desktop/platforms/plugins); Review-label gate cleared by
the ci.yml revert. The one red required check — `Python tests / slice 2/12`
(`tests/gateway/test_session_api.py`) — is a gateway Python test; this PR changes zero Python
files, so it is a pre-existing/base failure, not this PR's.

`READY = NO`, `MERGE = NO`, `C1-B = NO`.

## Entry 11 — WAVE-7 desktop SC1–SC6 consumption + one-login recovery/FSM

**Context**: TOTAL-CONTROL B16 WAVE-7 (`READY=NO MERGE=NO C1-B=NO`). Server PR #131 (Hermes_AI,
HEAD `b37099f`) shipped SC1–SC6 read/write routes; the desktop catalog still marked Follow-up /
ChannelBinding / Conversations / Audit / WeCom as `blocked`/`partial` (stale PRODUCT code). This
entry wires the console to consume the real routes and hardens one-login into a recoverable FSM.
Six read-only DI-council agents mapped exact server shapes → desktop pages; an action census
(cross-checking master-roadmap-v3 + the SC contract + webserver.py) found **0 hard Phase-1 write
gaps** (SC2 closed the last one), so **no server-actions branch was opened**.

**Track A — SC1–SC6 desktop consumption** (reuse-only: `useConsoleQuery`/`QueryBody`/`ConsoleRows`
for reads, `ConfirmAction`/`FormAction` for writes, one `HermesTransport`, one router, one
permission authority — no second engine/client/controller/authority introduced):
- `page-followup.tsx` (new, SC1 `followup.read`): list + detail + history drill-in; READ-ONLY
  (no `followup-*` write route exists — controlStatus stays `missing`). Owner-scope is
  server-enforced; the client sends no filter.
- `page-audit.tsx` (new, SC4 `audit.read`, tenant_admin-only): list/detail/correlate; READ-ONLY
  evidence, NO replay/re-execute control; malformed-id→400 vs valid-id-outage→503 branch on
  `err.status`; bare-super_admin-no-tenant shows a "pick a tenant" notice and fires no request.
- `page-wecom.tsx` (new, SC5 `channel.binding.manage`): association + `runtime_credential_state`
  (UNKNOWN/ABSENT/PARTIAL/PRESENT, never PRESENT-from-silence) + counts; `callback_health` shown
  honestly as not-actively-probed; never a credential.
- `page-conversations.tsx` (rewired, SC3): replaced the stale `/api/delivery-outbox`/`delivery.read`
  surface with inbound/outbound/attempts on `conversation.read` (the stale-perm defect TC §6
  named); outbound→attempts drill-in by `internal_message_id`.
- `page-identity.tsx` (extended, SC2): added a ChannelBinding list + create/revoke section,
  self-gated in-component on `channel.binding.manage` (page stays reachable with `principal.crud`);
  reuses the principals query for the create picker.
- `page-kit.tsx`: added shared `fmtIso` (SC timestamps are ISO-8601 strings, not epochs — `fmtEpoch`
  would render "Invalid Date").
- `catalog.ts`: truthful status pass — followup/audit/wecom `blocked→ready`, identity/conversations
  `partial→ready`, conversations perm `delivery.read→conversation.read`, usage perm
  `metrics.view→tenant.profile.read` (operators wrongly passed the gate), audit gains
  `hideWhenUnpermitted`; usage stays honestly `partial` (no realtime-usage endpoint). Audit label
  "Audit Replay"→"Audit Evidence" (never re-execution). `console.tsx`: registered the 3 new pages +
  a nav-hide filter for `hideWhenUnpermitted`.

**Track B — one-login recovery/FSM** (§10–13; reuse the existing `onConnectionApplied` seam, no new
perpetual timer, no second OAuth state machine; bearer stays main-only):
- §12 `refreshWhoami` transient failure now → `UNAVAILABLE` (was: silently kept AUTHENTICATED), so
  `$enterpriseAvailable` flips false during an outage; the transport stays alive for recovery.
- §13 `no_native_session` reason now survives the IPC adapter (`fetch-transport` code union +
  `ipc-transport` forwards only that whitelisted non-secret code) → `session.stateForError` maps it
  to `UNKNOWN` (not `UNAVAILABLE`); `no_enterprise_origin` stays coarse→`UNAVAILABLE`.
- §10 `one-login.ts` no longer one-shot: subscribes `onConnectionApplied` to a bounded re-probe
  (idempotent `autoConnect`), plus a strictly-bounded self-disarming backoff (3 attempts, only while
  `UNAVAILABLE`) for an enterprise-only recovery the seam can't observe. `main.ts` rings the seam on
  native login/logout and, in `_clearNativeTokens` (the single funnel for logout / expired-no-RT /
  rejected-refresh), tears down all wired enterprise sessions so no stale bearer outlives the native
  session that minted it (§10-C/D). Also fixed the break-glass `connect()` catch to `dispose()` the
  transport (prior B-AUD4 LOW).

**How verified** (Mercury @ this branch): `npm run typecheck` (tsc `.` + electron + e2e) = 0;
`npm run lint` (eslint src/ electron/) = 0 errors; `vitest --project ui` enterprise-console = 85
pass (incl. new SC page tests, FSM recovery, no_native_session→UNKNOWN, nav-hide); `vitest --project
electron` = 1443 pass (incl. enterprise-transport 31). Exact-head natural CI to confirm on push.

**Ambiguities returned to TOTAL-CONTROL** (§7, not silently demoted): (1) whether an admin
Follow-up console WRITE is Phase-1 (server SC1 is deliberately read-only; reuse `enterprise/followup.py`
if promoted); (2) Conversation retry/held-release — server explicitly refuses operator retry
("unknown-delivery 不盲目重发") → reads NOT_PHASE1, confirm; (3) WeCom corp-secret/callback config
write — console-write (new connector-config authority) vs deploy-time env. Built read-only for all
three, matching the server; none faked.

`READY = NO`, `MERGE = NO`, `C1-B = NO`.

## Entry 10 — B16-C L1 activation mechanism (WRAP existing plugin lifecycle)

**Changed files**
- `src/contrib/enterprise-eligibility.ts` (new) — host-level, NON-SECRET `$enterpriseAvailable`
  atom + a small `registerEligibility`/`eligibilityAtomFor` registry so the loader stays
  plugin-agnostic. Carries a boolean only; no bearer, never persisted.
- `src/contrib/plugins-store.ts` — new `bindEligibility(id, atom)` + `reconcileEligible`: drive
  the EXISTING `activate`/`deactivate` handles from availability composed with the user's
  localStorage decision. Explicit decision ALWAYS wins; never writes a decision (auto-enable is
  not a manual choice). No second plugin manager.
- `src/contrib/plugins.ts` — discovery binds eligibility for eligibility-registered ids; every
  other plugin keeps the unchanged one-shot `pluginActive` gate.
- `src/app/contrib/controller.tsx` — registers `enterprise-console` eligibility before discovery.
- Tests: `src/contrib/enterprise-eligibility.test.ts` (7 cases: available→shown, unavailable→hidden,
  manual disable wins, manual enable pins on/break-glass, revoke hides entry, never writes a
  decision, disposer detaches).

**Why**: TC WAVE-2 §13/§14 — L1 product activation must ride the EXISTING plugin lifecycle
(no second manager, no `defaultEnabled:true`), with manual disable winning and revoke removing
the entry. This lands the contract-independent MECHANISM. The SOURCE that feeds
`$enterpriseAvailable` (main-process federated whoami → non-secret availability) lands with the
frozen federation contract (B16-D) — until then the atom stays `false`, so the console stays
hidden exactly as its `defaultEnabled:false` floor does today (no behavior change for existing
users; a manual Settings enable still pins it on as the DEV/break-glass path).

**Frozen federation contract (B16-D council, informs the pending one-login wiring)**: auth =
UPSTREAM-NATIVE-BEARER + HERMES-FEDERATED-PRINCIPAL-BINDING. The desktop keeps its existing
main-owned native OAuth bearer (never to the renderer); Hermes verifies it server-to-server by
WRAPping the gateway `GET /api/auth/me` and maps the verified external identity → an existing
Hermes principal via a new `federated_principal_bindings` table (external ids are lookup keys
only; principal/tenant/perms re-read from IdentityRepository every request). No second token
stack. That server work is a SEPARATE Hermes Draft PR (B16-D).

**How verified**: `tsc -p .`=0, eslint clean, `vitest --project ui` eligibility+contrib 17 pass.
`READY = NO`, `MERGE = NO`.

## Entry 9 — B16-B security hardening (M1–M4) + B16-A native-session architecture council

**B16-B — security hardening (real code, Mercury PR #8 only)**
- `electron/enterprise-transport.ts` (pure helpers): `sanitizeMultipartContentType`
  (M1 — strip CR/LF/NUL/control + validate MIME essence, safe default
  `application/octet-stream`), `ENTERPRISE_MAX_UPLOAD_BYTES=50 MiB` + `uploadByteLength`
  (M2 — reject oversize/malformed shape before fetch, fail closed), `classifyConnectError`
  (M3 — structured safe code/message, never token/URL creds/stack/body).
- `electron/main.ts`: `multipartBody` now sanitizes `contentType` (benefits all callers,
  incl. kanban); `enterprise:upload` handler adds the size/shape guard before `fetchJson`;
  `enterprise:connect` handler wraps `connect` in try/catch → structured error.
- `src/plugins/enterprise-console/ipc-transport.ts`: connect handles the `{ok:false}` shape;
  `src/global.d.ts`: connect result union; `connect-form.tsx`: M4 — corrected the stale
  `$token` atom comment to the real lifecycle (local state → handoff → cleared → main-owned).
- Tests: `electron/enterprise-transport.test.ts` +13 cases (CRLF/LF/NUL/malformed-MIME reject,
  valid pass, 50 MiB boundary pass, >50 MiB reject-before-fetch, malformed-bytes fail-closed,
  non-loopback + URL-credential structured errors, secret-absent-from-errors); fencing +
  upload-success regressions already present.
- Verified: `tsc -p tsconfig.electron.json`=0, `tsc -p .`=0, eslint clean; `vitest --project
  electron` 109 files / 1437 pass; ui project green.

**B16-A — native session architecture council (design; new doc `NATIVE_SESSION_ARCHITECTURE.md`)**
Parallel independent council (upstream-pin / Hermes-authority / federation-mapping /
security-threat / product-UX / reuse-skeptic) + plugin-activation study + server census.
Result: the whole RFC 8252 native-auth stack is **ADOPT** (vendored upstream, ~45 tests);
Hermes tenant/principal/RBAC = **KEEP-OURS**. **B15 REUSE correction accepted**: the
"Agent → Hermes Principal" mapping **COLLAPSES-TO-WRAP** of `/api/login`+`/api/whoami`
(Lead adjudicated A4-vs-A8 toward A8 — `resolve_trusted_actor`/`channel_bindings` is the
wrong, channel-inbound axis; the census's need for *synthesized* placeholders confirms it).
The **only NEW-JUSTIFIED** item is the server-side pre-page enterprise-session **source**
(`SERVER_FEDERATION_SEAM_GAP`) — the one open decision for TC: (a) federation exchange or
(b) pre-page `/api/login` with a `safeStorage`-persisted token. Plugin activation = WRAP of
existing `activate/deactivate` handles (no second manager). `READY = NO`, `MERGE = NO`.

## Entry 8 — B15 Enterprise-session bootstrap preflight (READ / DESIGN only, docs-only)

**Changed files**
- `docs/enterprise-console/BOOTSTRAP_SESSION_PREFLIGHT.md` (new) — the 13 `EXISTING_*` seam
  survey (Mercury boot/session/credential + Hermes_AI auth/token/capability), `REUSE_DECISION`
  with per-seam ADOPT/WRAP/BORROW + a `NEW-JUSTIFIED` for the bootstrap bridge with its
  `REUSE-SKEPTIC`, the security assessment, and the server-gap ledger.
- `docs/enterprise-console/DEV_LOG.md` (this entry).

**Why**: TC gate `B15-ENTERPRISE-SESSION-BOOTSTRAP-PREFLIGHT-01`. The B14 activation preflight
named `SERVER_CHANGE_REQUIRED` (a pre-page enterprise session) as the honest L1 blocker; B15 is
the read-only survey that decides the *source* of that session so TC can freeze it before any
client write.

**Findings (headline)**: Cross-launch **secure credential storage already exists** (`safeStorage`
+ `native-token-store`, hard-fail default, `0600`) → **no `SECURE_CREDENTIAL_STORAGE_GAP`, no new
keychain**. Main is already the **sole credential owner** (`ensureBackend`/`handleHermesApiRequest`)
→ ADOPT. Boot lifecycle is the WRAP carrier. `host.state` is the BORROW channel but the
enterprise-availability signal is a GAP (one new read-only atom). Three **server** gaps are the
real blocker: `SERVER_TOKEN_REFRESH_GAP`, `SERVER_DESKTOP_CAPABILITY_GAP`,
`SERVER_FEDERATION_SEAM_GAP`. Recommended session model = OAuth/native-bearer (main-held), **never
token-mode** (token-mode leaks the plaintext bearer into the renderer — pre-existing desktop
behavior to avoid).

**Boundary**: no code; forbidden set untouched (`plugins-store.ts` / `plugins.ts` / SDK root / app
auth stores / Hermes_AI webserver/auth / credential persistence). No activation construction.
`READY = NO`, `MERGE = NO`. RETURN_TO_TOTAL_CONTROL.

## Entry 7 — B14 Knowledge full control (sources / upload / preview / publish / withdraw / rollback)

**Changed files**
- Transport upload (core WRAP): `transport.ts` (+`UploadFile` + `upload`), `fetch-transport.ts`
  (`FetchHermesTransport.upload` multipart + shared `parseResponse`), `fake-transport.ts`,
  `ipc-transport.ts` (`upload` via bridge); `electron/main.ts` (+`hermes:enterprise:upload`
  reusing `fetchJson`'s multipart, field `file`, fenced by sessionId + path guard),
  `electron/preload.ts` + `src/global.d.ts` (upload bridge).
- `page-knowledge.tsx`: rebuilt into Uploads (upload → preview → publish/rollback) + Sources
  (committed → withdraw) + Candidates/review sections. `catalog.ts`: knowledge control → ready.
- Tests: `knowledge.test.tsx` (upload / publish / rollback / preview / withdraw flows), transport
  upload tests (`fetch-transport.test`, `ipc-transport.test`).

**Why (TC correction accepted)**: Knowledge publish/withdraw were mis-classified as deferred; they
are Phase-1 required and the server routes exist. All mapped to real Hermes P1 routes (no new
knowledge API): candidates/review→kb-gaps, upload→knowledge-upload, preview→knowledge-preview,
publish→knowledge-commit, withdraw→knowledge-delete, sources→knowledge-committed, rollback→
knowledge-rollback.

**Authoritative completion**: `knowledge-commit` is SYNCHRONOUS — the HTTP response (`status:
"committed"` or `idempotent`) is the authoritative completion; the page invalidates + refetches,
never fakes a publish; SSE is not used as the completion authority (subscribe-after-commit race).
Withdraw/rollback are destructive confirms; the file upload rides `fetchJson`'s existing multipart
through the fenced IPC transport (bearer stays in main).

**How verified**: `tsc -p .` 0, `tsc -p tsconfig.electron.json` 0, `eslint` clean, `vitest --project
ui` **12 files / 61** pass; electron enterprise-transport + renderer-bundle 25 pass. `READY = NO`,
`MERGE = NO`.

## Entry 6 — B13 form flows (create / review / reply / set-key)

**Changed files**: `actions.tsx` (+`FormAction` — reuse Dialog + Input/Textarea), form
actions wired: Task create (`page-tasks`), Reminder create (`page-reminders`), Handoff
reply (`page-handoff`, completing claim→reply→requeue), Knowledge review author/reject
(`page-knowledge`), Provider set-key (`page-provider`, password field). Tests:
`actions.test.tsx` (+FormAction success/disabled/error), `form-flows.test.tsx` (knowledge
review flow, handoff reply flow, provider set-key secret hygiene). Census doc updated with
implemented-vs-deferred (Phase-1 justification).

**Why**: closes TC's required Phase-1 flows — knowledge review flow + human-handoff flow —
plus create/set-key. Deferred real writes (biz-task claim/resolve, handoff reassign/
preempt/reset, knowledge publish/withdraw needing the upload surface, identity CRUD, budget
edit) are justified as supervisor-advanced or needing an extra surface, recorded as
CONTROL_STATUS = partial, never faked. Secrets: the api-key field is `type=password`, lives
only in field state + request body, never logged.

**How verified**: `tsc -p .` 0, `eslint` clean, `vitest --project ui` **11 files / 54**
pass (Radix dialog form flows included). `READY = NO`, `MERGE = NO`.

## Entry 5 — B13 control actions + write-surface census + activation contract

**Changed files**
- `WRITE_SURFACE_CENSUS.md` (STEP 1: real POST routes at live default `3bc2870`, READ vs
  CONTROL status per page + PHASE1-SERVER-CONSOLE-API-GAPS ledger).
- `actions.tsx` (`actionError` + `ConfirmAction` — reuse ConfirmDialog + React Query
  invalidation; no new modal/form/toast/mutation framework).
- Control actions wired: Task retry/close/escalate (`page-tasks`), Reminder cancel
  (`page-reminders`), Handoff claim/requeue (`page-handoff`), Provider select-provider
  (`page-provider`, super_admin-gated in UI). All POST to the server and invalidate the
  query — no local optimistic success, no local state machine, tenant/permission decided
  by the server.
- `catalog.ts`: added `controlStatus` (READ vs CONTROL split) so "page has data" is never
  read as "workflow complete".
- `ACTIVATION_CONTRACT.md`; `actions.test.tsx` (success→invalidate, cancel→no-run,
  403→error+no-refetch, actionError mapping); `pages.test.tsx` (+action buttons present).

**Why / correctness**
- STEP 1 census done against the exact live default TC named (`3bc2870`), using only real
  webserver routes (not domain Python). Real write routes confirmed for Task/Reminder/
  Handoff/Knowledge/Provider/Identity/Budget; WeCom/Follow-up/Audit/ChannelBinding/realtime-
  usage remain write-MISSING → ledger, honest unavailable states.
- STEP 2: implemented the confirm-style writes that are unambiguously READY. Form-style
  writes (Task/Reminder create, Handoff reply, Knowledge gap author/reject, Provider
  set-key) are the next slice; Knowledge publish(commit)/withdraw(delete) need the upload
  surface. Control status split records this honestly (Knowledge/Identity/Usage = control
  PARTIAL; Conversations/WeCom/Follow-up/Audit = MISSING).
- **ENTERPRISE_CONSOLE_ACTIVATION_CONTRACT**: L2 in-page gating (connect + permission/
  capability) is done and correct; L1 auto-appear is an **ACTIVATION_SEAM_GAP** (Mercury
  enablement is localStorage vs static defaultEnabled, no capability-driven path, plus a
  chicken-and-egg — whoami only exists after in-page connect). Returned to TC, not built
  (no second plugin manager).

**How verified**: `tsc -p .` 0, `eslint` clean, `vitest --project ui` **10 files / 48**
pass (Radix ConfirmDialog flows included). `READY = NO`, `MERGE = NO`.

## Entry 4 — B6-B12 pages (real server data, read-only)

**Changed files**
- New shared kit `page-kit.tsx` (`useConsoleQuery` + `QueryBody` states + `ConsoleRows`
  + `fmtEpoch`) — pure reuse of SDK React Query + Loader/ErrorState/EmptyState/ScrollArea;
  no table/virtualization engine (per B-REUSE-SKEPTIC; SDK `useVirtualizer` export is on
  HOLD per TC).
- New pages: READY — `page-tasks`, `page-reminders`, `page-alerts`, `page-provider`,
  `page-handoff`, `page-knowledge`; PARTIAL — `page-identity`, `page-conversations`,
  `page-usage`. Wired via a `PAGE_COMPONENTS` registry in `console.tsx`.
- `page-dashboard.tsx` + `types.ts`: corrected the Alert shape.
- `pages.test.tsx` (10 tests); `i18n.ts` (+error/module keys).

**Why / correctness**
- Built from the exact server field shapes (census of `webserver.py`). Notable fixes the
  census caught: Alerts are `{level,code,value,threshold,message}` (NOT `severity/kind/
  detail`) — the dashboard previously rendered non-existent fields; delivery metrics use
  the server's remapped keys (`delivered_total←sent`, `permanent_failure_total←failed`).
- Truth discipline: READY pages show real data; `knowledge` shows its DEV maturity badge
  (Capability Truth); PARTIAL pages render only what the server has and name the gap
  (Identity → ChannelBinding missing; Conversations → inbound/held/recovery missing; Usage
  → real budget, realtime usage unavailable); Handoff renders an honest "module
  unavailable" state on 501. BLOCKED pages (wecom/followup/audit) stay honest placeholders.
  Nothing is faked; all reads go through the fenced transport; pages never see a token.

**How verified**: `tsc -p .` 0, `eslint` clean, `vitest --project ui` **9 files / 44**
pass. `READY = NO`, `MERGE = NO`. Remaining: write actions (create/claim/commit…) behind
confirm dialogs, and E2E (Lane-C) — a later slice.

## Entry 3 — transport HIGH-1..4 remediation (session fencing, hardening, fail-closed)

**Changed files**
- New pure core: `electron/enterprise-transport.ts` (electron-free — session
  fencing store + base-URL/path/method validation) + `electron/
  enterprise-transport.test.ts` (14 tests, node project).
- `electron/main.ts`: handlers rewritten to per-WebContents fenced sessions
  (opaque `sessionId`), sender-`destroyed` cleanup, method allowlist, structural
  path/origin guard. `electron/preload.ts` + `src/global.d.ts`: `disconnect`
  and `request` now carry the `sessionId`. `electron/connection-config.ts`: none
  (its `normalizeRemoteBaseUrl` was already exported — reused, not rebuilt).
- Plugin: `transport.ts` (+`UnavailableHermesTransport`, the fail-closed
  default), `session.ts` (default factory now Unavailable), `ipc-transport.ts`
  (sessionId handshake; dispose fenced), `plugin.tsx` (no direct-fetch
  fallback), `connect-form.tsx` (clear the token input on handoff) + reworked
  `session`/`ipc-transport` tests.

**Why — TOTAL-CONTROL raised 4 HIGH (all accepted, all correct)**
- **HIGH-1** global session → cross-window bleed + stale teardown race. Fixed:
  `Map<webContentsId, {sessionId,baseUrl,token}>`; request/disconnect require
  sender AND sessionId match; a superseded sessionId can neither read the new
  credential nor tear down the new session.
- **HIGH-2** failed/stale connect didn't clear main. Fixed: connect-failure
  path disposes its own fenced session (fenced so it can't kill a newer one);
  the fail-closed default means a non-connect never leaves a session.
- **HIGH-3** base-URL/request boundary. Fixed by WRAPping the shared
  `normalizeRemoteBaseUrl` (already drops query/hash) + enterprise policy (no
  URL credentials; non-loopback ⇒ https; loopback may be http). Path guard is
  structural (dotdot/backslash/scheme-relative/percent-encoded/control-char
  rejected + on-origin assertion); method allowlist = GET/POST only. TLS never
  relaxed.
- **HIGH-4** production must fail closed without IPC. Fixed: default transport is
  `UnavailableHermesTransport`; the IPC transport is installed only when the
  desktop bridge is present; `FetchHermesTransport` is never an automatic
  fallback (unit/dev only, injected explicitly). Sender-destroyed cleanup drops
  orphan bearers.
- **Bearer-claim correction (accepted):** the wording is now accurate — a
  user-entered credential exists transiently in the renderer during connect (and
  is cleared from the input on handoff); after the IPC handoff the renderer does
  not persist/store/re-expose it; main owns the session credential; never
  persisted, never logged.

**How verified**
- `tsc -p .` 0, `tsc -p tsconfig.electron.json` 0, `eslint` clean (plugin +
  electron + global.d.ts). `vitest --project ui` **8 files / 36** pass;
  `vitest --project electron enterprise-transport.test.ts` **14** pass. No
  regression in `contrib` (70), `session-windows` + `renderer-bundle` (28).
- Test matrix covered: per-window isolation, cross-window, stale sessionId
  reject, stale disconnect fencing, sender-destroyed cleanup, missing-bridge
  fail-closed, no-direct-fetch-fallback, loopback-http/https accepted,
  non-loopback-http/URL-credentials/bad-scheme rejected, encoded/backslash/
  scheme-relative/control-char path rejected, method allowlist, 401 fail-closed,
  token never persisted, error redaction.

**Deferred (per TC)**: SDK `useVirtualizer` export = HOLD (prove need first);
renderer CSP = deferred hardening (B-AUD2/5). `READY = NO`, `MERGE = NO`.

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
