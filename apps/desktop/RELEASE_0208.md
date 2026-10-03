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

## Local acceptance result — 2026-10-03

- Product source: b3d4d31eea486bc64f4fc70ed7ac4b94be7152a1.
- Server source: 2bec9611c3deea42d8229f5ad9e44956535d7761.
- Desktop typecheck, enterprise renderer suite, 102 native enterprise tests,
  17 browser unit tests, 34 browser E2E tests and packaged Electron acceptance
  passed. Legacy hidden voice-entry cases remain explicitly skipped.
- Server receivable reporting, follow-up, reminder and overview regression
  suites passed, including real PostgreSQL tests against the local test database.
- NSIS nested app-64.7z payload matches the unpacked ASAR and built renderer/IPC.
- Installer: release/0.20.8/Hermes-企业助手-0.20.8-x64.exe, 257055728 bytes.
- Installer SHA-256:
  045d27d7a69cc1e6808cfa87e98456f1c7239430260a457bbe428e34dfbeb91f
- The Hermes installer is not Authenticode-signed; the bundled vendor OpenVPN
  MSI has a valid signature and matches the pinned manifest checksum.
- The build stamp truthfully records a dirty worktree because an unrelated
  contributor-email edit was preserved and excluded from this commit. Product
  paths match the source commit; no private key, credential, live data image or
  generated release binary was committed.
- No installed user client was replaced and no live financial record was
  modified. The online update feed was not changed.
