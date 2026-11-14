import { readFile, lstat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { compareFiles, hashFile, inventory } from './verify-doudian-package.mjs'

// Read-only evidence comparison; an absent module is accepted only when explicitly requested.
const { values } = parseArgs({ options: Object.fromEntries(
  ['projection', 'projection-sha256', 'source', 'source-manifest', 'module', 'output'].map(name => [name, { type: 'string' }])) })
try {
  for (const name of ['projection', 'projection-sha256', 'source', 'source-manifest', 'module', 'output']) {
    if (!values[name]) throw new Error(`Missing --${name}`)
  }
  if (!/^[a-f0-9]{64}$/.test(values['projection-sha256']) || await hashFile(values.projection) !== values['projection-sha256']) throw new Error('Projection hash mismatch')
  const projection = JSON.parse(await readFile(values.projection, 'utf8'))
  if (projection.candidate_status !== 'UNTRUSTED' || projection.projection_status !== 'OFFLINE_PROJECTION_NOT_ACTUAL_STAGING_OR_INSTALLER') throw new Error('Invalid projection status')
  const profile = projection.profiles?.['hermes-module']
  if (!profile || profile.file_count !== profile.files?.length || profile.files.some(entry => entry.required !== true)) throw new Error('Invalid projection profile')
  // Validate paths and duplicates before joining paths to the source tree.
  compareFiles(profile.files, [])
  const source = []
  for (const item of profile.files) {
    const file = item.path === 'manifest.json' ? values['source-manifest'] : path.join(values.source, ...item.path.split('/'))
    const info = await lstat(file)
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Invalid source asset: ${item.path}`)
    source.push({ path: item.path, bytes: info.size, sha256: await hashFile(file) })
  }
  const actual = await inventory(values.module)
  const sourceReport = compareFiles(profile.files, source)
  const moduleReport = compareFiles(source, actual)
  const report = { scope: 'UNTRUSTED_MODULE_BYTES_ONLY', projection_sha256: values['projection-sha256'],
    source_commit: projection.source_commit, source_vs_projection: sourceReport, module_vs_source: moduleReport }
  await writeFile(values.output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
  console.log(`SOURCE_VS_PROJECTION matched=${sourceReport.matched_count}/${sourceReport.expected_count}`)
  console.log(`MODULE_VS_SOURCE matched=${moduleReport.matched_count}/${moduleReport.expected_count} actual=${moduleReport.actual_count}`)
  for (const row of moduleReport.rows.filter(row => row.status !== 'ok')) console.log(`${row.status}: ${row.path}`)
  if (!sourceReport.passed || !moduleReport.passed) process.exitCode = 1
} catch (error) { console.error(`ERROR ${error.message}`); process.exitCode = 1 }
