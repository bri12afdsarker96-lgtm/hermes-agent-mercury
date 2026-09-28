# Client reminder cues

Scope: notification presentation only. No server deployments, new API endpoints,
business writes, status transitions, reminder delivery worker changes or chat voice
feature changes.

- The existing authenticated poll reads authoritative state every 15 seconds,
  including while the window is hidden. Inbox filters do not hide notifications.
- First overdue cue starts an in-memory, identity-scoped 30-minute clock. A fresh
  unchanged snapshot after that interval emits one additional cue, not an endless
  repeating alarm. Updated status/updated_at cancels the old cycle. Completion,
  cancellation and rescheduling retire the old occurrence.
- Poll failures never trigger a repeat from cached data. Reconnection checks the
  server before any catch-up. Logging out/restarting resets the local clock; this
  is not an offline or server-side scheduler. The application must remain running.
- Personal reminders have one notification owner (not one each for the list and
  the inbox). A batch plays one clip, without overlapping itself. Logout and
  installer preparation stop playback. Audio failure leaves text alerts intact.
- Preview is available in Reminder Center. The fixed Chinese text is
  “主人，您有新的待办提醒” It contains no task/account information.

## Audio provenance

The user explicitly selected `D:/下载/温暖少女.mp3` for embedding on 2026-09-12.
`src/enterprise-client/assets/reminder-cue.mp3` is a byte-for-byte copy, without
pitch, speed, content or encoding changes. SHA256:
`90bbfdbe42472160f4f067dd1616dc49bff4043c781edc4b66700054e8f89a74`.
The clip is 40,586 bytes. Clients play the bundled MP3 without network access,
voice installation or synthesis credentials. The former system-voice prototype
is no longer imported or emitted by the build; its generator was removed.
