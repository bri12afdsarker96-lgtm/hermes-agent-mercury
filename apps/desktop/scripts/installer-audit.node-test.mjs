import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { compareFiles, hashFile, inventory, readAssetContract, verifyStagedModule } from './verify-doudian-package.mjs'
import { assertAssetPolicy } from './pack-doudian-nsis.mjs'

const sevenZip = process.env.HERMES_AUDIT_7ZIP
const actualStage = process.env.HERMES_AUDIT_STAGE
const actualCandidate = process.env.HERMES_AUDIT_CANDIDATE
test('actual candidate matches current staged bytes and localprep gate remains closed', { skip: !actualStage || !actualCandidate, timeout: 120000 }, async () => {
  const contract = await readAssetContract(actualCandidate)
  assert.equal(contract.asset_approval, 'UNTRUSTED')
  assert.equal(contract.candidate_status, 'UNTRUSTED')
  assert.doesNotThrow(() => assertAssetPolicy(contract, true))
  assert.throws(() => assertAssetPolicy(contract, false), /restricted to localprep/)
  const report = compareFiles(contract.files, await verifyStagedModule(actualStage))
  assert.equal(report.passed, true)
  assert.equal(report.matched_count, 85)
  const cli = fileURLToPath(new URL('./pack-doudian-nsis.mjs', import.meta.url))
  const result = spawnSync(process.execPath, [cli, '--localprep', '--local-origin', 'http://127.0.0.1:18080'], { encoding: 'utf8' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /runtime isolation is integrated and verified/)
  console.log('PASS candidate/stage 85/85; untrusted status and isolation gate preserved')
})

test('real 7-Zip extracts direct and nested synthetic fixtures and rejects bad assets', { skip: !sevenZip, timeout: 120000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hermes-installer-audit-'))
  try {
    const stage = path.join(root, 'stage')
    const model = 'inference/PP-OCRv5_mobile_det_infer/inference.pdiparams'
    await mkdir(path.join(stage, path.dirname(model)), { recursive: true })
    await writeFile(path.join(stage, model), 'synthetic-model')
    await writeFile(path.join(stage, 'fixture.exe'), 'synthetic-module')
    const files = { [model]: await hashFile(path.join(stage, model)), 'fixture.exe': await hashFile(path.join(stage, 'fixture.exe')) }
    await writeFile(path.join(stage, 'manifest.json'), JSON.stringify({ protocol: 1, integration: 'hermes-review-v1', files }))
    const assets = await inventory(stage)
    const candidate = path.join(root, 'candidate.json')
    const json = { schema_version: 1, source_commit: 'a'.repeat(40), candidate_status: 'UNTRUSTED',
      profiles: { 'hermes-module': { file_count: assets.length, total_bytes: assets.reduce((sum, e) => sum + e.bytes, 0), files: assets.map(e => ({ ...e, required: true })) } } }
    await writeFile(candidate, JSON.stringify(json))
    const content = path.join(root, 'content')
    await mkdir(path.join(content, 'resources'), { recursive: true })
    await cp(stage, path.join(content, 'resources', 'doudian'), { recursive: true })
    await writeFile(path.join(content, 'resources', 'app.asar'), 'synthetic-asar')
    await writeFile(path.join(content, 'resources', 'install-stamp.json'), '{}')
    const archive = (cwd, output, input) => {
      const result = spawnSync(sevenZip, ['a', '-t7z', output, input], { cwd, encoding: 'utf8', windowsHide: true })
      assert.equal(result.status, 0, result.stderr || result.stdout)
    }
    const cli = fileURLToPath(new URL('./audit-doudian-installer.mjs', import.meta.url))
    const run = (installer, contract, output) => spawnSync(process.execPath, [cli, '--installer', installer, '--seven-zip', sevenZip,
      '--candidate', contract, '--stage', stage, '--output', output], { encoding: 'utf8', timeout: 60000 })
    const direct = path.join(root, 'synthetic-direct.exe')
    archive(content, direct, 'resources')
    const directResult = run(direct, candidate, path.join(root, 'direct-output'))
    assert.equal(directResult.status, 0, directResult.stderr)
    assert.equal(JSON.parse(await readFile(path.join(root, 'direct-output', 'report.UNTRUSTED.json'))).layout, 'direct')
    const outer = path.join(root, 'outer')
    await mkdir(path.join(outer, '$PLUGINSDIR'), { recursive: true })
    archive(content, path.join(outer, '$PLUGINSDIR', 'app-64.7z'), 'resources')
    const nested = path.join(root, 'synthetic-nested.exe')
    archive(outer, nested, '$PLUGINSDIR')
    const nestedResult = run(nested, candidate, path.join(root, 'nested-output'))
    assert.equal(nestedResult.status, 0, nestedResult.stderr)
    const report = JSON.parse(await readFile(path.join(root, 'nested-output', 'report.UNTRUSTED.json')))
    assert.equal(report.layout, 'nested')
    assert.equal(report.approval, false)
    assert.deepEqual(report.negative_cases, ['same-size-corruption', 'missing-model', 'unexpected-file'])
    const wrong = path.join(root, 'wrong.json')
    json.profiles['hermes-module'].files[0].sha256 = '0'.repeat(64)
    await writeFile(wrong, JSON.stringify(json))
    const rejected = run(direct, wrong, path.join(root, 'rejected-output'))
    assert.notEqual(rejected.status, 0)
    assert.match(rejected.stderr, /candidate-vs-stage/)
    console.log('PASS real 7-Zip extraction on synthetic direct/nested archives; no actual installer')
  } finally { await rm(root, { recursive: true, force: true }) }
})
