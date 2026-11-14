# 0.20.12 TD candidate inventory, 2026-11-15

Status: **UNTRUSTED OFFLINE PROJECTION; NO COMBINED INSTALLER**. This work does not open the existing localprep gate. It does not execute TD, stage files, install software, contact a service, or perform payment. The projected manifest is not an actual staged manifest. No xlsm code was changed.

## Observations

- Hermes baseline: `7294a92e014c1d0b95683bd6c3640226a46ec31c`.
- Input: `_codex_verify/results/td-payment-pause-build-final-20261115`, including its `build-files.sha256.json`. Every listed file's actual SHA-256 matched; the input inventory had no unlisted files except that manifest itself. This is internal consistency, not independent provenance.
- TD `de868dfb339a9b7e7b99c49b0e6af5017a8b7727` is a **claim**, inferred from build time and commit time. No signed build attestation binds it to this output. At inspection the TD worktree also contained uncommitted changes; neither its current HEAD nor its contents establishes the build's source identity.
- The candidate has 84 selected runtime files plus one projected `manifest.json`, 514288451 bytes. Six build-only paths are recorded in the candidate. The selected paths equal the old contract's module scope. A change to that scope requires a manual review of both the mapping and the actual stage script.
- Old `payment-assets-manifest.json` SHA-256 `c8ebda55c0453ae5d96296cbbc1562611efa6b2238ff3bc5e96d8b8ffbcdb4f8` remains unchanged. Comparison: 83/85 match; the executable differs in size and hash, and generated manifest differs in hash. Detailed comparison retains the expected and actual values for every file. This result is a failure against the old contract, not a refreshed trust list.
- Candidate JSON SHA-256 `17d2b5485b5fcb665e227cabf4ffb15aca386b17c6b890d8d8154e7fde8a30e4`; projected manifest SHA-256 `1f69acc87736e65386b03a89a18b5e90d6125eea1dde6deef3472affa8bbbdf2`; comparison SHA-256 `16e4de896f0f0255a3a64f14da21e7431e829af2b168c90273cb22d8ec9d4cfb`. These identify evidence, not approvals.
- `node --test apps/desktop/scripts/candidate-doudian-inventory.test.mjs apps/desktop/scripts/compare-asset-evidence.test.mjs`: 2 passed, 1 skipped (optional old extracted-module copy not supplied). Test covers altered file, unlisted file, stage mismatch, and output collision. Running the actual `pack-doudian-nsis.mjs --localprep --local-origin http://127.0.0.1:18080` still exits 1 with the existing isolation gate message.

## Reproduce the candidate

From the Hermes worktree on Windows, with Node 22 and a fresh output directory:

```powershell
$v = 'D:\文档\抖店自动化\_codex_verify'
node apps/desktop/scripts/candidate-doudian-inventory.mjs `
  --build "$v\results\td-payment-pause-build-final-20261115" `
  --baseline "$v\td-payment-pause-fix-20261115\docs\payment-assets-manifest.json" `
  --stage-script apps/desktop/scripts/stage-doudian.mjs `
  --stage-sha256 00d1a0eca3757c7aa8511c7e4e45fa7f6a002a9ae442cfe50986b56f9b2f8557 `
  --source-commit de868dfb339a9b7e7b99c49b0e6af5017a8b7727 `
  --output "$v\results\candidate-inventory-NEW"
node --test apps/desktop/scripts/candidate-doudian-inventory.test.mjs apps/desktop/scripts/compare-asset-evidence.test.mjs
```

The exact stage-script hash is pinned because selection logic mirrors that script. The source commit is caller-supplied and expressly marked unverified. Outputs must not be interpreted as a release manifest or as actual packaged content. The original output is `_codex_verify/results/candidate-inventory-final-20261115`.

## Remaining work before a combination installer

1. Establish the exact TD source commit and clean inputs, independently rebuild twice in separate clean worktrees with pinned tools and offline dependency cache, and compare all build bytes. Review differences against the old contract and approve sources separately. The existing TD `docs/payment-reproduce-20261111.md` describes older toolchain inputs; its `-Verify` is expected to reject the changed executable until a separately reviewed policy exists. Do not overwrite the old contract.
2. Establish real packaged Electron and TD process isolation, installed identity, runtime/child home and network boundaries. The job/AppContainer probes in `p10-job-appcontainer-experiments-20261115.md` do not prove these. The packaging gate intentionally fails closed.
3. Only after the isolation gate is resolved and reviewed, use a clean attributable build, actual staging, offline NSIS tools and the designated localprep path. Extract the produced installer itself and compare every embedded module file with an independently reviewed candidate. Verify source stamp, installer hashes, runtime identity and controlled synthetic behavior separately. Signing, provenance, all other package resources and egress are separate concerns; matching module hashes do not prove them.

This repository's candidate parser recognizes `UNTRUSTED` for localprep; the metadata alone is not a security boundary or authorization, and other packaging paths have not been audited. There is no claim that the resulting system is production-safe.
