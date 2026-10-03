# Web 0.20.8-fix2 — receivable drill-down and single-task details

Published 2026-10-02. Web-only release with an additive, read-only reporting projection. Desktop remains 0.20.7; no installer or updater publication.

## Delivered

- Replaced the overview identity card with six currency-separated money shortcuts: today due, unpaid total, overdue unpaid, active unpaid, closed/cancelled unpaid, confirmed receipts. Each selects the matching task collection. Overview navigation clears previous report filters and pagination to preserve the overview scope.
- Receivables retains base search/person/team/status/date filters, stable summary cards, daily balances/counts, and one drill-down task list. Selecting a new metric clears the previous metric/day without clearing base filters. Current/history and processing-time ordering remain available.
- Today/daily balances use current expected receipt date in Beijing time and remaining balance. Unpaid total includes unresolved closed/cancelled balances. Existing original-due-date aging semantics remain unchanged and are labeled. Currencies are not combined; summaries are calculated before pagination.
- Receivables, overdue and reminder-center detail entry points use the same web-only selected-task dialog. Existing receipt ledger and server-authorized actions are reused. Closing restores source focus without resetting its filters.
- Made receivables search visible when empty and separated “查询已有应收款” from “新建应收款”. Other UI audit items were not silently included.
- Shared renderer changes are optional composition props. Installed desktop behavior and artifacts are unchanged.

## Verification

- Backend report/follow-up HTTP/E2E: 42 passed. Local PostgreSQL tests used the existing advisory-lock-isolated compatibility database because the test account cannot create a fresh database; no production financial test writes.
- Web unit tests: 14 passed. Shared app/runtime/reminder/report/ledger regression: 47 passed.
- Strict web TypeScript and production build passed. Built-web Playwright: 10 passed using isolated API fixtures, including all six overview mappings, daily/search/current/history drill-downs and selected-task details.
- Production service active, PID 2378170. Normal-certificate HTTPS root, main JS and CSS hashes match. Three protected read endpoints return 401 anonymously. Deployed projection passed a synthetic in-memory money test before service switch.
- No database migration or production business writes. No new authenticated production financial workflow or original-network visual acceptance is claimed. The complete frontend suite is not claimed green; prior unrelated voice-test failures are documented in RELEASE_0208.md.

## Release evidence

- Current release: `/opt/hermes/releases/enterprise-web-v0.20.8-fix2-20261002`.
- Previous compatible release: `/opt/hermes/releases/enterprise-web-v0.20.8-20261002` (retained, with all old assets).
- Runtime remains the previous v0.20.0 Python/dependency environment; do not remove that release.
- Archive SHA256: `9e807733c9d49a2e0d412710a694930548811b7e647fdf0358e1f456470e0b7d`.
- Index SHA256: `e50ec91cb6225a4d0d9f057b1a416739912c10858e10238ed2c8852ac8ffac7d`.
- JS: `index-DEiH-t8W.js`; CSS: `index-D8-A2WOV.css`.
- Report module SHA256: `a63a1f434f4e82c7f40b94f36dc2c89996c21ec41a6c20774d6839e9d71d9be1`.
- Desktop update feed before/after SHA256: `c07ed81ada597ab2a11e8dead93e5505027da02a82cacdec0ff5801796fb69bf`.
- Server evidence: `release-manifest.json`, `deployment-result.json`, `previous-service-dropin.conf` in the current release. Reproducible guarded deployment script: `releases/publish-0.20.8-fix2.py`.

## Recovery and acceptance

To roll back this hotfix, restore the saved `previous-service-dropin.conf` to the exact existing `zzzzzzzzzzzzzzzzzzz-web-v0208.conf` service override, daemon-reload and restart hermes-web. The previous compatible 0.20.8 backend supports existing receipt history. Do not roll back financial data or select the old 0.20.0 backend. Retain both directories and hashed assets.

Refresh the web page. Check each overview amount against its selected receivable list; test search then alternate cards/days; open and close one overdue task to confirm filters remain. Real receipts/status changes should only be performed by the user on intended business records.
