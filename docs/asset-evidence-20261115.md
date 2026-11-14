# 0.20.12 offline asset evidence, 2026-11-15

Status: BLOCKED. Comparison only; no package approval, actual staging, installer execution, production connection, or payment state change.

The Hermes worktree is based on `56cc43e42`. The source is TD `801a950f6b381df71b8a676cc6097b0649bfb034`: 84 files from its independent `build-a` plus the projected `manifest.expected.json`. All 85 files matched the untrusted offline projection by path, size and SHA-256. The projected manifest is not a file produced by actual staging. Projection SHA-256: `a1b9aae41ec0ea2211f4504d8c69f6aa93029cfcc0841d80cd02840745f36e27`.

The actual existing `hermes-online-0.20.12-verify.exe` SHA-256 is `abce71a874c19bac113b512a0af146e9c455df0d5e95e4ae5d4c29f361e75319`. The prior audit extractor re-read its NSIS nested archive and found zero TD module entries: 85 missing, exit 1. The empty module directory used in the detailed comparison is a representation of that verified empty file set, not an extracted directory. The full 85-row comparison is recorded in `results/asset-verify-20261115/02012-module-missing.json` under `_codex_verify`. This installer is not an identified new combined build.

For the previously extracted actual 0.20.9 module, 83/85 match the new source, with executable size and generated manifest hash differences. A separately copied real module with `inference/PP-OCRv5_mobile_det_infer/inference.pdiparams` deleted has 84 files. The node test compares that copy against the untouched original: 84/85 match, exactly one nested path is missing. The source comparison reports 82/85 because the two existing version differences remain. Results: `legacy-baseline.json`, `legacy-missing.json`.

The old trusted `payment-assets-manifest.json` remains SHA-256 `c8ebda55c0453ae5d96296cbbc1562611efa6b2238ff3bc5e96d8b8ffbcdb4f8`. `node apps/desktop/scripts/pack-doudian-nsis.mjs --localprep --local-origin http://127.0.0.1:18080` exits 1: `Local verification packaging is unavailable until the 0.20.12 runtime isolation is integrated and verified`. Packaged Electron startup, profile/child process homes, installed identity, and comprehensive network isolation remain unproven; see `p10-02012-isolation-audit-20261114.md`. No new combination installer exists from this work, so full installer content, signature, actual staging and isolation cannot be certified.

## Reproduction

Run in this worktree with PowerShell; use fresh output paths. The original negative-test copy must be created afresh and only the copy modified.

```powershell
$v = 'D:\文档\抖店自动化\_codex_verify'
$audit = "$v\td-801a950-asset-audit-20261114"
$evidence = "$v\results\asset-verify-20261115"
$projection = "$v\results\td-801a950-asset-audit-20261114\projection\module-profile.UNTRUSTED.json"
$projectionSha = 'a1b9aae41ec0ea2211f4504d8c69f6aa93029cfcc0841d80cd02840745f36e27'
$installer = "$v\results\hermes-online-0.20.12-verify.exe"
$legacy = "$v\results\td-25841d0-stage-audit-20261114\extract-tool-0209-final\payload\resources\doudian"
node "$audit\scripts\extract-td-installer-evidence.mjs" --installer $installer --installer-sha256 abce71a874c19bac113b512a0af146e9c455df0d5e95e4ae5d4c29f361e75319 --sevenzip 'C:\Program Files\7-Zip\7z.exe' --sevenzip-sha256 2bff20bd679d45166b8c2d039044a4ca16189e6d69ff9c82345b4c1306986ec4 --projection $projection --projection-sha256 $projectionSha --output "$v\results\asset-extraction-NEW"
$source = "$v\results\td-801a950-asset-audit-20261114\build-a"
$manifest = "$v\results\td-801a950-asset-audit-20261114\projection\manifest.expected.json"
node apps/desktop/scripts/compare-asset-evidence.mjs --projection $projection --projection-sha256 $projectionSha --source $source --source-manifest $manifest --module $legacy --output "$v\results\legacy-comparison-NEW.json"
Copy-Item -LiteralPath $legacy -Destination "$v\results\legacy-module-copy-NEW" -Recurse
Remove-Item -LiteralPath "$v\results\legacy-module-copy-NEW\inference\PP-OCRv5_mobile_det_infer\inference.pdiparams"
$env:TD_AUDIT_ORIGINAL = $legacy
$env:TD_AUDIT_MISSING_COPY = "$v\results\legacy-module-copy-NEW"
node --test apps/desktop/scripts/compare-asset-evidence.test.mjs
```

The extractor and legacy comparison exit 1 as expected. The test exits 0 when it verifies rejection of the missing nested asset. The extractor's archive listing is required before representing an absent module as an empty directory. Reports compare module bytes only and do not prove full-package completeness, provenance, signature, or isolation.
