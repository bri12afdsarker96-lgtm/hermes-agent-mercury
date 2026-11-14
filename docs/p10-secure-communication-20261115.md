# Local isolation follow-up: communication hardening

Status: incomplete. The local verification packaging and controller gates remain
closed. This change is not an operating-system sandbox and must not be used as
evidence to open either gate.

The TD stdio transport now validates reply shape and terminates the immediate
child on invalid JSON, invalid reply, oversized output, or the obsolete
authorization event. Pending requests fail with a protocol error. Normal close
still sends EOF for graceful cancellation. The transport uses the existing
private stdio pipes and random request IDs; it does not authenticate the child
against a malicious process or prove handle inheritance is restricted.

## Local verification

- `vitest.isolation.config.ts`: four focused files, 46 passed and one skipped.
  Five new cases launch a synthetic Node child through real pipes, including
  four malformed or forbidden responses and immediate-child termination.
- The existing controller/TD pipe integration passed with
  `_codex_verify/results/td-unicode-pipe-20261114/host/HermesHostIsolationTests.exe`.
  It uses fake engines and a synthetic workbook; it is not the production TD.
- Electron TypeScript `--noEmit` passed using existing linked dependencies.
- `pack-doudian-nsis.mjs --localprep --local-origin http://127.0.0.1:18080`
  exited 1 with the existing runtime-isolation-unavailable error.

No real shop or deployment was used. No Chromium sandbox option was changed.

## Remaining work before integration or gate review

The 2026-11-14 Windows AppContainer experiments are in the sibling
`windows-os-isolation-probe-20261114/README.md`. They show a synthetic TD
handshake but Electron failed before its script or renderer started while
Chromium sandbox was enabled. Those experiments do not prove the real app's
file or network isolation. A production boundary must enclose Electron, TD,
browser, backend and all descendants; verify process identity, handle and IPC
ownership, job lifecycle, reparse-point races and local data roots; and test
filesystem, DNS, direct-IP TCP/UDP and escape attempts with positive controls.
An authenticated, narrowly scoped broker and actual packaged-app tests remain
to be designed and exercised. Killing the immediate child here does not contain
or terminate its descendants. The host path/hash check also has a verification
to launch race, and the host currently inherits the parent environment.
