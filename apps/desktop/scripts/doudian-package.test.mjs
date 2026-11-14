import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, readFile, rm, cp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'vitest'
import { FileMatcher, copyFiles } from 'app-builder-lib/out/fileMatcher.js'
import { compareFiles, inventory, readAssetContract, verifyStagedModule,
  verifyPackagedModule, assertReport } from './verify-doudian-package.mjs'
import { assertAssetPolicy, makeBuildInfo } from './pack-doudian-nsis.mjs'
import beforePack from './before-pack.mjs'

async function fixture(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hermes-p8-'))
  try {
    const stage = path.join(root, 'build', 'doudian')
    const entries = { 'app.exe': 'test executable', 'runtime.dll': 'runtime',
      'inference/model/inference.pdiparams': 'model', 'Assets/Ocr/tool.ps1': 'ocr helper',
      'Assets/Recognition/template.png': 'image', 'inference/config.json': '{}' }
    const files = {}
    for (const [name, content] of Object.entries(entries)) {
      await mkdir(path.dirname(path.join(stage, name)), { recursive: true })
      await writeFile(path.join(stage, name), content)
      files[name] = createHash('sha256').update(content).digest('hex')
    }
    await writeFile(path.join(stage, 'manifest.json'), JSON.stringify({ protocol: 1,
      integration: 'hermes-review-v1', version: '1.0.54', files }))
    const all = await inventory(stage)
    const contract = path.join(root, 'assets.json')
    await writeFile(contract, JSON.stringify({ schema_version: 1, source_commit: 'c'.repeat(40), profiles: { 'hermes-module': {
      file_count: all.length, total_bytes: all.reduce((sum, file) => sum + file.bytes, 0),
      files: all.map(file => ({ ...file, required: true })) } } }))
    await run({ root, stage, all, contract })
  } finally { await rm(root, { recursive: true, force: true }) }
}

test('actual electron-builder copying preserves nested runtime files with the configured filter', async () => {
  await fixture(async ({ root, stage, all }) => {
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
    const config = pkg.build.extraResources.find(entry => entry.from === 'build/doudian')
    assert.equal(config.to, 'doudian')
    const destination = path.join(root, 'packed', 'resources', config.to)
    await copyFiles([new FileMatcher(stage, destination, value => value, config.filter)], undefined, false)
    assert.equal(compareFiles(all, await inventory(destination)).passed, true)
    await verifyPackagedModule(stage, destination)
  })
})

test('reproduces old top-level filter losing nested assets through real builder copying', async () => {
  await fixture(async ({ root, stage, all }) => {
    const destination = path.join(root, 'old-packed')
    await copyFiles([new FileMatcher(stage, destination, value => value, ['*.exe', '*.dll', '*.config', 'manifest.json'])], undefined, false)
    const report = compareFiles(all, await inventory(destination))
    assert.equal(report.passed, false)
    assert.ok(report.rows.some(row => row.path.endsWith('.pdiparams') && row.status === 'missing'))
    await assert.rejects(verifyPackagedModule(stage, destination), /missing: inference\/model\/inference.pdiparams/)
  })
})

test('missing nested model stops beforePack before download or cleanup', async () => {
  await fixture(async ({ root, stage }) => {
    await rm(path.join(stage, 'inference/model/inference.pdiparams'))
    await assert.rejects(beforePack({ electronPlatformName: 'win32', appOutDir: path.join(root, 'out'),
      packager: { projectDir: root } }), /missing: inference\/model\/inference.pdiparams/)
  })
})

test('same-size corruption fails SHA256 and extra log files fail the exact manifest', async () => {
  await fixture(async ({ stage }) => {
    await writeFile(path.join(stage, 'inference/model/inference.pdiparams'), 'MODEL')
    await assert.rejects(verifyStagedModule(stage), /hash-mismatch/)
    await writeFile(path.join(stage, 'inference/model/inference.pdiparams'), 'model')
    await writeFile(path.join(stage, 'private.log'), 'must not ship')
    await assert.rejects(verifyStagedModule(stage), /unexpected: private.log/)
  })
})

test('independent TD profile catches modified manifest and size mismatch', async () => {
  await fixture(async ({ stage, contract }) => {
    const trusted = await readAssetContract(contract)
    assert.equal(compareFiles(trusted.files, await verifyStagedModule(stage)).passed, true)
    await writeFile(path.join(stage, 'manifest.json'), (await readFile(path.join(stage, 'manifest.json'), 'utf8')) + ' ')
    const changed = await inventory(stage)
    assert.throws(() => assertReport(compareFiles(trusted.files, changed), 'canonical'))
  })
})

test('manifest traversal and case-insensitive duplicates fail closed', async () => {
  await fixture(async ({ stage, all }) => {
    const bad = { protocol: 1, integration: 'hermes-review-v1', files: { '../escape': 'a'.repeat(64) } }
    await writeFile(path.join(stage, 'manifest.json'), JSON.stringify(bad))
    await assert.rejects(verifyStagedModule(stage), /Unsafe module path/)
    assert.throws(() => compareFiles([...all, { ...all[0], path: all[0].path.toUpperCase() }], all), /Duplicate/)
  })
})

test('copied file tampering is detected after pack', async () => {
  await fixture(async ({ root, stage }) => {
    const destination = path.join(root, 'copy')
    await cp(stage, destination, { recursive: true })
    await writeFile(path.join(destination, 'app.exe'), 'different')
    await assert.rejects(verifyPackagedModule(stage, destination), /size-mismatch: app.exe/)
  })
})

test('BUILD_INFO identifies a verified artifact and refuses failed or incomplete comparisons', () => {
  const input = { version: '0.20.9', commit: 'a'.repeat(40), branch: 'feature/test',
    electron: '40.10.2', node: 'v22.23.2', artifact: 'test.exe', bytes: 100, sha512: 'b'.repeat(128),
    assetContract: { file_count: 2, source_commit: 'c'.repeat(40), manifest_sha256: 'd'.repeat(64), asset_approval: 'UNVERIFIED' },
    verified: { passed: true, matched_count: 2, total_bytes: 50 } }
  const result = makeBuildInfo(input)
  assert.equal(result.sha512, input.sha512)
  assert.equal(result.published, false)
  assert.equal(result.built_by.electron, input.electron)
  assert.throws(() => makeBuildInfo({ ...input, verified: { ...input.verified, passed: false } }))
  assert.throws(() => makeBuildInfo({ ...input, verified: { ...input.verified, matched_count: 1 } }))
  assert.throws(() => makeBuildInfo({ ...input, commit: 'unknown' }))
  assert.throws(() => makeBuildInfo({ ...input, assetContract: { ...input.assetContract, source_commit: undefined } }))
})

test('candidate manifests remain unapproved and are restricted to localprep records', async () => {
  await fixture(async ({ contract }) => {
    const json = JSON.parse(await readFile(contract, 'utf8'))
    for (const status of ['UNTRUSTED', 'LOCAL VERIFICATION ONLY; NOT AN APPROVED RELEASE TRUST MANIFEST']) {
      await writeFile(contract, JSON.stringify({ ...json, candidate_status: status }))
      const candidate = await readAssetContract(contract)
      assert.equal(candidate.asset_approval, 'UNTRUSTED')
      assert.equal(candidate.candidate_status, status)
      assert.throws(() => assertAssetPolicy(candidate, false), /only be used for localprep/)
      assert.doesNotThrow(() => assertAssetPolicy(candidate, true))
      const input = { version: '1', commit: 'a'.repeat(40), branch: 'test', electron: '1', node: '1',
        artifact: 'test-localprep.exe', bytes: 1, sha512: 'b'.repeat(128), assetContract: candidate,
        verified: { passed: true, matched_count: candidate.file_count, total_bytes: candidate.total_bytes },
        localprep: true, enterpriseOrigin: 'http://127.0.0.1:18080' }
      const info = makeBuildInfo(input)
      assert.equal(info.doudian.asset_approval, 'UNTRUSTED')
      assert.equal(info.doudian.candidate_status, status)
      assert.equal(info.publication_allowed, false)
      assert.equal(info.published, false)
      assert.throws(() => makeBuildInfo({ ...input, localprep: false }), /only be used for localprep/)
      assert.throws(() => makeBuildInfo({ ...input, artifact: 'release.exe' }), /localprep artifact/)
      assert.throws(() => makeBuildInfo({ ...input, enterpriseOrigin: 'https://example.test' }), /Local origin/)
    }
    for (const status of ['', null, 0]) {
      await writeFile(contract, JSON.stringify({ ...json, candidate_status: status }))
      await assert.rejects(readAssetContract(contract), /Invalid candidate asset status/)
    }
    assert.throws(() => assertAssetPolicy({ asset_approval: 'UNVERIFIED', candidate_status: 'UNTRUSTED' }, false))
  })
})

test('profile fields cannot replace computed provenance', async () => {
  await fixture(async ({ contract }) => {
    const json = JSON.parse(await readFile(contract, 'utf8'))
    json.profiles['hermes-module'].manifest_sha256 = '0'.repeat(64)
    json.profiles['hermes-module'].source_commit = 'a'.repeat(40)
    await writeFile(contract, JSON.stringify(json))
    const actual = await readAssetContract(contract)
    assert.equal(actual.source_commit, 'c'.repeat(40))
    assert.equal(actual.manifest_sha256, createHash('sha256').update(await readFile(contract)).digest('hex'))
  })
})

test('missing or malformed module provenance is rejected', async () => {
  await fixture(async ({ contract }) => {
    const json = JSON.parse(await readFile(contract, 'utf8'))
    for (const source_commit of [undefined, 'not-a-commit']) {
      await writeFile(contract, JSON.stringify({ ...json, source_commit }))
      await assert.rejects(readAssetContract(contract), /Invalid module source commit/)
    }
  })
})
