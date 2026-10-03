# Enterprise desktop 0.20.8 — local installer only

## Scope

- Browser and desktop now compose the same enterprise workspace: cash overview,
  report-to-task drilldown, team/person filters, daily receivables, single-task
  details, receipt ledger, administrator archival, and confirmed write-off.
- Native login, OS-encrypted remembered credentials, VPN setup, reminders and
  package update transport remain owned by Electron; no browser bridge is loaded
  by the desktop entry.
- The browser entry keeps browser-specific notifications and logout handling.
- Voice input/read-aloud stay intentionally hidden. Their implementation and
  low-level tests remain; obsolete visible-entry tests are retained as skipped.

## Release boundary

This build is for local acceptance. Do not upload latest.yml, installers,
blockmaps, or release assets to the online update channel.
The server baseline is enterprise-web-v0.20.8-fix11-20261003, including historical
orphan-reminder administrator archival and net receivables after write-offs.

## Validation

- Run enterprise renderer, native bridge/updater/VPN tests and browser contracts.
- Build the Windows x64 NSIS wizard with --publish never.
- Run packaged Electron acceptance with isolated API fixtures and a temporary
  profile; do not install over a user's active client or mutate live accounts.
- Verify installer payload and renderer/IPC hashes with
  scripts/verify-enterprise-release.mjs.
