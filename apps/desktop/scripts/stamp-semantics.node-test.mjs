import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { stampTime } from './write-build-stamp.mjs'
import { makeBuildInfo } from './pack-doudian-nsis.mjs'

test('source date is distinct from actual build time', () => {
  assert.deepEqual(stampTime({}, () => new Date('2026-11-15T01:02:03Z')), { builtAt: '2026-11-15T01:02:03.000Z' })
  assert.deepEqual(stampTime({ SOURCE_DATE_EPOCH: '0' }), { builtAt: null, sourceDateEpoch: '0' })
  for (const value of ['', '-1', '+1', '01', '1.5', '1e3', ' 1', '253402300800', '9007199254740992']) {
    assert.throws(() => stampTime({ SOURCE_DATE_EPOCH: value }), /SOURCE_DATE_EPOCH/)
  }
  const now = Date.now()
  const info = makeBuildInfo({ version: 'test', commit: 'a'.repeat(40), branch: 'fixture', electron: 'test', node: 'test',
    artifact: 'fixture-localprep.exe', bytes: 1, sha512: 'b'.repeat(128),
    assetContract: { file_count: 1, source_commit: 'c'.repeat(40), manifest_sha256: 'd'.repeat(64), asset_approval: 'UNTRUSTED', candidate_status: 'UNTRUSTED' },
    verified: { passed: true, matched_count: 1, total_bytes: 1 }, localprep: true, enterpriseOrigin: 'http://127.0.0.1:18080' })
  assert.ok(Date.parse(info.built_at) >= now && Date.parse(info.built_at) <= Date.now())
  assert.equal(info.publication_allowed, false)
})

test('real CLI emits stable source-only time and fails before overwriting on invalid epoch', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hermes-stamp-semantics-'))
  try {
    const scripts = path.join(root, 'apps', 'desktop', 'scripts')
    await mkdir(scripts, { recursive: true })
    for (const name of ['write-build-stamp.mjs', 'utils.mjs']) await copyFile(fileURLToPath(new URL(name, import.meta.url)), path.join(scripts, name))
    const cli = path.join(scripts, 'write-build-stamp.mjs')
    const output = path.join(root, 'apps', 'desktop', 'build', 'install-stamp.json')
    const env = { ...process.env, GITHUB_SHA: 'a'.repeat(40), GITHUB_REF_NAME: 'fixture', SOURCE_DATE_EPOCH: '1700000000' }
    const run = value => spawnSync(process.execPath, [cli], { env: value, encoding: 'utf8' })
    assert.equal(run(env).status, 0)
    const first = await readFile(output)
    assert.equal(run(env).status, 0)
    assert.deepEqual(await readFile(output), first)
    const stamp = JSON.parse(first)
    assert.equal(stamp.builtAt, null)
    assert.equal(stamp.sourceDateEpoch, '1700000000')
    assert.equal(stamp.commit, 'a'.repeat(40))
    await writeFile(output, 'previous')
    const bad = run({ ...env, SOURCE_DATE_EPOCH: '-1' })
    assert.notEqual(bad.status, 0)
    assert.match(bad.stderr, /SOURCE_DATE_EPOCH/)
    assert.equal(await readFile(output, 'utf8'), 'previous')
    const normal = { ...env }; delete normal.SOURCE_DATE_EPOCH
    const before = Date.now()
    assert.equal(run(normal).status, 0)
    const wall = JSON.parse(await readFile(output))
    assert.ok(Date.parse(wall.builtAt) >= before && Date.parse(wall.builtAt) <= Date.now())
    assert.equal(Object.hasOwn(wall, 'sourceDateEpoch'), false)
  } finally { await rm(root, { recursive: true, force: true }) }
})
