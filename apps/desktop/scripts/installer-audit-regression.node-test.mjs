import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { hashFile, inventory } from './verify-doudian-package.mjs'

const sevenZip = process.env.HERMES_AUDIT_7ZIP
async function fixture(root, includeNamedAsset) {
  const stage = path.join(root, 'stage')
  const model = 'inference/PP-OCRv5_mobile_det_infer/inference.pdiparams'
  await mkdir(path.join(stage, path.dirname(model)), { recursive: true })
  await writeFile(path.join(stage, model), 'synthetic-model')
  await writeFile(path.join(stage, 'fixture.exe'), 'synthetic-module')
  if (includeNamedAsset) await writeFile(path.join(stage, 'synthetic-unexpected-test.txt'), 'valid asset')
  const files = Object.fromEntries(await Promise.all((await inventory(stage)).map(async item => [item.path, await hashFile(path.join(stage, item.path))])))
  await writeFile(path.join(stage, 'manifest.json'), JSON.stringify({ protocol: 1, integration: 'hermes-review-v1', files }))
  const assets = await inventory(stage)
  const candidate = path.join(root, 'candidate.json')
  await writeFile(candidate, JSON.stringify({ schema_version: 1, source_commit: 'a'.repeat(40), candidate_status: 'UNTRUSTED',
    profiles: { 'hermes-module': { file_count: assets.length, total_bytes: assets.reduce((sum, e) => sum + e.bytes, 0), files: assets.map(e => ({ ...e, required: true })) } } }))
  const content = path.join(root, 'content')
  await mkdir(path.join(content, 'resources'), { recursive: true })
  await cp(stage, path.join(content, 'resources', 'doudian'), { recursive: true })
  await writeFile(path.join(content, 'resources', 'app.asar'), 'synthetic-asar')
  await writeFile(path.join(content, 'resources', 'install-stamp.json'), '{}')
  const installer = path.join(root, 'synthetic.exe')
  const result = spawnSync(sevenZip, ['a', '-t7z', installer, 'resources'], { cwd: content, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  return { stage, candidate, installer }
}
function run(input, output) {
  const cli = process.env.HERMES_AUDIT_TEST_CLI || fileURLToPath(new URL('./audit-doudian-installer.mjs', import.meta.url))
  return spawnSync(process.execPath, [cli, '--installer', input.installer, '--seven-zip', sevenZip,
    '--candidate', input.candidate, '--stage', input.stage, '--output', output], { encoding: 'utf8', timeout: 60000 })
}

test('a legitimate asset with the negative-test filename is preserved', { skip: !sevenZip, timeout: 60000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hermes-audit-collision-'))
  try {
    const input = await fixture(root, true)
    const output = path.join(root, 'evidence')
    const result = run(input, output)
    const asset = path.join(output, 'installer-extracted', 'resources', 'doudian', 'synthetic-unexpected-test.txt')
    const preserved = await readFile(asset, 'utf8').catch(error => error.code === 'ENOENT' ? '<missing>' : Promise.reject(error))
    assert.equal(result.status, 0, `${result.stderr}\nEXTRACTED_VALID_ASSET=${preserved}`)
    assert.equal(preserved, 'valid asset')
    assert.equal((JSON.parse(await readFile(path.join(output, 'report.UNTRUSTED.json')))).approval, false)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('output through a directory junction cannot write into the staged input', { skip: !sevenZip || process.platform !== 'win32', timeout: 60000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hermes-audit-junction-'))
  try {
    const input = await fixture(root, false)
    const before = await inventory(input.stage)
    const alias = path.join(root, 'stage-alias')
    await symlink(input.stage, alias, 'junction')
    const result = run(input, path.join(alias, 'audit-output'))
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /outside inputs|reparse|symbolic/i)
    await assert.rejects(stat(path.join(input.stage, 'audit-output')), { code: 'ENOENT' })
    assert.deepEqual(await inventory(input.stage), before)
  } finally { await rm(root, { recursive: true, force: true }) }
})
