# Native Electron synthetic UI verification

This is a separate developer test entry point, running directly on the local
Windows host. It is not the packaged enterprise app and does not modify the
production authorization or local-verification gates. The test renders the
actual `ReviewCapturePage` and `DoudianWorkbench`, uses the existing
`DoudianController`, and launches a pinned synthetic TD test executable through
its existing stdio protocol. The enterprise session and TD implementation are
test fixtures, not evidence of a real account or shop.

The test-only main process verifies SHA-256 of the synthetic executable and its
Newtonsoft dependency, copies them into a fresh temporary directory, and creates
a synthetic text file with an `.xlsx` name. The fixture's fake scanner and
review engine do not read a real workbook, launch a shop browser, or perform a
payment. The window and its renderer retain a permanent synthetic-test banner.
Only capabilities, synthetic shop listing, test workbook selection, review
preparation/start/status/stop are accepted by test IPC; payment, shop login and
shop management are blocked. Electron renderer network requests are denied and
file loads are limited to the generated renderer directory. The runner supplies
a minimal process environment instead of inheriting enterprise credentials.
Renderer `sandbox: true`, `contextIsolation: true`, and `nodeIntegration:
false` remain enabled; no Chromium sandbox-disabling switch is used.

This is not an OS security boundary: the test main process and synthetic TD
fixture run with the local user's ordinary permissions, and the renderer's
network policy does not isolate native processes. The hash-pinned test binaries
and the machine's dependency links are local test prerequisites, not a secure
distribution mechanism. The fake authorization is confined to this standalone
test entry point, which is not used by the production application.

## Run on this machine

From PowerShell:

```powershell
Set-Location 'D:\文档\抖店自动化\_codex_verify\hermes-secure-isolation-20261115\apps\desktop'
$env:HERMES_SYNTHETIC_TD_DIR = 'D:\文档\抖店自动化\_codex_verify\results\td-unicode-pipe-20261114\host'
node scripts/native-fixture-ui.mjs
```

The command builds the test-only renderer and main into the worktree's
`results/native-fixture-ui`, starts an ordinary visible Electron window, runs
the synthetic workflow with Playwright, saves three screenshots and a synthetic
trace, then closes the window. The test requires the two exact pinned fixture
binaries and existing local Node/Electron dependencies. It refuses missing or
different fixture binaries. Run `node scripts/native-fixture-ui.mjs --open`
after setting the same environment variable to open a visible interactive test
window without the automated clicks; closing the window ends that process.

## Observed result

On 2026-11-15 the automated command passed: it verified the actual Electron
renderer preferences and absence of the sandbox-disabling switch; displayed a
synthetic shop; selected the synthetic workbook; performed one scan, explicit
confirmation, and one fake review; reached the completed UI state; rejected
payment and shop-login IPC requests; and confirmed the renderer's attempt to
contact a local test HTTP listener did not reach it. The trace contained no
payment event. The output includes `01-synthetic-ready.png`,
`02-synthetic-confirm.png`, `03-synthetic-complete.png`, and
`synthetic-trace.jsonl`. The synthetic `.xlsx` is not an Excel file, and the
displayed zero saved count is a fixture result, not a real shop result.

The separate manual test window was also observed in the local process list
with a responsive Electron main window. The existing controller's
local-verification fail-closed test passed, and `pack-doudian-nsis.mjs
--localprep --local-origin http://127.0.0.1:18080` still exited 1 with its
isolation-unavailable error. No store, payment, real account, deployment,
Windows Sandbox, AppContainer, job isolation, or global firewall change was
used during this UI verification.
