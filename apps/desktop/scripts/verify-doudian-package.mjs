import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

export async function hashFile(file, algorithm = 'sha256') {
  const hash = createHash(algorithm)
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

function safeRelative(name) {
  if (typeof name !== 'string' || !name || name.includes('\\') || name.includes(':') ||
      name.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part)) ||
      /[\x00-\x1f]/.test(name)) throw new Error(`Unsafe module path: ${name}`)
  return name
}

export async function inventory(root) {
  const result = []
  async function walk(relative) {
    const target = path.join(root, relative)
    const stat = await lstat(target)
    if (stat.isSymbolicLink()) throw new Error(`Module links are forbidden: ${relative || root}`)
    if (stat.isDirectory()) {
      for (const name of (await readdir(target)).sort()) {
        await walk(relative ? `${relative}/${name}` : name)
      }
    } else if (stat.isFile()) {
      safeRelative(relative)
      result.push({ path: relative, bytes: stat.size, sha256: await hashFile(target) })
    } else throw new Error(`Unsupported module file: ${relative}`)
  }
  await walk('')
  return result
}

function validateEntries(entries, requireBytes = true) {
  if (!Array.isArray(entries) || !entries.length) throw new Error('Empty module contract')
  const seen = new Set()
  for (const entry of entries) {
    const name = safeRelative(entry.path)
    if (seen.has(name.toLowerCase())) throw new Error(`Duplicate module path: ${name}`)
    seen.add(name.toLowerCase())
    if (!/^[a-f0-9]{64}$/i.test(entry.sha256) ||
        (requireBytes && (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0))) {
      throw new Error(`Invalid module contract entry: ${name}`)
    }
  }
}

export function compareFiles(expected, actual) {
  validateEntries(expected)
  validateEntries(actual)
  const byPath = new Map(actual.map(entry => [entry.path, entry]))
  const expectedNames = new Set(expected.map(entry => entry.path))
  const rows = expected.map(entry => {
    const found = byPath.get(entry.path)
    const status = !found ? 'missing' : found.bytes !== entry.bytes ? 'size-mismatch' :
      found.sha256.toLowerCase() !== entry.sha256.toLowerCase() ? 'hash-mismatch' : 'ok'
    return { path: entry.path, expected_bytes: entry.bytes, actual_bytes: found?.bytes ?? null,
      expected_sha256: entry.sha256.toLowerCase(), actual_sha256: found?.sha256 ?? null, status }
  })
  for (const entry of actual) {
    if (!expectedNames.has(entry.path)) rows.push({ path: entry.path, expected_bytes: null,
      actual_bytes: entry.bytes, expected_sha256: null, actual_sha256: entry.sha256, status: 'unexpected' })
  }
  return { passed: rows.every(row => row.status === 'ok'), expected_count: expected.length,
    actual_count: actual.length, matched_count: rows.filter(row => row.status === 'ok').length,
    total_bytes: actual.reduce((total, entry) => total + entry.bytes, 0), rows }
}

export function assertReport(report, label) {
  if (!report.passed) throw new Error(`DOUDIAN_PACKAGE_FAILED ${label}\n` +
    report.rows.filter(row => row.status !== 'ok').map(row => `${row.status}: ${row.path}`).join('\n'))
  console.log(`DOUDIAN_PACKAGE_OK ${label} files=${report.matched_count}/${report.expected_count} bytes=${report.total_bytes}`)
  return report
}

// The staged manifest is already restricted by stage-doudian's runtime allowlist.
// Reject extras before applying **/*, so logs/docs cannot hitch a ride.
export async function verifyStagedModule(root) {
  const manifestPath = path.join(root, 'manifest.json')
  if (!(await lstat(manifestPath)).isFile() || (await lstat(manifestPath)).isSymbolicLink()) {
    throw new Error('Module manifest must be a regular file')
  }
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  if (manifest.protocol !== 1 || manifest.integration !== 'hermes-review-v1' ||
      !manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files)) {
    throw new Error('Invalid staged module manifest')
  }
  const expected = Object.entries(manifest.files).map(([name, sha256]) => ({ path: name, sha256 }))
  validateEntries(expected, false)
  if (expected.some(entry => entry.path.toLowerCase() === 'manifest.json')) throw new Error('Recursive module manifest')
  const actual = await inventory(root)
  const sizes = new Map(actual.map(entry => [entry.path, entry.bytes]))
  const withSizes = expected.map(entry => ({ ...entry, bytes: sizes.get(entry.path) ?? 0 }))
  withSizes.push(actual.find(entry => entry.path === 'manifest.json'))
  assertReport(compareFiles(withSizes, actual), 'staged-manifest')
  return actual
}

export async function readAssetContract(file) {
  const manifest = JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''))
  const hasCandidateStatus = Object.hasOwn(manifest, 'candidate_status')
  if (hasCandidateStatus && (typeof manifest.candidate_status !== 'string' || !manifest.candidate_status.trim())) {
    throw new Error('Invalid candidate asset status')
  }
  if (hasCandidateStatus && !['UNTRUSTED', 'LOCAL VERIFICATION ONLY; NOT AN APPROVED RELEASE TRUST MANIFEST'].includes(manifest.candidate_status)) {
    throw new Error('Unrecognized candidate asset status')
  }
  const profile = manifest.profiles?.['hermes-module']
  if (manifest.schema_version !== 1 || !profile) throw new Error('Missing hermes-module asset profile')
  if (!/^[a-f0-9]{40}$/i.test(manifest.source_commit)) throw new Error('Invalid module source commit')
  validateEntries(profile.files)
  if (profile.files.some(entry => entry.required !== true) || profile.file_count !== profile.files.length ||
      profile.total_bytes !== profile.files.reduce((sum, entry) => sum + entry.bytes, 0)) {
    throw new Error('Invalid hermes-module asset totals/requirements')
  }
  return { files: profile.files, file_count: profile.file_count, total_bytes: profile.total_bytes,
    source_commit: manifest.source_commit, manifest_sha256: await hashFile(file),
    asset_approval: hasCandidateStatus ? 'UNTRUSTED' : 'UNVERIFIED',
    ...(hasCandidateStatus ? { candidate_status: manifest.candidate_status } : {}) }
}

export async function verifyPackagedModule(stagedRoot, packagedRoot) {
  const staged = await verifyStagedModule(stagedRoot)
  return assertReport(compareFiles(staged, await inventory(packagedRoot)), 'packaged-copy')
}

export async function writeReport(output, report) {
  await writeFile(`${output}.json`, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
  const columns = ['path', 'expected_bytes', 'actual_bytes', 'expected_sha256', 'actual_sha256', 'status']
  const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`
  await writeFile(`${output}.csv`, [columns.join(','), ...report.rows.map(row =>
    columns.map(column => quote(row[column])).join(','))].join('\n') + '\n', { flag: 'wx' })
}
