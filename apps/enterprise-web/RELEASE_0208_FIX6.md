# Web 0.20.8-fix6 — administrator task archival and quieter settings

## Changes

- Enterprise administrators may view all current members' personal scheduled reminders and archive current reminders/follow-ups using an explicit confirmation. Other roles retain their existing scope and financial action permissions.
- Deletion stops pending reminder occurrences and records `管理员删除`, actor and timestamp. Follow-up balances, receipts and business records remain intact; deletion is not payment confirmation. Historical records are retained and the financial history supports the administrator-deletion filter.
- Answer configuration moves under Knowledge retrieval → Advanced settings, collapsed by default. Save, update, defaults and removal remain available; configuration API behavior is unchanged.
- Simplify introductions in reminders, knowledge, receivables, staff governance, tools, notification channels and persona settings. Keep destructive confirmations, credential handling guidance, retrieval-rebuild availability warnings and financial definitions.
- CNY primary amount cards use ¥ without a redundant currency heading; other currencies remain explicitly identified and currency-scoped navigation is unchanged.
- Native presentation is preserved; no desktop package or updater-feed publication.

## Verification

- Web typecheck and production build passed.
- 32 production-bundle browser tests passed, including full-scroll/narrow layouts, settings save payload and preserved draft, task deletion confirmation/history, amount drilldowns and role-dependent actions.
- 30 shared UI tests and 17 web unit tests passed.
- Backend suite: 129 tests passed against real isolated PostgreSQL and SQLite paths; final targeted reporting/deletion rerun: 20 passed. Covers tenant isolation, operator/supervisor denial, audit idempotency, restart persistence and unchanged balances.
- Browser tests use controlled API fixtures. No production task/payment mutations are used for acceptance.
- Reviewed the collapsed configuration page screenshot.

## Publication

- Guarded backend/web release script checks the live baseline, copies the previous release, verifies assets and protected endpoints, and rolls back the service override on failed checks.
- One backward-compatible SQLite audit column (`resolved_by`); use SQLite backup API before startup migration. Keep the prior release and reminder backup. Do not restore a database snapshot over newer user writes during code rollback.
- Expected index SHA256: `ed3637c14dbe12481f03602176143d079a0f3055905eb8da5285d193b3dd2cf2`.
- JavaScript: `/assets/index-5IfKT2bK.js`.
- Desktop feed baseline: `c07ed81ada597ab2a11e8dead93e5505027da02a82cacdec0ff5801796fb69bf`.
- Published successfully to `/opt/hermes/releases/enterprise-web-v0.20.8-fix6-20261003`; service PID `2556782`.
- Archive SHA256: `27a65c84afd2d22f9006e82b0eac435a426f6c5ab04fa639a32a9103022e8974`.
- Certificate-verified HTTPS GET returned the expected index and matching JS/CSS hashes. Protected reminder, follow-up and reporting APIs return 401 without authentication.
- SQLite backup: `/opt/hermes/backups/web-v0208-fix6-20261003/reminders.sqlite3`; integrity checked before publication. Old release retained for code rollback.
- Desktop updater feed hash verified unchanged after publication. No production task or payment was created/deleted to test the feature.
