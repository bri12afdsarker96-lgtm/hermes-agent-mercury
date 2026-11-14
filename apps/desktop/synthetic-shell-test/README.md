# Synthetic enterprise shell acceptance

This is a test-only Electron main process and synthetic login/TD bridge. The
renderer uses the real `EnterpriseWorkspaceApp`, pages, and production preload
from Hermes base commit `e4b5e85881fa541566167efe60709505fe93feef`. It is not the
production Electron main process, real enterprise authentication, a packaged
application, or an acceptance of the existing local-verification gate.

The two TD pipe fixtures were compiled from local TD commit
`6e638a34df87ab5622b42634859f27450abb5ed1` using its test scripts and fake
engines. The payment fixture uses fake Screen and Excel; the review fixture uses
a fake review engine. Both use synthetic workbooks and session. The fixed
hashes in `main.ts` reject other executables and dependencies. No production TD
asset was launched; the payment preflight in this fixture is a stub.

From this worktree:

```powershell
Set-Location 'D:\文档\抖店自动化\_codex_verify\hermes-enterprise-fixture-repro-20261115\apps\desktop'
node --test synthetic-shell-test/prepare-fixtures.test.mjs
node scripts/synthetic-shell-e2e.mjs
```

The runner defaults to the pinned fixture binaries in the sibling
`hermes-enterprise-synthetic-shell-20261115/results` directory. To use another
copy, set the absolute `HERMES_SYNTHETIC_FIXTURE_SOURCE` to its parent
directory. All four files must match `fixtures.json` before any are copied;
the test main checks them again. Missing or altered files fail closed.

Each run creates a new `results/synthetic-shell-e2e/run-*` directory containing
verified fixture copies, screenshots, audit, fake-engine evidence, window check
and run metadata. Fixture preparation and UI failures leave `failure.txt`;
UI failures also attempt a screenshot. The test opens and closes its window.
Existing local Electron/Node dependencies are required.

This does not automatically trust newly built fixtures. The local .NET
Framework compiler produced different executable hashes when rebuilding the
same source. If the pinned binaries are unavailable, rebuild and independently
review them and their source before changing the committed pins.

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

The older incorrect payment navigation description was corrected in the base
commit; this test does not modify product source.
