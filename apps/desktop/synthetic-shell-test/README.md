# Synthetic enterprise shell acceptance

This is a test-only Electron main process and synthetic login/TD bridge. The
renderer uses the real `EnterpriseWorkspaceApp`, pages, and production preload
from Hermes commit `369e25d57ec5e9f97aba94fb89d66e17a2b0e7a2`. It is not the
production Electron main process, real enterprise authentication, a packaged
application, or an acceptance of the existing local-verification gate.

The two TD pipe fixtures were compiled from local TD commit
`6e638a34df87ab5622b42634859f27450abb5ed1` using its test scripts and fake
engines. The payment fixture uses fake Screen and Excel; the review fixture uses
a fake review engine. Both use synthetic workbooks and session. The fixed
hashes in `main.ts` reject other executables and dependencies. No production TD
asset was launched; the payment preflight in this fixture is a stub.

From this worktree, with the two exact already-built fixture directories under
`results/td-final-review-fixture` and `results/td-final-payment-fixture`:

```powershell
Set-Location 'D:\文档\抖店自动化\_codex_verify\hermes-enterprise-synthetic-shell-20261115\apps\desktop'
node scripts/synthetic-shell-e2e.mjs
```

Existing local Electron/Node dependency junctions and those exact fixture
binaries are prerequisites; a new fixture build may require a fresh security
review and updated pinned hashes. The test creates a temporary synthetic data
root, shows a visible Electron window, and closes it after the run. It records
screenshots, protocol audit, fake engine evidence and window checks under
`results/synthetic-shell-e2e/`.

On 2026-11-15 the synthetic login, workbench, review preparation/confirmation,
and payment preparation/confirmation reached `paused_review`. No `openReview`
or `openPayment` method reached either synthetic host. An explicit
`openPayment` IPC attempt was rejected; the final sample observed one Electron
window and zero Windows main-window handles for both TD fixture processes.
This is not a complete enumeration of native windows. Payment `calls.txt`
records only fake confirmations and row 2 is marked for manual review; no real
payment, shop or production account was used. The original local-verification
controller gate still rejected actions, and localprep packaging still failed
closed. Chromium sandbox remained enabled; no Windows Sandbox was used.

Known product issue: `role-presentation.ts` still describes the payment entry
as opening the old payment window, despite the page being rendered inside the
enterprise shell in this fixture. Product source was not modified in this test.
