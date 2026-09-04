# B16-A · Native Session Architecture — Council Decision (Lead synthesis)

> READ / DESIGN. Synthesis of the parallel, first-round-independent council
> (A1/A2 upstream-pin, A3 Mercury-auth [folded into B15 census], A4 Hermes-authority,
> A5 federation-mapping, A6 security-threat, A7 product-UX, A8 reuse-skeptic) plus the
> B16-C plugin-activation study and the server-console census. Evidence lives in each
> council's report; this file records the **decision** for TOTAL-CONTROL.
>
> Bases: Mercury `apps/desktop` @ `8767db7` (upstream native auth is vendored under
> `hermes_cli/dashboard_auth/*`); Hermes server @ `3bc2870f` (M35-F merged).

## 1. Frozen reuse verdicts (unanimous)

The upstream **RFC 8252 gateway-brokered native login** is complete and tested end to
end — a second implementation of any layer would be pure duplication:

| Component | Verdict | Evidence |
|---|---|---|
| Native login protocol (broker) | **ADOPT** | `hermes_cli/dashboard_auth/native_flow.py`, `routes.py` |
| Native desktop client | **ADOPT** | `electron/native-oauth-login.ts` (`runNativeLogin`) |
| PKCE (S256 gen + constant-time verify) | **ADOPT** | `native-oauth.ts:58`; `native_flow.py:295-298` |
| Loopback listener + literal-IP redirect validation | **ADOPT** | `native-oauth-login.ts:173`; `routes.py:253` |
| One-time code (single-use, short TTL) | **ADOPT** | `native_flow.py:260,288` |
| safeStorage at rest (hard-fail default, 0600) | **ADOPT** | `hardening.ts:164`; `native-token-store.ts` |
| Refresh lifecycle | **ADOPT** | `/auth/native/refresh` `routes.py:1027`; `ensureNativeAccessToken` `main.ts:7009` |
| Gateway/broker pattern | **ADOPT / WRAP** | the whole design premise — no parallel AS |
| Hermes tenant/principal/RBAC | **KEEP-OURS** | `ops/auth.py`, `ops/tenants.py`, `ops/capabilities.py` |

A2 note: upstream **current** `31e41ee…` is out of this session's scope; only the
vendored copy (conceptually the `dce4abe…` pin) was analyzed. **No pin bump attempted.**

## 2. The one genuinely-new boundary — and the A4/A8 adjudication

Every desktop piece the design needs is ADOPT/WRAP (native auth, credential store,
transport, plugin lifecycle). The **only** genuinely-new boundary is:

> **A server-side, pre-page enterprise-session source** — how a desktop holding an
> already-verified credential obtains an authenticated enterprise principal session
> (whoami + capabilities) **before** the console page renders, without the operator
> pasting a bearer and without the desktop deriving identity.

**A4 vs A8 disagreement (mapping authority):**
- **A4** proposed reusing `resolve_trusted_actor` + `channel_bindings` (the messaging
  ingress mapper) as the Agent→Principal authority.
- **A8** rejected that as the **wrong axis**: `resolve_trusted_actor` maps a channel
  `external_subject` from a `VerifiedInbound` message; a logged-in desktop operator with
  a bearer is not a `VerifiedInbound`. The correct, already-wrapped mapping for an
  operator is `/api/login` (`find_principal_by_token` → `RequestContext`) + `/api/whoami`.

**Lead adjudication = A8.** The server-console census independently confirms it: forcing
a bearer principal into the `TrustedActor` shape requires **synthesized channel/binding
placeholders** — a smell proving the operator-bearer axis and the channel-inbound axis
are different planes. Therefore:

- **Mapping authority = `/api/login` + `/api/whoami`** (principal-token axis), already
  wrapped in `src/plugins/enterprise-console/session.ts:91`. `resolve_trusted_actor` /
  `channel_bindings` is **NOT** reused for the operator mapping.
- **REUSE_DECISION (corrected from B15):** the "Agent identity → Hermes Principal"
  mapping **COLLAPSES-TO-WRAP** of `/api/login`+`/api/whoami`. The **only NEW-JUSTIFIED**
  item is the *pre-page session source*, which is **server-side** (`SERVER_FEDERATION_SEAM_GAP`).

## 3. Enterprise-session source — the ONE decision for TOTAL-CONTROL

Both surviving options keep Hermes the sole authority and need **no** change to Hermes
identity schema / RLS / roles.sql / principal semantics / ChannelBinding semantics /
production secret model (A4's own STOP-gate table: six NO's — the constraint that would
force a STOP is *trusting an agent-asserted tenant/principal directly*, which neither
option does):

- **(a) Federation / exchange** — the desktop's main-held native-OAuth bearer is
  exchanged **server-side** for an enterprise principal session. Closes
  `SERVER_FEDERATION_SEAM_GAP`. Strongest single-sign-on; requires a new server exchange
  contract.
- **(b) Pre-page principal-token login** — a boot-time in-app `/api/login` using a
  main-held, `safeStorage`-persisted principal token (reuses everything that exists;
  operator provisions the token once).

This is the same source decision B15 escalated. **No client write is requested until TC
freezes (a) or (b).** Once frozen, the desktop delta is small (see §4/§5).

## 4. One-login product experience (A7) — frozen flow

`install → RFC8252 native login (system browser) → desktop boot → enterprise availability
(server-derived) → Console entry appears automatically → reconnect (wake/backoff) →
revoke (entry disappears) → logout (bearer cleared)`.

The accepted implementation performs exactly **one** real login (native OAuth, main-held
bearer via `ensureNativeAccessToken`) and reuses that bearer as the credential source for
the fenced Enterprise session. The console never receives raw credential material. The
historical in-page `ConnectForm` had no remaining runtime/test/DEV entrypoint and has been
removed; DEV transport tests remain injectable without exposing a production UI fallback.

## 5. Plugin activation (B16-C) — WRAP, no second manager

Consensus (A8 + B16-C): drive the **existing** `activate`/`deactivate` handles from a
reactive eligibility predicate composed of a new host-level, **non-secret** availability
atom (`$enterpriseAvailable`) + the existing localStorage manual override. Precedence:
**manual disable > auto-enable**; no session → availability false → entry hidden; revoke →
handle deactivate → nav/route/palette contributions disposed (real registry mutation →
snapshot invalidated). Bearer never enters the plugin store. `defaultEnabled:false` stays
the floor; **no `defaultEnabled:true`, no second manager**. (Tightest form per A8: subscribe
the atom to the existing `setPluginEnabled(...)` path.)

## 6. Security posture (A6) — invariant + residuals

**Invariant (must hold):** tenant/principal identity is ALWAYS server-derived
(`_build_ctx_from_header` builds `RequestContext` solely from the bearer's DB row; whoami
mirrors, never asserts; write handlers inject identity and ignore body; per-request recompute
→ revocation immediate). The desktop **mirrors** whoami, never computes it.

Residuals to carry into B-AUD (none block this design; the top one is the reason for §4):
- **CLOSED** — the historical pasted-bearer surface was replaced by §4 one-login and the
  unrouted `ConnectForm` was removed after branch-exact reference census.
- **MEDIUM** — `enterprise:connect` trusts any preload-bearing renderer (no sender
  attestation); plain-text refresh-token under the keyring-less opt-in; silent capability
  downgrade to the embedded flow; whoami display-staleness after revoke; upstream
  reuse-detection unverifiable in-repo.
- **LOW** — second `connect` doesn't zeroize the prior bearer object; loopback callback
  accepted on any path (guarded by 192-bit state).

## 7. Server-console adapters (census) — pre-authorized safe build queue

Standard `bearer → RequestContext` (ops.auth) authority + `check_perm` + `tenant_transaction`
(RLS). Ranked by build-safety (no flagged-file edits):

1. **S3 ChannelBinding create + revoke** — perm `channel.binding.manage` exists, domain
   methods + factory + RLS + grants present. *Pure thin adapter.* (List/read view → adds
   `list_bindings` to `identity.py` [flagged] → **STOP that sub-slice, return to TC**.)
2. **S2 Follow-up READ** (list/get/history) — `PgFollowupStore` read methods exist; RLS +
   append-only history + grants present. *Pure thin adapter.* (Mutations → need a service
   composition root + a `RequestContext→FollowupAuthorizationPort` adapter; defer.)
3. **S6 Usage/metrics** — already exposed (`/api/metrics`, `/api/metrics/alerts`). *No build.*
4. **S4 outbound** already exposed; **inbound/held/unknown** → add a read-by-state query to
   `ledger.py` (non-flagged) + bridge. *More than HTTP; flagged-safe.*
5. **S5 Audit read/replay** — writers only; needs a new tenant-RLS read authority +
   `audit.read` perm (in `ops/tenants.py`, not flagged). *More than HTTP.*
6. **S1 WeCom management** — no status/health/secret-state domain at all; needs a whole new
   authority (+ likely `schema.sql` store). **STOP — return to TC.**

Cross-cutting: enterprise domain stores take `TrustedActor` (mandatory channel/binding),
while a console bearer yields a `RequestContext` with none — a **console→RequestContext-based
context** (not a fake TrustedActor) is preferred for read paths; the exact bridge shape is
examined per-slice and must never persist synthesized channel/binding data. Server work lives
in an **independent Draft PR** (not Mercury PR #8, not C PR #129), SERVER-INTEGRATOR owning
`webserver.py`; `schema.sql`/`roles.sql`/`identity.py`/`ops/auth.py` are READ-ONLY (edit → STOP).

## 8. Boundary

No production credential, no schema/RLS change, no second auth/PKCE/token-store/plugin-manager.
`READY = NO`, `MERGE = NO`. The single open decision is §3 (enterprise-session source a/b).
