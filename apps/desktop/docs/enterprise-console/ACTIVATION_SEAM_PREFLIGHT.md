# B14-ACTIVATION-SEAM-RESOLUTION-PREFLIGHT-01

> READ / DESIGN only. No code in `plugins-store.ts` / `plugins.ts` / SDK root / app auth /
> Hermes_AI. This is the exact-seam proof + impact analysis for TOTAL-CONTROL to grant a
> narrow write authority. Evidence = the activation-seam census (Mercury `apps/desktop`).

## Existing seams (evidence)

- **EXISTING_PLUGIN_ENABLE_SEAM** — `src/contrib/plugins.ts:76` (bundled) / `runtime-loader.ts:179`
  gate on `if (pluginActive(id, plugin.defaultEnabled ?? true)) activate()`. `pluginActive`
  (`src/contrib/plugins-store.ts:60`) = `id in decisions ? decisions[id] : defaultEnabled`,
  where `decisions` is persisted in **localStorage** (`hermes.desktop.pluginDecisions.v2`).
  Flip path: Settings ▸ Plugins `<Switch>` → `setPluginEnabled` (`plugins-store.ts:111`); the
  only non-UI caller disables on pane close (`pane-shell/tree/store.ts:786`). **No capability/
  flag-driven enable path.**
- **EXISTING_DYNAMIC_PLUGIN_PRECEDENT** — none. `hermes-bots` (no `defaultEnabled` → default
  ON) is the only "default-on" precedent; no plugin auto-enables on a runtime signal.
- **EXISTING_APP_AUTH_SIGNAL / EXISTING_CONNECTION_SIGNAL** — these describe the **brain
  gateway** (a *different* backend from the enterprise Hermes web server): `use-gateway-boot.ts`
  `onConnectionReady`/`onGatewayReady`, `$connection` (`store/session.ts`), `$gateway`/
  `$gatewayState` (`store/gateway.ts`), exposed read-only via `host.state` (`sdk/index.ts:197-243`,
  `connectionId` :213, `gateway` :230). **There is no app-level signal for an authenticated
  *enterprise-server* session.**
- **WHOAMI_AVAILABILITY** — enterprise whoami / `product_capabilities` / `effective_permissions`
  exist **only inside `src/plugins/enterprise-console/`** (`session.ts`), and **only after** the
  operator connects via the in-page `ConnectForm`. No app-level whoami/capability store.
- **CREDENTIAL_SOURCE** — the enterprise bearer is entered in-page (ConnectForm), handed to the
  main process (transport), main-owned, `sessionId`-fenced. The brain-gateway credential is a
  separate, main-held connection token.
- **CAPABILITY_SOURCE** — `product_capabilities` from Hermes `/api/whoami`, in-page only.
- **UPSTREAM** — Mercury tracks NousResearch/hermes-agent; these seams are upstream-derived
  (no Mercury-only activation mechanism). No upstream conditional-enable precedent either.

## The chicken-and-egg (why L1 has no drop-in seam)

To make the console **appear** based on an authenticated enterprise session + capabilities,
that session must exist **before** the plugin page renders. But today the *only* place an
enterprise session is established is the console page's own `ConnectForm` — so the plugin
must already be enabled (and entered) to produce the whoami that would decide whether to
enable it. No existing app-level enterprise-session signal breaks this loop.

## DECISION = WRAP (L2, done) + NEW-JUSTIFIED (L1, minimal) · REUSE-SKEPTIC below

- **L2 (in-page)** = already ADOPTED: connect gate + `PermissionGate`/`CapabilityGate` decide
  page capability from whoami. No change.
- **L1 (product entry)** = NEW-JUSTIFIED: needs (a) an app-level "enterprise availability +
  capabilities" signal established *outside/before* the page, and (b) a capability-aware enable
  predicate at the existing enable gate.

### REUSE-SKEPTIC (proving no existing seam suffices)

- *Reuse `defaultEnabled`?* Two states only. `false` = manual dev opt-in (rejected as final
  UX); `true` = visible to every user incl. non-enterprise (rejected). Cannot encode "appears
  after enterprise auth".
- *Reuse the `Contribution.when` gate on the sidebar nav?* (`contrib/types.ts:28`, applied at
  `registry.ts:66`.) It can hide the nav until a predicate holds, but the predicate would read
  the plugin's own whoami — which only exists after in-page connect → the entry needed to
  connect would be hidden. Dead end for L1 (works only as an *extra* L2 refinement).
- *Reuse the brain-gateway auth signal (`host.state`)?* It authenticates a **different** backend
  and carries no enterprise `product_capabilities`. Using it as the predicate would show the
  console to any gateway-connected user regardless of enterprise entitlement — wrong authority.
- Conclusion: no existing seam carries "capability-driven product entry that appears post
  enterprise-auth without manual enable". The minimal correct fix is NEW app-level state + one
  predicate hook — not a second plugin manager.

## Impact analysis (for the narrow write grant)

- **FILES_REQUIRED (minimal):**
  1. `src/store/*` — a **new** small read-only store `$enterpriseAvailability` (`{ connected,
     capabilities }`), fed by whatever establishes the enterprise session (see SERVER_CHANGE).
  2. `src/sdk/index.ts` — expose it read-only on `host.state` (SDK_PUBLIC_IMPACT: one additive
     field; no breaking change).
  3. `src/contrib/plugins-store.ts` (or `plugins.ts` discovery) — extend `pluginActive` with a
     **capability-aware auto-enable predicate** that keeps localStorage manual override + the
     inventory (add-only; default behavior for all existing plugins unchanged).
  4. `src/plugins/enterprise-console/plugin.tsx` — declare the predicate/capability key.
- **STATE_OWNERSHIP:** the new store is app-level, read-only to plugins; the enterprise bearer
  stays main-owned/`sessionId`-fenced (unchanged). No credential moves to the renderer or
  localStorage.
- **CREDENTIAL_LIFETIME:** unchanged — bearer in main memory, dropped on logout/quit. The
  availability store holds only `{connected: boolean, capabilities}` — **no secret**.
- **PLUGIN_MANAGER_IMPACT:** additive predicate; existing plugins (no predicate) behave exactly
  as today; manual enable/disable + inventory preserved (BACKWARD_COMPATIBILITY = full).
- **SERVER_CHANGE_REQUIRED:** yes, to fully break the chicken-and-egg — an authenticated
  enterprise session must be establishable **before** the page (e.g. desktop connects to the
  Hermes web server at boot with a derived credential, or the brain gateway federates enterprise
  capabilities). This is a Hermes_AI webserver/transport + product decision (cross-repo), and is
  the true blocker; without it, L1 can only approximate via a boot-time in-app connect prompt.
- **SECURITY_IMPACT:** the predicate is UI visibility only; the server still enforces every
  request. No new secret surface; the availability signal is non-secret. Must not leak the
  bearer into the store or `host.state`.
- **SDK_PUBLIC_IMPACT:** one additive read-only `host.state` field; no existing consumer affected.
- **TEST_PLAN:** predicate true/false → plugin auto-enabled/not; manual override still wins;
  non-enterprise user (no capability) → console not shown; capability present → shown; bearer
  never in the store or `host.state`; existing plugins’ enablement unchanged (regression).

## Recommendation to TOTAL-CONTROL

The client-side change is small and backward-compatible, **but** the honest blocker is
SERVER_CHANGE_REQUIRED (pre-page enterprise session / capability federation), which is cross-repo.
Requesting: (1) a narrow write grant for the 4 client files above **once** the pre-page
enterprise-session source is decided; (2) the `product_capabilities` key for the console entry to
be defined server-side. Until then L1 stays an explicit Phase-1 GAP; L2 gating remains correct and
the current `defaultEnabled:false` + manual enable is retained as the construction/DEV seam only.
