# 0.20.6 — client reminder cues

Published through the existing Windows x64 update feed on 2026-09-12.
No server business code, APIs or state transitions changed.

- One additional notification after 30 minutes without an authoritative status
  update. Completion/cancellation/rescheduling retires the old cycle. Requires
  the client to remain running and connected; outages never use stale snapshots.
- User-supplied 温暖少女.mp3 embedded byte-for-byte, available offline; preview in
  Reminder Center. No runtime TTS. Personal/inbox copies do not double-notify.

Validation: renderer/e2e typechecks, 15 focused unit/integration tests, packaged
daily-workflow acceptance and real packaged MP3 playback passed. NSIS embedded
ASAR verified against tested unpacked application. HTTPS feed is 0.20.6 and the
installer is accessible. Existing unsigned-installer limitation is unchanged.

Installer: Hermes-企业助手-0.20.6-x64.exe (257026715 bytes)
SHA256: bf3529ef3d02ceb5c66db41be29e18e9c4cf766d0a08bcd496b58282c8b12a74
ASAR SHA256: b994244cba89484ea48e542fb9eb68cad02897e99f6dd9b56833974f16f7b70e
Feed SHA256: a3588548de8774a7a0139bc080a894d5a335482ad1832a079f7f868e7176ccd9
MP3 SHA256: 90bbfdbe42472160f4f067dd1616dc49bff4043c781edc4b66700054e8f89a74

Previous feed retained at:
/opt/hermes/desktop-updates/windows/x64/latest.yml.previous-0.20.5-for-0.20.6-20260912
Restoring metadata stops the new offer; it does not downgrade installed clients.
