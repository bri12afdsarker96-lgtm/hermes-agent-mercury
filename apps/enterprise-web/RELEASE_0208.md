# Web 0.20.8 — desktop 0.20.7 baseline

Published 2026-10-02, web only. The desktop package is still 0.20.7, and its updater feed was not changed. Shared renderer edits are staged for a future desktop release only after web acceptance.

## Delivered

- Inherited 0.20.7 overdue navigation, fixed 320px preview, owner/status/search filters, terminal-state history; structured reply cards and account security retained.
- Independent reminder reads with visible stale/error states, exact retry facts, persisted 30-minute repeat metadata, saved cue enable/volume preferences and bundled MP3.
- Server-calculated receivables dashboard: per-currency totals, authorized person/team/date/status/search filters, paginated drilldown, group balances and original-due-date aging.
- Partial payments and actual receipt dates, append-only reversals, notes and authorized handover; uncertain submissions retain the exact operation in session storage for safe retry.
- Readable single-column detail modal and complete shared-control styling in the browser build.

## Evidence

- Renderer typecheck passed; focused UI tests 24 passed. Built-web Playwright 1 passed.
- Backend regression 112 passed + additive migration test 1 passed. Production read-only reports passed for three roles; no production financial test writes.
- Broad UI suite retains 5 known voice-test failures expecting baseline-frozen microphone/read-aloud controls. Not a claim of a fully green suite, and those features remain frozen.
- Build: `npm run build -- --outDir dist-web-0.20.8`; browser test: `npx playwright test --config playwright.config.ts` from this package.
- Server release `/opt/hermes/releases/enterprise-web-v0.20.8-20261002`, JS `index-DfoHWi0Q.js`, CSS `index-BFr28uGW.css`. Server-side HTTPS GET and 70 static asset hashes passed; anonymous private APIs reject access.
- Desktop feed SHA256 unchanged: `c07ed81ada597ab2a11e8dead93e5505027da02a82cacdec0ff5801796fb69bf`.
- User-side VPN/browser acceptance remains: workstation public HTTPS reset and private address timeout prevented that final network check. Do not claim the user's VPN path was tested successfully.

Open **应收款跟进 → 收款统计与客户台账 → 查看与处理** after refreshing the web page. Historical records remain searchable; no data is deleted to hide terminal states. Audio may require a browser interaction and does not run with the browser closed.
