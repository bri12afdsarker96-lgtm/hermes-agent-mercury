import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { compareFiles, hashFile, inventory, readAssetContract } from './verify-doudian-package.mjs'

const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const reviewedStageHash = '00d1a0eca3757c7aa8511c7e4e45fa7f6a002a9ae442cfe50986b56f9b2f8557'
const runtime = name => /^inference\/(?:en_dict\.txt|ppocr_keys\.txt|table_structure_dict_ch\.txt|PaddleOCR(?:Structure)?\.config\.json)$/.test(name) ||
  /^inference\/(?:en_PP-OCRv5_mobile_rec_infer|PP-OCRv5_mobile_(?:cls|det|rec)_infer|PP-OCRv6_(?:small|tiny)_(?:det|rec)_infer|SLANet_infer)\/inference\.(?:json|pdiparams|yml)$/.test(name) ||
  /^Assets\/Recognition\/(?:PaymentButton|SmallPaymentForm|ReviewCapture)\/[a-zA-Z0-9_]+\.png$/.test(name)

async function main() {
  const { values: v } = parseArgs({ options: Object.fromEntries(['build', 'baseline', 'stage-script', 'stage-sha256', 'source-commit', 'output'].map(n => [n, { type: 'string' }])) })
  for (const n of ['build', 'baseline', 'stage-script', 'stage-sha256', 'source-commit', 'output']) if (!v[n]) throw new Error(`Missing --${n}`)
  if (!/^[a-f0-9]{40}$/.test(v['source-commit']) || !/^[a-f0-9]{64}$/.test(v['stage-sha256'])) throw new Error('Invalid commit or stage hash')
  if (v['stage-sha256'] !== reviewedStageHash || await hashFile(v['stage-script']) !== reviewedStageHash) throw new Error('Stage script hash mismatch: re-audit selection mapping')
  const build = path.resolve(v.build), output = path.resolve(v.output)
  const rel = path.relative(build, output)
  if (!rel || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel))) throw new Error('Output cannot be inside build input')
  const actual = await inventory(build)
  const listed = JSON.parse((await readFile(path.join(build, 'build-files.sha256.json'), 'utf8')).replace(/^\uFEFF/, ''))
  if (!Array.isArray(listed)) throw new Error('Invalid build manifest')
  const byName = new Map(actual.map(e => [e.path, e]))
  const known = new Set()
  for (const e of listed) {
    if (typeof e.path !== 'string' || !/^[a-f0-9]{64}$/i.test(e.sha256) || known.has(e.path.toLowerCase())) throw new Error('Invalid or duplicate build manifest entry')
    known.add(e.path.toLowerCase())
    const file = byName.get(e.path)
    if (!file || file.sha256 !== e.sha256.toLowerCase()) throw new Error(`Build manifest mismatch: ${e.path}`)
  }
  const unlisted = actual.filter(e => !known.has(e.path.toLowerCase()) && e.path !== 'build-files.sha256.json')
  if (unlisted.length) throw new Error(`Unlisted build files: ${unlisted.map(e => e.path).join(', ')}`)
  const dir = await readdir(build, { withFileTypes: true })
  const exe = '外呼订单自动化.exe'
  const selected = [exe, `${exe}.config`, 'Assets/Ocr/WindowsOcr.ps1', ...dir.filter(e => e.isFile() && e.name.endsWith('.dll')).map(e => e.name), ...listed.map(e => e.path).filter(runtime)]
  for (const name of ['inference/PaddleOCR.config.json', 'inference/ppocr_keys.txt', 'inference/PP-OCRv5_mobile_det_infer/inference.pdiparams', 'inference/PP-OCRv5_mobile_rec_infer/inference.pdiparams', 'Assets/Recognition/SmallPaymentForm/amount_input.png', 'Assets/Recognition/PaymentButton/right_payment_button_clean.png']) {
    if (!selected.includes(name)) throw new Error(`Missing payment runtime asset: ${name}`)
  }
  const old = await readAssetContract(v.baseline)
  const oldNames = old.files.filter(e => e.path !== 'manifest.json').map(e => e.path)
  if (new Set(selected.map(s => s.toLowerCase())).size !== selected.length || selected.length !== oldNames.length || selected.some(s => !oldNames.includes(s))) throw new Error('Selected runtime paths differ from reviewed scope; manual mapping review required')
  const files = selected.map(name => {
    const item = byName.get(name)
    if (!item || !known.has(name.toLowerCase())) throw new Error(`Selected file missing: ${name}`)
    return { ...item, required: true }
  })
  const manifest = Buffer.from(JSON.stringify({ protocol: 1, integration: 'hermes-review-v1', version: '1.0.54', files: Object.fromEntries(files.map(e => [e.path, e.sha256])) }, null, 2))
  files.push({ path: 'manifest.json', bytes: manifest.length, sha256: digest(manifest), required: true })
  const profile = { file_count: files.length, total_bytes: files.reduce((n, e) => n + e.bytes, 0), files }
  const contract = { schema_version: 1, source_commit: v['source-commit'], source_commit_status: 'CLAIMED_NOT_INDEPENDENTLY_VERIFIED', candidate_status: 'UNTRUSTED', projection_status: 'OFFLINE_PROJECTION_NOT_ACTUAL_STAGING_OR_INSTALLER', stage_script_sha256: v['stage-sha256'], build_manifest_sha256: await hashFile(path.join(build, 'build-files.sha256.json')), excluded_build_paths: actual.filter(e => !selected.includes(e.path)).map(e => e.path), profiles: { 'hermes-module': profile } }
  const comparison = compareFiles(old.files, files)
  await mkdir(output)
  await writeFile(path.join(output, 'manifest.expected.json'), manifest, { flag: 'wx' })
  await writeFile(path.join(output, 'candidate.UNTRUSTED.json'), JSON.stringify(contract, null, 2) + '\n', { flag: 'wx' })
  await writeFile(path.join(output, 'old-contract-comparison.json'), JSON.stringify(comparison, null, 2) + '\n', { flag: 'wx' })
  console.log(`CANDIDATE_ONLY files=${files.length} old_matches=${comparison.matched_count}/${comparison.expected_count}`)
  for (const row of comparison.rows.filter(e => e.status !== 'ok')) console.log(`${row.status}: ${row.path}`)
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
