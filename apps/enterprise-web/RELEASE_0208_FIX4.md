# Web 0.20.8-fix4 — business mappings and full-page layout

Status: published 2026-10-03. Desktop package and update feed unchanged.

## Scope and audit disposition

| Audit | Resolution in this iteration |
| --- | --- |
| F01–F03 | Amounts first, then authorized organization team IDs and dependent people. Team changes reset the person and page. Status/history/metric conflicts are normalized; active filters are shown. |
| F04–F06 | Reminder and overdue filters use authorized scope options, explain invalid selections, and do not silently widen scope. Transfer candidates use team/person and are revalidated before submitting. |
| F07–F08 | Failed group creation retains draft; invalid managers cannot submit. Unsupported unassignment is no longer offered as an executable option. Switching model provider clears incompatible credentials and editing identity. |
| BP01 | Financial history remains visible to the tenant administrator after identity deletion/deactivation; unresolved or active receivables prevent deletion. Creation, reservation, finalization and repository deletion share an owner transaction lock, with identity rechecked inside it. Both deletion-first and creation-first orders passed real PostgreSQL tests. No authentication revival or new cross-role financial permission. |
| BP02 / BP04 | Authorized owner/type/state filtering occurs in storage before materialization; the enterprise projection no longer uses the capped scheduler list. Single personal-task details read by ID. Exhausted delivery is still unfinished and can be overdue. This removes truncation but is not a new cursor-pagination API. |
| BP03 | Current owner may append a genuine late receipt to closed/cancelled records with a balance. The original terminal state and stopped reminders remain; closure is not payment. |
| BP05–BP07 | Storage failure is not converted to a successful empty reminder list. Scoped seat count is additive for compatibility. Web personal reminder creation/display/rescheduling uses Beijing time explicitly. |
| S01–S15 | Four primary money cards; remaining balances retain clickable composition. Daily amounts are a horizontal strip with separate date controls. Creation is a focused dialog preserving draft. History/current and metric selections share one task list. Group/object aggregation is secondary. |
| S16–S23 | Reminder work starts with pending tasks, with separate creation/history/settings. Reuse single-task detail; unified refresh updates status and ledger. Secondary ledger operations collapse. |
| S24–S29 / V | Knowledge, model, staff and tools sections use focused panels; drafts survive panel changes. Visible inputs, narrow-width layout, scroll access, assistant composer and notification overlay checked in browser fixtures. |
| Additional action audit | Owner open tasks allow rescheduling; pending confirmation exposes establishment, not receipt. Task actions come from fresh selected-task capabilities. Manager-only transfer explains why financial actions are absent. |
| Latest overview request | Operations data dashboard, server time/reminder rules, subordinate reminders, employee groups and bottom quick-work section are hidden only in the web overview. Module source is retained; other routes and native presentation remain. Money overview and task preview remain visible. |

## Deliberately not changed without a product decision

- BP08: Whether personal reminder titles are private or readable by managers. Existing server authorization is not widened. Hiding the overview module is not an API security change.
- BP09: Whether disabling the AI chat capability must also disable reminder AI parsing. Existing capability semantics remain; manual reminders are preserved.
- Managers acting on another owner's financial records, reopening closed workflows, and moving employees out of all teams are not inferred from a missing button.
- Historical records whose owner was already deleted remain traceable, but this release does not impersonate that owner to record money.

Agency Code Reviewer, UI Designer and UX Architect methods informed the mapping, state/permission and scrolled-layout checks. These reviews do not constitute a whole-system security certification.

## Verification and release evidence

- Web TypeScript and production build passed; web unit tests: 16 passed.
- Shared renderer targeted tests (including web-only hiding versus native visibility): 40 passed across 7 files.
- Built-web Playwright full suite: 29 passed. This includes amount-to-task links, team/person cascade, four task-detail entrances, state-based actions, receipt and note submission against fixtures, cookie/logout behavior, all function panels and scrolled/narrow layouts (1920/1366/1024/960/959/683 CSS widths where applicable).
- Fixture screenshots reviewed for overview and receivables; overview money cards occupy a full row and the task preview follows. Five user-named overview modules remain in code but are not visible in web presentation.
- Backend real PostgreSQL/runtime role + HTTP + SQLite tests: 127 passed, no skipped tests; one deliberately unshipped BP09 policy test was subsequently removed. After that exact policy rollback, all 7 affected personal-reminder/real-HTTP tests passed again (remaining full-suite population 126, not rerun in full). The concurrency code did not change after its successful run.
- No production financial test mutations. Isolated fixtures do not establish live all-role acceptance, screen-reader conformance or actual OS/browser 200% zoom testing. Scope-limited full reminder materialization removes truncation, but very large-volume cursor pagination remains an optimization.

Publication uses `releases/publish-0.20.8-fix4.py`: verify old source/index/feed hashes, stage a copy of the current release, overlay nine reviewed Python modules and hashed web assets, compile/import with the existing server runtime, then atomically update the web service override. On verification failure, restore the old override and restart the old release. No database migration, SQL privilege change, client installer or update-feed write is included.

## Production verification

- New release: `/opt/hermes/releases/enterprise-web-v0.20.8-fix4-20261003`.
- Previous release retained: `/opt/hermes/releases/enterprise-web-v0.20.8-fix2-20261002` (its static UI was fix3).
- Bundle SHA256: `4d99613c2901b4fcd20ed680527464f6ff13419b914b0d02daddd7248f502eb9`.
- Served index SHA256: `949c79e28678d049dca4a2c40d4b87016aa3a1914c78428f3d5067d0e97ffb0f`.
- Served JS `index-DD3FwrHJ.js`: `c8b6b88b4b9b6bd79f22a5c2cfe66b78b23093361ed5ff0028f1c711c48b5772`.
- Served CSS `index-Bmni94Qi.css`: `489a4021279a34f18ec05272335a917c49629833b379e98a53ea775340eb310f`.
- Verified normal-certificate HTTPS from the server with local DNS resolution, served asset hashes and staged source hashes; web service active, PID `2518807`, with the new `PYTHONPATH`.
- Workstation normal-certificate public HTTPS GET also returned the new index and JS/CSS references. The handler does not implement HEAD (501), so acceptance uses GET. After restart the service was still active and its error-priority journal contained 0 lines in the checked two-minute window.
- Four protected read endpoints still return 401 without authentication. No authenticated production financial operations were performed.
- Desktop updater hash unchanged: `c07ed81ada597ab2a11e8dead93e5505027da02a82cacdec0ff5801796fb69bf`.
- Only `hermes-web` restarted. Running hub has no embedded web/enterprise gateway flag; the separate agent gateway and embedding services were left unchanged. Concurrency claims cover the audited application entry points, not arbitrary external SQL writers.
- Server-side manifest and deployment result are retained under the new release, alongside `previous-service-dropin.conf` for rollback. Restore that exact override and restart only `hermes-web` if rollback is required; do not restore or alter business databases.
