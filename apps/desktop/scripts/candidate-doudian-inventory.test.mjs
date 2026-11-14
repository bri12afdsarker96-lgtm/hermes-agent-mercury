import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('./candidate-doudian-inventory.mjs', import.meta.url))
const stage = fileURLToPath(new URL('./stage-doudian.mjs', import.meta.url))
const sha = s => createHash('sha256').update(s).digest('hex')
const stageSha = '00d1a0eca3757c7aa8511c7e4e45fa7f6a002a9ae442cfe50986b56f9b2f8557'
test('candidate inventories the scoped files and rejects tampering and changed scope', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'td-inventory-'))
  try {
    const build = path.join(root, 'build'), baseline = path.join(root, 'baseline.json')
    const names = ['外呼订单自动化.exe', '外呼订单自动化.exe.config', 'Assets/Ocr/WindowsOcr.ps1', 'runtime.dll', 'inference/ppocr_keys.txt', 'inference/PaddleOCR.config.json', 'inference/PP-OCRv5_mobile_det_infer/inference.pdiparams', 'inference/PP-OCRv5_mobile_rec_infer/inference.pdiparams', 'Assets/Recognition/SmallPaymentForm/amount_input.png', 'Assets/Recognition/PaymentButton/right_payment_button_clean.png']
    const entries = []
    for (const name of names) {
      const content = Buffer.from(name)
      await mkdir(path.dirname(path.join(build, name)), { recursive: true })
      await writeFile(path.join(build, name), content)
      entries.push({ path: name, bytes: content.length, sha256: sha(content), required: true })
    }
    await writeFile(path.join(build, 'build-files.sha256.json'), JSON.stringify(entries))
    const old = [...entries, { path: 'manifest.json', bytes: 1, sha256: sha('x'), required: true }]
    await writeFile(baseline, JSON.stringify({ schema_version: 1, source_commit: 'b'.repeat(40), profiles: { 'hermes-module': { files: old, file_count: old.length, total_bytes: old.reduce((n, e) => n + e.bytes, 0) } } }))
    const run = (out, hash = stageSha) => spawnSync(process.execPath, [script, '--build', build, '--baseline', baseline, '--stage-script', stage, '--stage-sha256', hash, '--source-commit', 'a'.repeat(40), '--output', path.join(root, out)], { encoding: 'utf8' })
    assert.equal(run('ok').status, 0)
    const candidate = JSON.parse(await readFile(path.join(root, 'ok/candidate.UNTRUSTED.json')))
    assert.equal(candidate.candidate_status, 'UNTRUSTED')
    assert.equal(candidate.source_commit_status, 'CLAIMED_NOT_INDEPENDENTLY_VERIFIED')
    assert.equal(candidate.profiles['hermes-module'].file_count, names.length + 1)
    assert.match(run('bad-stage', 'f'.repeat(64)).stderr, /Stage script hash mismatch/)
    await writeFile(path.join(build, 'runtime.dll'), 'tampered')
    assert.match(run('tampered').stderr, /Build manifest mismatch/)
    await writeFile(path.join(build, 'runtime.dll'), 'runtime.dll')
    await writeFile(path.join(build, 'extra.dll'), 'extra')
    assert.match(run('extra').stderr, /Unlisted build files/)
    assert.notEqual(run('ok').status, 0)
  } finally { await rm(root, { recursive: true, force: true }) }
})
