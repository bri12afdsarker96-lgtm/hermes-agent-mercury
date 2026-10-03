# Web 0.20.8-fix5 — overview visibility

## Changes

- Hide the overview task preview on web, retaining its implementation.
- Restore the seat activity table independently of the hidden operations dashboard. Existing server-authoritative role scope and data refresh remain unchanged.
- Keep operations metrics, employee groups, subordinate reminders, server diagnostics and quick-work entries hidden on web.
- Native desktop presentation is unchanged; no desktop build or update-feed publication.

## Verification

- Web typecheck and production build passed.
- Shared UI regression: 16 tests passed, including native/web visibility and a populated seat activity row.
- Production-bundle browser regression: 29 tests passed, including scrolling, narrow layouts and amount/task navigation.
- Reviewed overview scroll screenshot. Browser regression uses controlled API fixtures, not production account data.
- Static-only publication verified through HTTPS GET; service PID unchanged (2518807). Reporting backend and desktop update-feed hashes unchanged.

## Release evidence

- Archive SHA256: `b6ded3cc88ae4aa8889291fb296b9b4d664a22041720cceb14ef8f3ccfd5f9b3`
- Published index SHA256: `a3ee026b28ea14f15738b6b3ba9a6e9bace38be9423487b67e448938bfcef087`
- JavaScript: `/assets/index-pwZJu_P1.js`
- Live static directory: `/opt/hermes/releases/enterprise-web-v0.20.8-fix4-20261003/enterprise_web`
- Rollback index and deployment evidence: `/opt/hermes/releases/enterprise-web-v0.20.8-fix5-20261003/`
- No service restart or backend configuration changes.
