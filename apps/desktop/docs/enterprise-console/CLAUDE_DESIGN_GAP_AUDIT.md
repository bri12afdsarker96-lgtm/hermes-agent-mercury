# Claude Design Gap Audit — Enterprise Desktop

Status: **W5 source-of-truth audit**

PR: `#9 P3-M4A-UI · Hermes Enterprise Desktop Visual Baseline v1`

Audited implementation head before this document: `8e0e210291bacd634d578db5eac85774ced35d13`

Design source: user-supplied **Hermes Enterprise Desktop Design System.zip**

Design namespace fingerprint: `HermesEnterpriseDesktopDesignSystem_89ae01`

Primary design artifact: `Hermes Visual Baseline v1.html`

## Authority rule

For this UI line, authority is split deliberately:

1. **Visual / layout / density / information hierarchy / page composition:** the supplied Claude Design package is authoritative.
2. **Implementation mechanics:** Mercury's existing Electron/React shell, plugin SDK, theme engine and shared primitives remain authoritative. Do not create a second shell/router/theme engine merely to copy the standalone design-kit delivery runtime.
3. **Functional truth / permissions / API / tenant authority:** current Hermes server contracts and current PR #8 functional controller are authoritative. The ZIP's `TRUTH_MATRIX.md` captured an older runtime point-in-time and MUST NOT regress newer server truth.
4. Preview fixtures in the ZIP (`data.js`, demo role switcher, fake KPI numbers, sample people/groups/amounts) are `DESIGN_PREVIEW_ONLY` and MUST NOT become runtime facts.
5. The unlicensed RTWS ShangGo G0 binaries in the supplied package remain non-distributable in this repo. The accepted Source Han Sans CN substitution remains.

This means a newer real server capability is mapped into the approved visual language rather than hidden or downgraded to match an older design fixture.

## Scope rule

Mercury's host chrome is an architecture exception: the existing application title bar / global navigation / status areas remain host-owned. The audit therefore does **not** require cloning the standalone kit's outer Electron shell as a second shell.

That exception does **not** waive the Enterprise page composition. Inside the Enterprise product surface, page hierarchy, labels, KPI geometry, master/detail layouts, tables, filters, drawers/dialogs, status treatments and responsive behavior must follow the supplied design unless current functional authority requires a truthful adaptation.

## Classification

- `EXACT` — visually and structurally equivalent to the supplied design, aside from explicit architecture/licensing/current-authority exceptions.
- `MINOR` — same composition and interaction hierarchy; only small spacing/copy/token substitutions remain.
- `MAJOR` — materially different composition, information hierarchy, interaction model, missing regions or page geometry.
- `NOT_IMPLEMENTED` — the current-authority page has no valid completed design implementation yet; an existing functional view is not accepted as the visual baseline.

## Result summary

| Classification | Pages |
| --- | --- |
| EXACT | **none** |
| MINOR | **none** |
| MAJOR | Dashboard, Tasks, Reminders, Human Handoff, Alerts, Business Follow-up, Conversations, Knowledge, Provider, Identity, Usage & Budget |
| NOT_IMPLEMENTED | WeCom status, Audit evidence |

**No current page is accepted as Claude Design-conformant.** Existing screenshot snapshots are implementation-history snapshots only, not design-acceptance evidence.

## Page-by-page audit

| Page | ZIP target | Current PR #9 implementation | Classification | Required reconciliation |
| --- | --- | --- | --- | --- |
| Dashboard / 工作台 | Three role-specific compositions: Operator `我的工作台`, Supervisor `团队工作台`, Tenant Admin `运营总览`; designed KPI rows, worklists, schedule/trend/knowledge/AI suggestion/system-status regions | One shared health/alerts/capabilities/session dashboard with role-specific English heading only | **MAJOR** | Restore role-specific information hierarchy and design geometry using real data only. Missing aggregate facts must render truthful skeleton/empty/unavailable states rather than invented numbers. |
| Tasks / 任务 | Header + filter/search controls + semantic table + selected-task detail panel + history timeline + create dialog + retry/escalate/close controls | Single `Task queue` list with inline controls and inline create flow | **MAJOR** | Recompose into design table/master-detail/dialog structure while preserving current real endpoints, idempotency and server-owned state machine. |
| Reminders / 提醒 | Filter/search + grouped/list presentation + detail panel + timeline + create dialog + loading/empty/503 states | Single `Schedule` list with inline create/cancel | **MAJOR** | Restore design interaction hierarchy and state presentation; keep current IANA timezone and authoritative refetch semantics. |
| Human Handoff / 人工接管 | Design kit routes `takeover` through the Conversations visual surface, with conversation context, detail panel and takeover drawer | Separate standalone handoff queue page | **MAJOR** | Reconcile handoff into the approved conversation/takeover visual language without changing the real claim/reply/requeue authority. |
| Alerts / 告警 | Four severity/recovery KPI cards + filters/search/source selector + DataTable + selected alert detail + explicit read-only capability messaging | Two simple panels: active alerts + source errors | **MAJOR** | Restore KPI/filter/table/detail composition; no acknowledge/silence/assign controls unless server authority later adds them. |
| Business Follow-up / 业务跟进 | Reference-backed master/detail page: search/filter/sort/pagination, selected record detail, action strip, notes, timeline | Real list/detail/history with status filter and responsive sheet | **MAJOR** (closest current page) | Keep the real SC1 read model and responsive sheet seam, but restore the reference composition, toolbar, detail hierarchy and approved Chinese visual copy. Do not reintroduce forbidden follow-up writes. |
| Conversations / 企业会话 | Reference-backed multi-region conversation workspace: KPI row, conversation list, transcript/detail context, right detail panel, takeover drawer | Read-only inbound/outbound evidence tabs with expandable outbound attempts | **MAJOR** | Rebuild visual composition around current authoritative inbound/outbound/attempt facts. Keep `unknown_delivery` no-blind-resend rule and no invented reply/retry authority. |
| Knowledge / 企业知识 | Reference-backed upload/published/candidate tables + selected file detail tabs/chunks and review actions | Functionally rich candidates/uploads/sources sections, but not the approved table/detail visual composition | **MAJOR** | Preserve all current real knowledge routes and DEV capability truth; transpose them into the supplied tables/detail/tabs geometry. |
| Provider | Current-provider / health / key-state summary panels + provider list + selected provider detail + key dialog | Single provider configuration list with actions | **MAJOR** | Restore the summary/list/detail/dialog composition. Key material remains write-only and must never be displayed. |
| Identity / 员工与权限 | Members table + selected principal detail/tabs; older design showed principal writes disabled and ChannelBinding unavailable | Two side-by-side lists: Principals + now-real Channel Bindings with create/revoke | **MAJOR** | Use the design's member master/detail language, but update the old ChannelBinding blocked state to current real SC2 authority. Do not visually regress the landed capability. |
| Usage & Budget / 用量与预算 | Four KPI cards, budget/limit panel, unavailable provider allocation region, consumption overview table | Two KPI cards + Availability explanation | **MAJOR** | Restore approved partial-state geometry. Real-time spend/usage remains `—`/unavailable until a server endpoint exists. |
| WeCom status / 企业微信 | ZIP has an admin nav entry but no current-authority dedicated SC5 status screen; the kit maps the route to Conversations at its older runtime point | Dedicated real `/api/wecom-status` page with association/credential/bindings KPIs and two panels | **NOT_IMPLEMENTED** | The current functional page is valid but cannot self-authorize its visual baseline. Build a dedicated SC5 presentation using the approved design system, current WeCom facts and no secret/callback-health inference. |
| Audit evidence / 审计 | ZIP's page reflects older `BLOCKED` runtime and a future DESIGN_TARGET table/contract view | Dedicated real `/api/audit-list|detail|correlate` evidence page | **NOT_IMPLEMENTED** | Old blocked copy is obsolete. Reuse the approved audit table/filter/evidence visual language, but keep current SC4 read-only evidence semantics and permanently omit replay/re-execution. |

## Global gaps

### 1. Language and information hierarchy

The supplied Enterprise Desktop is Simplified Chinese-first. Current PR #9 production pages are predominantly English. This is a design divergence, not a functional requirement. Product labels and page copy should converge on the supplied Chinese hierarchy while preserving machine identifiers and server enum values where exact values are operationally useful.

### 2. Role-specific Dashboard

Current code changes only title/purpose by role. The design defines materially different Operator, Supervisor and Tenant Admin dashboards. They must not be collapsed into one generic health dashboard.

### 3. Enterprise navigation

The design has role-aware grouped navigation. Mercury host chrome must not be duplicated; however the current flat internal sub-nav is not accepted as the final design merely because it is architecturally convenient. The implementation must express the approved role/group hierarchy through the existing host/plugin seams without adding a second application shell.

### 4. Current authority has advanced beyond the ZIP truth snapshot

The ZIP's original truth matrix predates current landed/stacked server work. Current code truth wins for capability availability:

- WeCom status is now real and tenant-scoped.
- ChannelBinding list/create/revoke is real.
- Conversations are current-authority read models over inbound/outbound/attempts.
- Follow-up has authoritative read models and remains Phase-1 read-only.
- Audit list/detail/correlate is real and remains evidence-only.

The visual reconstruction MUST update old `BLOCKED/PARTIAL` design copy accordingly rather than regress functionality.

## W5 reset

The pre-audit four `enterprise-operator-home-*` snapshots were generated from a UI that materially diverges from the supplied Claude Design source. Therefore:

`VISUAL_REGRESSION = NOT_ESTABLISHED`

`CLAUDE_DESIGN_CONFORMANCE = NOT_ESTABLISHED`

`LEGACY_DASHBOARD_SNAPSHOTS = IMPLEMENTATION_HISTORY_ONLY`

A no-diff pass against those four images MUST NOT be reported as design acceptance.

## W5 continuation plan

1. **W5-A — Source freeze + Gap Audit**: this document. COMPLETE once committed on the exact PR #9 branch.
2. **W5-B1 — Reference-backed primary screens**: role dashboards, Follow-up, Conversations/Handoff, Knowledge. Reconstruct from supplied reference screens and component kit, preserving current API authority.
3. **W5-B2 — Kit-defined screens without reference PNGs**: Tasks, Reminders, Alerts, Provider, Identity, Usage. Implement directly from the supplied JSX/component composition, not from the current simplified pages.
4. **W5-B3 — Current-truth reconciliation screens**: WeCom and Audit. Reuse the approved visual language while replacing obsolete runtime truth with current server contracts.
5. **W5-C — Responsive evidence**: capture all authorized final screens at `1280×720`, `1440×900`, `1672×941`, and `1920×1080`; do not update baselines until each screen has been manually compared with the supplied design target and current-authority exceptions are documented.
6. **W5-D — Independent audit**: visual diffs, keyboard/focus/a11y, overflow/truncation, permission-role views and no-fake-data review.

## Gate

`READY = NO`

`MERGE = NO`

`C1-B = NO`

`PREPROD = NO`

`PRODUCTION = NO`

No Ready/Merge transition is authorized by this audit.
