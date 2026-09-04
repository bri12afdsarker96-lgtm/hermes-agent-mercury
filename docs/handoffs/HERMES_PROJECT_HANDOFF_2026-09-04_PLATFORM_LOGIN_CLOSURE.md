# Hermes Project — platform login closure handoff

**Status:** controlled candidate implementation and infrastructure deployment
completed; it is **not** a formal release and human-owned desktop/product
acceptance remains outstanding.  This document records observed state on
2026-09-04 (Asia/Shanghai).  It contains no passwords, private keys, access
tokens, or personal-account identifiers.

## 1. Scope and repository authority

| Authority | Repository | Role |
| --- | --- | --- |
| Desktop / Mercury | `bri12afdsarker96-lgtm/hermes-agent-mercury` | Windows Electron client, owned Chinese UI, enterprise shell, native desktop authentication, packaging and updater. |
| Enterprise server | `bri12afdsarker96-lgtm/Hermes_AI` | Tenant, identity, permission, approval, PostgreSQL/RLS, web console and business APIs. |
| Upstream reuse source | `NousResearch/hermes-agent` | Hermes runtime capability source; it is not a Hermes Project product-delivery repository. |

The implementation order is unchanged: use the existing Mercury seam first,
then upstream Hermes capability, then official SDK/mature library, and add the
smallest owned adapter only when no suitable seam exists.

The prior handoff recorded upstream `main` at `30b83ab7` at its verification
time.  Re-fetch upstream before any new reuse or sync work; do not treat that
old SHA as a current upstream claim.

## 2. Exact anchors and merge posture

| Area | Exact state | Handoff decision |
| --- | --- | --- |
| Mercury `main` | `60c2ed58f71cd78f9b8d9d9721e4ebed63c93ab5` | Baseline only; not the installed enterprise candidate. |
| Desktop package candidate | PR [#70](https://github.com/bri12afdsarker96-lgtm/hermes-agent-mercury/pull/70), `b63d9b9016a78e779c7a97e5687e6a8ddfa826bb` | Draft; installed on the validation PC.  Its CI is green. |
| Desktop dependency chain | [#66](https://github.com/bri12afdsarker96-lgtm/hermes-agent-mercury/pull/66) -> [#69](https://github.com/bri12afdsarker96-lgtm/hermes-agent-mercury/pull/69) -> [#70](https://github.com/bri12afdsarker96-lgtm/hermes-agent-mercury/pull/70) | Keep Draft.  #66 is currently `UNSTABLE`: `Review label gate` and `All required checks pass` are failing merge gates.  Resolve the review-label policy first, then verify that the aggregate gate recovers before any stack merge. |
| Server deployment base | `7e3a4bb8241e584589fa97483c0f8971bbe85ae2` on `codex/server-principal-provisioning-decisions-01` | Prior production candidate baseline. |
| Server platform-login candidate | PR [#156](https://github.com/bri12afdsarker96-lgtm/Hermes_AI/pull/156), `a64dda4520b5ced3671304714dcadb0aeaf7c112` | Draft with all Linux, Windows, WeCom and PostgreSQL/RLS checks green.  The cloud server runs this exact detached SHA for validation; it was not merged. |
| Server companion deployment change | PR [#155](https://github.com/bri12afdsarker96-lgtm/Hermes_AI/pull/155), `85213704bdeec26b6968a324e58f2f69b590b76d` | Green and non-Draft, but its base is the Server integration candidate line rather than `main`; keep that dependency explicit in review and do not silently merge it in this closure. |
| Lifecycle audit line | PR [#148](https://github.com/bri12afdsarker96-lgtm/Hermes_AI/pull/148), `54a46c735d20bf37725233166428878a8e5b06fa` | Green Draft; keep separate from the platform-login change. |

**Do not merge the stacked Desktop chain or the Server candidate merely because
the candidate CI is green.**  The following product acceptance is the next
gate.

## 3. Cloud routing and verified service state

| Public origin | Intended responsibility | Observed state at closure |
| --- | --- | --- |
| `https://agent.qiqiaoban.top` | Hermes gateway and native PKCE callback authority | Active; private backend remains private. |
| `https://login.qiqiaoban.top` | Keycloak login authority | Active. |
| `https://enterprise.qiqiaoban.top` | Neutral Enterprise entry and strict enterprise API | Active; `/api/health` returned `200`; an unauthenticated `/api/whoami` returned `401` as designed. |

Active server services are `hermes-web`, `hermes-hub`,
`hermes-agent-gateway`, Nginx, Keycloak and PostgreSQL.  The Enterprise
runtime source is deliberately in detached-HEAD state at the exact candidate
SHA above.  Never assume it follows a named branch during an update; explicitly
select and verify the intended SHA.

The persisted Enterprise service configuration now explicitly selects the
SQLite tenant/identity authority and enables federated upstream bearer
resolution.  A timestamped backup of that environment file was made on the
server before the update.  No credential value is recorded here.

## 4. Identity and tenant boundary — non-negotiable

The current login is a **platform administrator**, not a tenant user.

- Its Keycloak membership is `platform-admin`.
- Its federated-principal binding has `tenant_id = NULL` and resolves only to
  the existing active tenantless `super_admin` principal.
- The resolver rejects a tenant-bound super-admin binding and rejects a
  tenantless non-super-admin binding.  These cases are covered by PR #156's
  unit, chokepoint and PostgreSQL/RLS tests.
- The platform identity is not a member of `earlybird` and is not associated
  with any tenant.
- **“早鸟科技” has not been created or provisioned.**  It must be created only
  after a successful platform-console login, followed by explicit creation of
  that tenant's first tenant administrator.

This separation is intentional: platform administration creates and governs
tenants; a tenant administrator creates its employees and approval workflow.
Never turn a platform login into a tenant shortcut by adding a tenant group or
by changing the global binding's tenant field.

## 5. What was validated, and what remains for the test owner

Completed evidence:

- PR #156 CI passed across Linux and Windows Python matrices, WeCom, and the
  force-executed PostgreSQL/RLS federated-identity integration path.
- Server source switched to `a64dda45`; Python compilation passed before the
  service restart.
- The federated binding, Keycloak group boundary and service configuration were
  validated without exposing credentials.
- Internal and public health probes passed after the restart; unauthenticated
  enterprise API access remained denied.

The next colleague owns these acceptance tests, in this order:

1. Fully quit the installed Desktop client (including tray process), reopen it,
   and perform a fresh native login with the platform administrator.  A fresh
   sign-in is required because a pre-change ID token lacks the new group claim.
2. Verify the Desktop lands in the platform console and not in a tenant UI.
   Capture sanitized client/network evidence that authenticated `whoami`
   succeeds.  Do not paste bearer tokens into issues or documents.
3. From the platform console, create **早鸟科技** and only then create its first
   tenant administrator.
4. Verify tenant administrator, supervisor request, enterprise-admin approval,
   employee activation, rejection/withdrawal and offboarding flows from the
   Gate C checklist.  Record the actor, tenant, expected authority and API/UI
   evidence for each step.
5. Use a second tenant or test tenant to prove that users, audit records,
   knowledge and action endpoints cannot cross tenant boundaries.  Then test
   platform-only operations separately.
6. Re-run/reconcile the failed historical checks on Desktop PR #66, then run
   the packaged-client smoke on the same build intended for release.  Only
   after that review may the team decide a merge order.

## 6. Local-worktree closure performed

No currently active, named product work branch is ahead of its tracked GitHub
branch.  This does **not** mean the object database contains no local-only
history.

| Location | Closure result |
| --- | --- |
| Mercury root | Remains at `main@60c2ed58`.  One user-owned contributor-email mapping is modified locally; it is not product code and was deliberately neither committed nor uploaded. |
| Hermes_AI root | Remains at `claude/hermes-desktop-multi-ai-phone-aiw5mr@3bc2870`.  Existing local worktree folder and candidate archive files were preserved untouched. |
| Server candidate worktree | Clean at `a64dda45`, pushed as PR #156. |
| Six clean auxiliary Server worktrees | Fast-forwarded to their tracked remote branches; no history rewrite and no unpushed local commit. |
| Local `codex/principal-lifecycle-audit` name | Only a local alias for the already-pushed `origin/codex/principal-token-reissue` commit `052fd0ad`; it contains no unique work to upload. |
| Historical Server object lines | Local history still includes commits that are not referenced by `origin` (a refreshed ref scan found 28; another audit found 31 under a different ref set).  They may contain source/test changes, but have no active remote branch or review target.  Do not bulk-delete or bulk-push them; inventory each candidate and create a narrowly scoped review branch only when a maintainer identifies it as needed. |

## 7. Rollback and operating safeguards

If the fresh platform-login acceptance fails, do not bind the platform account
to a tenant as a workaround.  Preserve sanitized logs, stop the rollout, and
diagnose the issuer/provider/external-org mapping against the deployed SHA.

The candidate rollback point is `7e3a4bb`.  Any rollback must explicitly select
that SHA, restore the timestamped service-environment backup if configuration
is implicated, restart `hermes-web`, and repeat the public health plus strict
unauthenticated API checks.  The additive nullable federation-column migration
is intentionally non-destructive; do not drop it during a diagnostic rollback.

## 8. Prohibited shortcuts

- Do not record passwords, private keys, bearer tokens, bootstrap secrets or
  personal-account identifiers in GitHub, screenshots, test evidence or chat.
- Do not create “早鸟科技” before platform-console acceptance.
- Do not associate the platform administrator with any tenant, including
  `earlybird`.
- Do not assume server detached HEAD automatically follows `main` or a PR
  branch.
- Do not merge the Draft PRs or package a release solely from CI; retain the
  human product acceptance evidence above.
