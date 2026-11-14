# Local verification isolation follow-up, 2026-11-14

Status: BLOCKED. Localprep packaging must remain disabled. This work is in
`codex/p10-02012-isolation-20261114` based on `db11c57bc`; it is not applied
to the combined worktree or the main line.

## Findings

The combined worktree's `p10-combined-build-blocker-20261114.md` describes the
candidate TD's real WinForms entry point, LocalApplicationData storage, real
platform URLs and ability to launch applications. The `taskIsolation`
handshake is a task protocol contract, not a network or OS data sandbox. The
existing `p10-02012-isolation-audit-20261114.md` also records unresolved
enterprise application, backend, packaged identity and descendant boundaries.
Loopback enterprise origin and separate Hermes home do not establish those
boundaries. A reliable enforced boundary for TD and every Chrome descendant,
including data roots and egress, has not been built or verified here.

## Independent defense

The desktop passes its local-verification selection into `DoudianController`.
In that mode the controller rejects every operation before authorization,
workbook selection, executable verification or host creation. This prevents
this controller from starting the original TD host in local verification mode.
It does not implement a TD simulator, sandbox another launch path, isolate the
enterprise application or its backend, or establish that packaging is safe.
Normal mode continues through the existing authorization and task checks.
The packaging and bundling fail-closed guards remain in place.

## Verification

All commands ran inside this worktree on Windows. Tests used mocked TD hosts
and synthetic inputs; no real shop, payment, production service, installer,
or deployed application was used.

- `node ../../node_modules/vitest/vitest.mjs run --config .codex-vitest.config.ts --configLoader runner --no-cache electron/doudian-local-verification.test.ts electron/doudian-task-isolation.test.ts electron/doudian-window-spawn.test.ts electron/doudian-payment.test.ts`: 4 files, 41 tests passed. The new test covers each controller action and checks that the authorization, file selection, verification and host callbacks are not called.
- `node ../../node_modules/typescript/bin/tsc -p tsconfig.electron.json --noEmit --tsBuildInfoFile .codex-isolation-followup.tsbuildinfo`: exit 0.
- `node scripts/pack-doudian-nsis.mjs --localprep --local-origin http://127.0.0.1:18080`: exit 1 with `Local verification packaging is unavailable until the 0.20.12 runtime isolation is integrated and verified`.

No packaged-app or OS-level egress test was performed. A future solution needs
an independently enforced and tested local-only boundary for the enterprise
app, TD and descendants, including direct-IP/DNS/UDP egress, data roots and
escape paths, followed by packaged-app verification before the guards change.
