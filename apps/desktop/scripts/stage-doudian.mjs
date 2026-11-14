import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { testDoudianHost } from './test-doudian-host.mjs'

const source = path.resolve(process.argv[2] ?? '')
if (process.platform !== 'win32' || !process.argv[2]) { throw new Error('Usage on Windows: node scripts/stage-doudian.mjs <clean Build-Source output>') }
const root = path.resolve(import.meta.dirname, '..', 'build', 'doudian')
const staged = root + '.next-' + randomUUID()
// Runtime-only allowlist: original payment OCR models/templates are required.
// Never include project docs, historical packages, credentials, logs or user profiles.
const executable = '外呼订单自动化.exe'
const fixed = [executable, `${executable}.config`, 'Assets/Ocr/WindowsOcr.ps1']
const entries = await fs.readdir(source, { withFileTypes: true })
const buildManifest = JSON.parse(await fs.readFile(path.join(source, 'build-files.sha256.json'), 'utf8'))
if (!Array.isArray(buildManifest)) throw new Error('Invalid build manifest')
const manifestPaths = new Set()
for (const entry of buildManifest) {
  if (typeof entry?.path !== 'string' || typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(entry.sha256)) {
    throw new Error('Invalid build manifest entry')
  }
  const key = entry.path.toLowerCase()
  if (manifestPaths.has(key)) throw new Error(`Duplicate build manifest path: ${entry.path}`)
  manifestPaths.add(key)
}
const runtimeAsset = name => /^inference\/(?:en_dict\.txt|ppocr_keys\.txt|table_structure_dict_ch\.txt|PaddleOCR(?:Structure)?\.config\.json)$/.test(name) ||
  /^inference\/(?:en_PP-OCRv5_mobile_rec_infer|PP-OCRv5_mobile_(?:cls|det|rec)_infer|PP-OCRv6_(?:small|tiny)_(?:det|rec)_infer|SLANet_infer)\/inference\.(?:json|pdiparams|yml)$/.test(name) ||
  /^Assets\/Recognition\/(?:PaymentButton|SmallPaymentForm|ReviewCapture)\/[a-zA-Z0-9_]+\.png$/.test(name)
const files = [...fixed, ...entries.filter(entry => entry.isFile() && entry.name.endsWith('.dll')).map(entry => entry.name),
  ...buildManifest.map(entry => entry.path).filter(runtimeAsset)]
for (const required of ['inference/PaddleOCR.config.json', 'inference/ppocr_keys.txt',
  'inference/PP-OCRv5_mobile_det_infer/inference.pdiparams', 'inference/PP-OCRv5_mobile_rec_infer/inference.pdiparams',
  'Assets/Recognition/SmallPaymentForm/amount_input.png', 'Assets/Recognition/PaymentButton/right_payment_button_clean.png']) {
  if (!files.includes(required)) throw new Error(`Missing payment runtime asset: ${required}`)
}
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const content = new Map()
for (const name of files) {
  let current = source
  for (const part of name.split('/').slice(0, -1)) {
    current = path.join(current, part)
    const parent = await fs.lstat(current)
    if (!parent.isDirectory() || parent.isSymbolicLink()) throw new Error(`Unsafe directory: ${name}`)
  }
  const stat = await fs.lstat(path.join(source, name))
  if (!stat.isFile() || stat.isSymbolicLink()) { throw new Error(`Unsafe file: ${name}`) }
  const bytes = await fs.readFile(path.join(source, name))
  const expected = buildManifest.find(entry => entry.path === name)
  if (!expected || digest(bytes) !== expected.sha256.toLowerCase()) { throw new Error(`Build manifest mismatch: ${name}`) }
  content.set(name, bytes)
}
try { await fs.access(root); if (!process.argv.includes('--replace')) { throw new Error('Destination already exists. Use --replace to retain it as a backup and stage a newly verified module.') } }
catch (error) { if (error.code !== 'ENOENT') { throw error } }
await fs.mkdir(staged, { recursive: true })
for (const [name, bytes] of content) {
  await fs.mkdir(path.dirname(path.join(staged, name)), { recursive: true })
  await fs.writeFile(path.join(staged, name), bytes, { flag: 'wx' })
}
testDoudianHost(path.join(staged, executable))
await fs.writeFile(path.join(staged, 'manifest.json'), JSON.stringify({ protocol: 1, integration: 'hermes-review-v1', version: '1.0.54',
  files: Object.fromEntries([...content].map(([name, bytes]) => [name, digest(bytes)])) }, null, 2), { flag: 'wx' })
// Windows may briefly hold files just inspected by the offline host probe.
async function renameWithRetry(from, to) {
  for (let attempt = 0; ; attempt++) {
    try { await fs.rename(from, to); return }
    catch (error) {
      if (!['EPERM', 'EBUSY'].includes(error.code)) throw error
      if (attempt >= 3) {
        // Native Windows moves can succeed when libuv's directory rename is denied.
        // Both paths must remain siblings in the build directory; never overwrite.
        const parent = path.dirname(root)
        if ([from, to].some(value => path.dirname(path.resolve(value)) !== parent)) throw error
        if ((await fs.lstat(from)).isSymbolicLink()) throw error
        const moved = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
          "$ErrorActionPreference='Stop'; if (Test-Path -LiteralPath $env:HERMES_STAGE_TO) { throw 'Destination exists' }; Move-Item -LiteralPath $env:HERMES_STAGE_FROM -Destination $env:HERMES_STAGE_TO"], {
          env: { ...process.env, HERMES_STAGE_FROM: from, HERMES_STAGE_TO: to },
          encoding: 'utf8', windowsHide: true, shell: false, timeout: 30000
        })
        if (moved.error || moved.status !== 0) throw new Error(`Native staging move failed: ${moved.stderr || moved.error || error.message}`)
        return
      }
      await new Promise(resolve => setTimeout(resolve, 500))
    }
  }
}
const backup = root + '.previous-' + randomUUID()
let backedUp = false
try { await renameWithRetry(root, backup); backedUp = true }
catch (error) { if (error.code !== 'ENOENT') throw error }
try { await renameWithRetry(staged, root) }
catch (error) {
  if (backedUp) await renameWithRetry(backup, root)
  throw error
}
console.log(`Staged ${files.length} verified runtime files at ${root}. This is a development module, not a released installer.`)
