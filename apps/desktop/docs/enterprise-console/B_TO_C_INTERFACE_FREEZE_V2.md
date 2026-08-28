# B_TO_C_INTERFACE_FREEZE_V2 — Enterprise Console

> Canonical B→C consumption freeze for PR #8, WAVE-7. Code is authority.
> Historical `INTERFACE_FREEZE.md` and `WRITE_SURFACE_CENSUS.md` remain evidence,
> not the live status table. `READY = NO`; `MERGE = NO`; Phase-2 is frozen.

## Authority and transport invariants

| Contract | Frozen value |
|---|---|
| Agent API origin/source | Existing Hermes desktop gateway (`resolveRemoteBackend`); it mints/refreshes the native OAuth credential. |
| Enterprise API origin/source | Main-owned `HERMES_DESKTOP_ENTERPRISE_ORIGIN`, normalized by `normalizeEnterpriseApiOriginOrNull`; it is distinct from the gateway and is never renderer input. No same-origin or reverse-proxy assumption is made. |
| Native bootstrap | Main obtains the existing native bearer, federates it to the configured Enterprise origin, and returns only `{ok, sessionId, baseUrl}`. |
| Bearer boundary | Main process only. Renderer/preload expose no token-bearing connect API; all requests are fenced by primary WebContents + opaque `sessionId`. |
| Session FSM | `UNKNOWN` (no native session), `AUTHENTICATED` (whoami succeeds), `UNAVAILABLE` (transient Enterprise failure), `REVOKED` (401/403). An older probe may not overwrite a newer logout/probe result. |
| Recovery | Existing `onConnectionApplied` drives re-probe; outage backoff is bounded at 2/4/8 seconds. No second OAuth, PKCE, token store, retry engine, plugin manager, or query engine. |
| Logout/revocation | Native logout/token death destroys main-held Enterprise sessions. 401/403 clears transport and identity; window destruction removes its sender session. |
| Capability truth | `effective_permissions` and `product_capabilities` originate only in `/api/whoami`. `SystemCapability["desktop"]` is not an Enterprise entitlement; no `product_capabilities["enterprise_console"]` is invented. |

`Desktop != authority`; it only mirrors server facts. Server endpoints must derive
tenant/principal from the authenticated bearer, apply row scope on every request,
and fail closed. A bare `super_admin` without tenant context must not enumerate a
tenant. Renderer action gates are display control only; server enforcement remains
authoritative. Hermes_AI PR #131 at `b37099f0c59a56c1c651e611ec7c35456de48b90`
establishes this server authority: tests #528 `dataplane-pg` executed successfully
for server-console read models, SC2 bindings, and SC5 WeCom status; mcp-seven-step
#232 also succeeded.

## SC1–SC6 consumption contract

| Capability | Server route / method | Permission / row scope | Mutability and error taxonomy | Desktop consumer / seam / truth |
|---|---|---|---|---|
| SC1 Follow-up | `GET /api/followup-list`, `GET /api/followup-detail?followup_id=…`, `GET /api/followup-history?followup_id=…` | `followup.read`; server owner scope remains narrowing-only | Read-only. 400/404/403/5xx render QueryBody error; no admin write UI. | `page-followup.tsx`; `useConsoleQuery` + encoded id; `READ=READY`, `CONTROL=NOT_ESTABLISHED`. |
| SC2 ChannelBinding | `GET /api/channel-bindings-list`, `GET /api/channel-bindings-status?binding_id=…`, `POST /api/channel-binding-create`, `POST /api/channel-binding-revoke` | `channel.binding.manage`; tenant-admin only; revoked history stays visible | Status returns `{binding:{binding_id,principal_id,channel,external_subject,status,version,created_ts,updated_ts,revoked_ts,revoked_by_principal_id}}`; 400/404/503 are explicit. Create/revoke refetch. | `page-identity.tsx`; list/create/revoke consumed. Schema is established authority evidence; its dedicated desktop consumer is a follow-up consumption slice, not a schema hold. |
| SC3 Conversations | `GET /api/conversations-inbound`, `GET /api/conversations-outbound`, `GET /api/conversations-attempts` | `conversation.read`, never `delivery.read`; tenant scope server-derived | Evidence read only. Error uses QueryBody. | `page-conversations.tsx`; `unknown_delivery != delivered` and `unknown_delivery != blind resend authorization`; `READ=READY`, `BLIND_RESEND=NO`. |
| SC4 Audit | `GET /api/audit-list`, `GET /api/audit-detail?event_id=…`, `GET /api/audit-correlate?resource_ref=…` | `audit.read`; tenant-admin only; bare super-admin performs no request without a tenant | Evidence read only; 400/404/503 are explicit. No replay/re-execution. | `page-audit.tsx`; encoded selectors; `READ=READY`, `DESTRUCTIVE_REPLAY=NO`. |
| SC5 WeCom | `GET /api/wecom-status` | `channel.binding.manage`; server tenant scope | Read-only status; unavailable/forbidden surface honestly. Corp secret/callback configuration is server/deployment authority. | `page-wecom.tsx`; `READ=READY`, `CONTROL=NO`. |
| SC6 Metrics | Existing `GET /api/health`, `GET /api/metrics`, `GET /api/metrics/alerts` | `metrics.view` and server scope | Read-only; QueryBody errors; no local authority. | `page-dashboard.tsx`, `page-alerts.tsx`; existing metrics surface. |

## Control truth and error/refetch rule

All real actions reuse `ConfirmAction`/`FormAction`: only a resolved server write
invalidates its React Query key and refetches authoritative state. 401/403/409,
network, unavailable, and server-module errors keep the form/dialog open and do
not create local success. Action controls require the action-specific effective
permission (`biztask.*`, `reminder.write`, `inbox.*`, `kb.upload`/`kb.commit`/`kb.delete`, provider and binding
permissions); this UI gate does not replace server checks. Task/reminder create
uses one UUID idempotency key per form intent, retaining it across a failed retry.

## Cross-repository authority evidence

`SC2_STATUS_SCHEMA = ESTABLISHED`; `SERVER_RBAC_RLS_EVIDENCE = ESTABLISHED`.
Hermes_AI #131 records two-tenant RLS, owner-only operator/supervisor scope,
tenant-admin scope, cross-tenant denial, revoked binding history, minimized
projections, audit restrictions, and WeCom tenant counters. Mercury does not
duplicate those PG/RLS tests; it references the frozen server authority evidence.

Docker #26's workflow is successful but its build/publish/merge jobs were
   skipped; it is not Docker build evidence. Desktop E2E must report PASS, not
   SKIPPED, on the exact closure head.
