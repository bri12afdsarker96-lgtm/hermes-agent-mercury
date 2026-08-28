# B15-ENTERPRISE-SESSION-BOOTSTRAP-PREFLIGHT-01

> READ / DESIGN only. No code changes. This is the seam survey + reuse decision for
> TOTAL-CONTROL to decide the **enterprise-session source** that breaks the L1 activation
> chicken-and-egg documented in `ACTIVATION_SEAM_PREFLIGHT.md`. It answers: *where does an
> authenticated enterprise session come from, before the console page renders, without a new
> credential store and without moving the bearer to the renderer?*
>
> **Stable HEAD** = `8767db70815ade3d2b7f1858b94f20fe3f161700` (PR #8, Mercury).
> Mercury evidence = `apps/desktop` at this HEAD. Hermes_AI evidence = server
> `claude/hermes-desktop-multi-ai-phone-aiw5mr` @ `3bc2870f36cff698c9bd5eb21dc7e36242a33040`
> (read-only; no Hermes_AI file is touched by this lane).
>
> **This round MUST NOT modify**: `plugins-store.ts`, `plugins.ts`, SDK root, app auth stores,
> Hermes_AI webserver/auth, credential persistence. This doc is docs-only.

---

## 0. Scope of the survey

Two cores were surveyed read-only:

- **Mercury (desktop presentation/control plane)** — boot/login lifecycle, main-process
  connection owner, gateway bootstrap, secure credential storage, reconnect/restore,
  logout/disconnect, app-level non-secret state, plugin-enable lifecycle, contribution
  visibility seam.
- **Hermes_AI (sole authority)** — principal login, token issuance, validation,
  refresh/rotation, revocation/logout, whoami, desktop/system capability, tenant capability
  authority, credential-exchange/federation precedent.

Guiding constraint (unchanged from the whole lane): **desktop never becomes a second identity/
capability authority and the enterprise bearer never reaches the renderer, localStorage,
`host.state`, plugin decisions or logs.**

---

## 1. The 13 EXISTING_* fields (evidence)

### Desktop (Mercury) seams

**EXISTING_DESKTOP_BOOT_AUTH** = PRESENT.
Renderer-driven boot lifecycle `useGatewayBoot`: `boot()` → `desktop.getConnection()` →
`resolveGatewayWsUrl()` (re-mints a WS ticket) → `gateway.connect(wsUrl)` →
`adoptPrimaryProfile()` → parallel config/sessions; progress via `onBootProgress` overlay,
failure → boot-failure overlay; first-run remote form mounts the install overlay.
- `src/app/gateway/hooks/use-gateway-boot.ts` (boot orchestration; `completeDesktopBoot()`
  at `:408`), first-run remote form `src/components/desktop-install-overlay.tsx:391`
  (`FirstRunRemoteForm`), boot state `src/store/boot.ts`, reauth classification
  `src/components/boot-failure-reauth.ts`.
- **REUSE = WRAP.** The natural carrier for "desktop booted → authenticated connection →
  product entry appears". An enterprise-session bootstrap should hang **after** boot succeeds
  (`completeDesktopBoot()`), as a post-boot read-only probe — never altering the boot handshake.

**EXISTING_MAIN_SESSION_OWNER** = PRESENT (sole credential authority).
`ensureBackend(profile)` resolves + caches the backend descriptor; all Hermes API traffic goes
through the main-process proxy `handleHermesApiRequest`, credential injected in main
(token-mode `connection.token`; oauth-mode native bearer, else cookie partition). Renderer only
sends `{path, method, body}`.
- `electron/main.ts:9565` (`ensureBackend`), API proxy `handleHermesApiRequest` (credential
  injected main-side; oauth/cookie fork), IPC egress `hermes:connection` / `hermes:api`,
  preload bridge `electron/preload.ts` (`getConnection`).
- **REUSE = ADOPT.** Enterprise session must keep the existing paradigm — main holds the
  credential, renderer receives only a secret-free descriptor/signal. Main is already the owner;
  no new holder is introduced.

**EXISTING_CREDENTIAL_STORAGE** = PRESENT (OS-secure; hard-fail default). **This is the key
fact for cross-launch persistent login — it already exists.**
Electron `safeStorage` (OS keyring: macOS Keychain / Windows DPAPI / Linux libsecret/kwallet).
Keyring unavailable → **hard fail by default** (unless the user explicitly opts into a Linux
plain-text basic backend in Settings ▸ Gateway). Secret files are `0600` (POSIX) / userData ACL
(Windows), main-only.
- `electron/hardening.ts:164` (`encryptDesktopSecret`, hard-fail when keyring unavailable
  `:179`), atomic `0600` write `:141` (`SECRET_FILE_MODE=0o600` `:45`,
  `SAFE_STORAGE_ENCODING='safeStorage'` `:51`), native OAuth token persistence
  `electron/native-token-store.ts:98`/`:135` (whole token-set as one encrypted blob; refresh
  token never in plain text; log redaction `redactGatewayUrl` `:80`).
- Sinks: `connection.json` (v1 encrypted token), connection-registry v2 (encrypted token
  envelope), `native-oauth-tokens.json` (per-baseUrl safeStorage payload).
- **REUSE = ADOPT. → NO `SECURE_CREDENTIAL_STORAGE_GAP`.** Cross-launch persistent login is
  already implemented and mature. **We do not build a keychain framework.** If the enterprise
  session rides native-OAuth, `native-token-store` restores the bearer across launches; if
  token-mode, the encrypted `connection.json`/registry envelope applies.

**EXISTING_RECONNECT_SEAM** = PRESENT.
Two layers: renderer backoff reconnect loop + wake signals (power resume / online /
visibilitychange); main-side `revalidateConnection` actively probes the remote backend (no
child-exit signal for a remote backend, so dead cache is discarded by probe). Near-expiry
OAuth/native tokens are transparently refreshed by `ensureNativeAccessToken`.
- `use-gateway-boot.ts:203` (`attemptReconnect`), `:285` (`scheduleReconnect`), wake signals,
  main probe `hermes:connection:revalidate`.
- **REUSE = ADOPT (mechanism) + BORROW (signal).** Enterprise-session recovery can ride the
  existing wake/reconnect signals; if enterprise identity is a distinct whoami session, append a
  single read-only whoami re-verify after `reconnectNow`/power-resume — borrowing the signal,
  not changing the reconnect machinery.

**EXISTING_LOGOUT_SEAM** = PRESENT.
OAuth logout clears both the cookie partition **and** the native bearer; cloud logout clears the
portal session; the enterprise console disconnect destroys the main-side bearer per sender.
- OAuth logout `electron/main.ts` (`clearOauthSession` + native-token clear), enterprise
  disconnect `hermes:enterprise:disconnect` → `EnterpriseSessionStore.disconnect`, sender-destroy
  cleanup `enterprise-transport.ts:165` (`destroySender`).
- **REUSE = ADOPT.** Enterprise logout maps directly onto `enterprise:disconnect` (per-sender
  bearer destroy) + `_clearNativeTokens` when persistence was used.

**EXISTING_APP_STATE_SEAM** = PARTIAL (channel exists; the specific signal does not).
There is a renderer→plugin **read-only, secret-free** state channel `host.state` (nanostore
readonly atoms: `connectionId` / `gateway` socket state / `profile` / `cwd` / `activeSessionId`).
**`host.state` contains no token.** The underlying `$connection` store carries a token but is
lint-fenced away from plugins. There is **no "enterprise availability" signal today.**
- `src/sdk/index.ts:198` (`host.state`), `connectionId` `:213`, `gateway` `:230`; underlying
  connection store `src/store/session.ts` (token-bearing, fenced); enterprise identity is
  in-memory plugin-local `src/plugins/enterprise-console/session.ts:26` (`$whoami`), `:33`
  (`$connected`).
- **REUSE = BORROW (channel) + GAP (signal).** `host.state` is the natural home for a read-only
  `enterpriseAvailable`-style signal (derived from whoami/connection probe, **never the bearer**),
  but that signal **does not exist = GAP.** Adding it is one read-only computed atom, isomorphic
  to the existing `connectionId`/`gateway`.

**EXISTING_PLUGIN_ENTRY_SEAM** = PRESENT but **non-reactive** (known seam).
Discovery → register → enable is a localStorage-decision static chain. `discoverBundledPlugins()`
globs; each plugin gets activate/deactivate handles; `pluginActive(id, defaultEnabled)` decides.
Contribution `when()`/`enabled` are **snapshot-evaluated at register time, NOT reactive**. The
sidebar entry is a `SIDEBAR_NAV_AREA` data contribution. The console plugin is
`defaultEnabled:false`.
- `src/contrib/plugins-store.ts:60` (`pluginActive`), decision key
  `hermes.desktop.pluginDecisions.v2` `:32`, toggle `setPluginEnabled` `:111`; discovery
  `src/contrib/plugins.ts`; non-reactive `when` `src/contrib/types.ts:28` applied
  `src/contrib/registry.ts:66`; console registration
  `src/plugins/enterprise-console/plugin.tsx` (`defaultEnabled:false`).
- **REUSE = BORROW (current seam) — records the known non-reactive limitation only.** Making the
  product entry appear reactively on enterprise availability requires a registry mutation to
  re-resolve; recorded, no design change proposed this round.

### Server (Hermes_AI) seams — read-only

**EXISTING_ENTERPRISE_LOGIN** = PRESENT.
`POST /api/login` (name + token only) → `{token, principal_id, tenant_id, role, name}`. It does
**not** return `effective_permissions`/capabilities — the client must call `/api/whoami`
afterward. This is the **only** enterprise-session entry, and it requires a pre-held principal
token.
- `hermes_devices/webserver.py` `/api/login`, whoami `/api/whoami`.

**EXISTING_TOKEN_ISSUANCE** = PRESENT (admin-only, one-time reveal).
`POST /api/principals` (`create_principal`, `secrets.token_urlsafe(32)`, stored as sha256
`token_hash`, plaintext returned **once**). There is no token-issue/exchange endpoint for a
desktop to derive its own session token.
- `hermes_devices` identity/principals path (`create_principal`).

**EXISTING_TOKEN_REFRESH** = **NONE → `SERVER_TOKEN_REFRESH_GAP`.**
No TTL, no refresh/rotation endpoint; "refresh" == manually recreate a principal token.
- (absence) — `ops/auth.py` Bearer validation has no expiry/rotation concept.

**EXISTING_TOKEN_REVOCATION** = PRESENT (soft, coarse).
`POST /api/principals-delete` == revoke (soft, status flip). There is **no** per-session
invalidation endpoint and no server-side session object.
- `hermes_devices` principals-delete.

**EXISTING_DESKTOP_CAPABILITY** = PRESENT but **CONTRACT → `SERVER_DESKTOP_CAPABILITY_GAP`.**
`ops/capabilities.py` `"desktop": CONTRACT` (a `SystemCapability`). `ProductCapability` = 10 keys;
`enabled = system==LIVE AND role ceiling covers bundle`. Because `desktop` is CONTRACT (not LIVE),
there is **no** ProductCapability/control bundle/tenant toggle/real-time revocation/system-level
entry enforcement for a "desktop console" product entry.
- `ops/capabilities.py:77` (`"desktop": CONTRACT`); tenant policy `ops/tenant_capability_policy.py`
  (`HERMES_CAPABILITY_POLICY_MODE` off/postgres; `filter_effective_permissions` narrows-only).
- Per the capability CORRECTION already accepted: **do NOT create
  `product_capabilities["enterprise_console"]`.** L1 availability = authenticated enterprise
  session + desktop system availability; L2 gating = whoami/perms/product_capabilities.

**EXISTING_FEDERATION_SEAM** = **NONE → `SERVER_FEDERATION_SEAM_GAP`.**
No token exchange, no WS-ticket, no M2M credential derivation. The only enterprise-session entry
is `/api/login`, which requires a pre-held principal token. There is no precedent for a desktop's
main-held (brain-gateway / OAuth) credential being exchanged for an enterprise principal session.

---

## 2. REUSE_DECISION (aggregate)

**REUSE_DECISION = ADOPT (client mechanism) + WRAP (boot carrier) + NEW-JUSTIFIED (the missing
bootstrap bridge — server-gated).**

| Seam | Decision |
|---|---|
| Main-process credential ownership | **ADOPT** — main stays sole holder; renderer gets a secret-free descriptor/signal. |
| Secure credential storage (`safeStorage`/native-token-store) | **ADOPT** — cross-launch persistence already exists; **no new store.** |
| Boot lifecycle as bootstrap carrier | **WRAP** — post-boot read-only probe; do not touch the handshake. |
| Reconnect/logout seams | **ADOPT** (mechanism) + **BORROW** (whoami re-verify signal). |
| `host.state` enterprise-availability signal | **BORROW** (channel) + **GAP** (one new read-only atom). |
| Plugin-entry reactivity | **BORROW** — known non-reactive limitation, recorded only. |
| **The bootstrap bridge itself** (main-held desktop credential → enterprise session **before** the page) | **NEW-JUSTIFIED** — see REUSE-SKEPTIC. Blocked on a server decision. |

### REUSE-SKEPTIC (why the bootstrap bridge is genuinely NEW, not a reuse)

- *Reuse `/api/login`?* It authenticates an **already-held principal token**. It cannot mint a
  desktop session from the desktop's existing brain-gateway/OAuth credential — those are different
  backends and different credentials. So `/api/login` alone cannot make an enterprise session
  appear *before* the operator pastes a bearer. → cannot break the chicken-and-egg.
- *Reuse the brain-gateway auth (`host.state`/`$connection`)?* It authenticates a **different**
  backend and carries **no** enterprise `product_capabilities`/`effective_permissions`. Treating
  it as the enterprise signal would show the console to any gateway-connected user regardless of
  enterprise entitlement — **wrong authority** (violates the whole lane's "server is sole
  authority" principle).
- *Reuse `native-token-store` to auto-restore an enterprise bearer?* It restores across launches
  **only a bearer that was first obtained**. It does not *obtain* the first enterprise session —
  it presumes one already exists. So it solves persistence, not bootstrap.
- *Reuse token issuance (`POST /api/principals`)?* Admin-only, one-time reveal, no exchange — it
  is not a self-service session bootstrap and would put the desktop in the identity-authority
  business (forbidden).
- **Conclusion**: no existing Mercury *or* Hermes_AI seam carries "a desktop with a main-held
  credential obtains an authenticated enterprise session (whoami + capabilities) **before** the
  console page renders." The minimal correct fix is a **server-provided bootstrap** (token
  exchange / federation / pre-page login), consumed by a small client WRAP — **not** a second
  plugin manager, **not** a renderer-side credential, **not** a desktop-side identity authority.
  This is the same honest blocker as `SERVER_CHANGE_REQUIRED` in the B14 activation preflight.

---

## 3. Security assessment (for the design that follows)

- **No secret leakage found** in the current console: no bearer in localStorage / `host.state` /
  plugin decisions / logs. Only `$baseUrl` (non-secret) is persisted (`session.ts`); the bearer
  is entered in-page (`connect-form.tsx`, `type="password"`), handed once to main, main-owned and
  `sessionId`-fenced (`enterprise-transport.ts`), never returned/persisted/logged.
- **Recommended session model = OAuth/native-bearer (main-held), NOT token-mode.** The Mercury
  census flagged that **token-mode** remote connections put the **plaintext bearer into the
  renderer** (both `$connection.token` and interpolated into the `wsUrl` query string). An
  enterprise-session bootstrap MUST avoid token-mode so the bearer never enters the renderer.
  (This is a pre-existing desktop behavior, not introduced here; noted so the B15 design avoids
  it.)
- **`SECURE_CREDENTIAL_STORAGE_GAP` = NOT RAISED.** `safeStorage` + `native-token-store` +
  atomic `0600` files already provide OS-secure, hard-fail-by-default cross-launch storage. We do
  **not** build a keychain framework.

---

## 4. Server gaps ledger (Hermes_AI-owned; not faked by desktop)

1. **`SERVER_TOKEN_REFRESH_GAP`** — no token TTL/refresh/rotation; refresh == manual recreate.
2. **`SERVER_DESKTOP_CAPABILITY_GAP`** — `desktop` is `CONTRACT` (not LIVE); no ProductCapability
   / control bundle / tenant toggle / real-time revocation / system-level entry enforcement for a
   desktop-console product entry. (Do not invent `enterprise_console`; reuse the existing
   `desktop` system capability once it matures.)
3. **`SERVER_FEDERATION_SEAM_GAP`** — no token exchange / WS-ticket / M2M credential derivation;
   `/api/login` (pre-held principal token) is the only enterprise-session entry.

These three server gaps are the true blocker for L1 "product entry appears automatically after an
authenticated desktop session." Until a source is decided, L1 stays an explicit Phase-1 GAP and
the current `defaultEnabled:false` + in-page `ConnectForm` remains the construction/DEV seam.

---

## 5. Recommendation to TOTAL-CONTROL

The **client** side is small and reuse-heavy (ADOPT main-held credential model + WRAP boot +
BORROW `host.state`/reconnect; one new read-only availability atom). The **honest blocker is
server-side**: an enterprise session must be establishable **before** the page, which needs one
of —

- **(a) Federation/exchange** — the desktop's main-held brain-gateway/OAuth credential is
  exchanged server-side for an enterprise principal session (closes `SERVER_FEDERATION_SEAM_GAP`);
  or
- **(b) Pre-page login** — a boot-time in-app enterprise `/api/login` using a main-held,
  `safeStorage`-persisted principal token (reuses existing storage; still requires the operator to
  provision that token once).

**Requesting from TOTAL-CONTROL a single decision**: which enterprise-session source (a) or (b)
(or "L1 stays GAP for Phase-1"). No client write is requested until that source is frozen; when it
is, the narrow client surface is the B14 preflight's 4 files (new read-only availability store +
one additive `host.state` field + capability-aware enable predicate + plugin declaration), all
backward-compatible.

**This round performs no construction.** `READY = NO`, `MERGE = NO`, activation construction not
started. RETURN_TO_TOTAL_CONTROL.
