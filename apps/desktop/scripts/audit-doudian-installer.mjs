import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFile, lstat, mkdir, open, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { assertAssetPolicy, installerPayloadLayout } from './pack-doudian-nsis.mjs'
import { assertReport, compareFiles, hashFile, inventory, readAssetContract, verifyPackagedModule, verifyStagedModule } from './verify-doudian-package.mjs'

const { values } = parseArgs({ options: Object.fromEntries(['installer', 'seven-zip', 'candidate', 'stage', 'output'].map(key => [key, { type: 'string' }])) })
try {
  for (const key of ['installer', 'seven-zip', 'candidate', 'stage', 'output']) if (!values[key]) throw new Error(`Missing --${key}`)
  const inputs = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, path.resolve(value)]))
  for (const key of ['installer', 'seven-zip', 'candidate']) {
    const stat = await lstat(inputs[key])
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Invalid input: ${key}`)
  }
  const stageStat = await lstat(inputs.stage)
  if (!stageStat.isDirectory() || stageStat.isSymbolicLink()) throw new Error('Invalid staged module')
  for (const input of [inputs.installer, inputs['seven-zip'], inputs.candidate, inputs.stage]) {
    const relative = path.relative(input, inputs.output)
    if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) {
      throw new Error('Output must be outside inputs')
    }
  }
  const contract = await readAssetContract(inputs.candidate)
  assertAssetPolicy(contract, true)
  const staged = await verifyStagedModule(inputs.stage)
  assertReport(compareFiles(contract.files, staged), 'candidate-vs-stage')
  await mkdir(inputs.output)
  const extract = (archive, output) => {
    const result = spawnSync(inputs['seven-zip'], ['x', '-y', '-sccUTF-8', archive, `-o${output}`], { encoding: 'utf8', windowsHide: true, timeout: 120000 })
    if (result.error || result.status !== 0) throw new Error(`7-Zip extraction failed: ${result.error || result.stderr || result.stdout}`)
  }
  const outer = path.join(inputs.output, 'installer-extracted')
  extract(inputs.installer, outer)
  const layout = installerPayloadLayout(await inventory(outer))
  let payload = outer
  if (layout.type === 'nested') {
    payload = path.join(inputs.output, 'payload-extracted')
    extract(path.join(outer, layout.path), payload)
  }
  for (const required of ['resources/app.asar', 'resources/install-stamp.json']) {
    if (!(await lstat(path.join(payload, required))).isFile()) throw new Error(`Missing payload file: ${required}`)
  }
  const embedded = path.join(payload, 'resources', 'doudian')
  const actual = await inventory(embedded)
  assertReport(compareFiles(contract.files, actual), 'candidate-vs-extracted')
  await verifyPackagedModule(inputs.stage, embedded)
  const model = path.join(embedded, 'inference', 'PP-OCRv5_mobile_det_infer', 'inference.pdiparams')
  const backup = path.join(inputs.output, 'model-negative-backup')
  const extra = path.join(embedded, 'synthetic-unexpected-test.txt')
  await copyFile(model, backup)
  try {
    const file = await open(model, 'r+')
    try {
      const byte = Buffer.alloc(1)
      const { bytesRead } = await file.read(byte, 0, 1, 0)
      if (bytesRead !== 1) throw new Error('Empty model')
      byte[0] ^= 1
      await file.write(byte, 0, 1, 0)
    } finally { await file.close() }
    await assert.rejects(verifyPackagedModule(inputs.stage, embedded), /hash-mismatch: inference\/PP-OCRv5_mobile_det_infer\/inference.pdiparams/)
    await rm(model)
    await assert.rejects(verifyPackagedModule(inputs.stage, embedded), /missing: inference\/PP-OCRv5_mobile_det_infer\/inference.pdiparams/)
    await copyFile(backup, model)
    await writeFile(extra, 'synthetic negative test', { flag: 'wx' })
    await assert.rejects(verifyPackagedModule(inputs.stage, embedded), /unexpected: synthetic-unexpected-test.txt/)
  } finally {
    await copyFile(backup, model)
    await rm(extra, { force: true })
    await rm(backup, { force: true })
  }
  await verifyPackagedModule(inputs.stage, embedded)
  const report = { scope: 'UNTRUSTED_OFFLINE_INSTALLER_ASSET_EVIDENCE_ONLY', published: false, approval: false,
    installer_sha256: await hashFile(inputs.installer), seven_zip_sha256: await hashFile(inputs['seven-zip']),
    candidate_sha256: contract.manifest_sha256, candidate_status: contract.candidate_status,
    source_commit_claimed: contract.source_commit, layout: layout.type, files: actual.length,
    negative_cases: ['same-size-corruption', 'missing-model', 'unexpected-file'] }
  await writeFile(path.join(inputs.output, 'report.UNTRUSTED.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify(report))
} catch (error) { console.error(error); process.exitCode = 1 }
