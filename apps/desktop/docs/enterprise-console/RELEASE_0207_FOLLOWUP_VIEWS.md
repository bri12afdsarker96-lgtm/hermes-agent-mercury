# 0.20.7 — follow-up views

Client-only presentation iteration, 2026-09-22. No business-state mutations,
permission expansion or backend deployment.

- Dedicated overdue navigation and full list with query/status/owner filters.
- Overview reminder preview remains 320px high and scrolls internally.
- Receivables query the existing authenticated, server-scoped list. Combine a
  case/width-normalized subject/group search with Mine/Other seats/specific owner
  and status filters. Private reminders remain owner-only under the server contract.
- Default current list excludes completed/cancelled/closed. History includes those
  three states, each separately selectable, and sorts descending by authoritative
  `updated_at` (the terminal action's update time). Missing timestamps sort last
  and render as an em dash; no invented date. Rescheduled work stays current.
- History is a projection, never a delete/archive write. Read-only records open
  details without an empty action form. Existing scoped refresh event moves records
  between views after processing. Existing reminder audio is unchanged.

Build: release/0.20.7/Hermes-企业助手-0.20.7-x64.exe
Size: 257038561 bytes
SHA256: 4c96104547736ecc9b59d845b3ae804369de2501783cee0cd5291357b1a1c1fe
ASAR: 81e8f980039333008fc252233eb4643501ac7077c550b9f1db5a263b35d8f548

Renderer and e2e typechecks passed. Five UI suites passed (42 tests); the added
state-change projection case then passed in the focused 5-case suite. Packaged
audio playback passed. NSIS payload matches the tested unpacked ASAR.

Both final packaged Playwright tests passed (delivery workflows and offline audio).

Published 2026-09-28 through the existing public SSH management endpoint after
confirming the interrupted upload was complete and the feed was still 0.20.6.
Installer, blockmap and feed hashes matched the local verified artifacts.
Old feed backup: /opt/hermes/desktop-updates/windows/x64/latest.yml.previous-0.20.6-for-0.20.7-20260928.
Feed switched atomically after artifact installation. Server-side HTTPS retrieval
via ppbb096.site resolved to 10.10.0.8 returned version 0.20.7; installer HTTP 200,
size and full downloaded SHA256 matched. Business health remained OK (strict).
No backend deployment, service restart or firewall change. Local VPN was
disconnected during publication; client-side update installation remains to be
confirmed after connecting VPN.
