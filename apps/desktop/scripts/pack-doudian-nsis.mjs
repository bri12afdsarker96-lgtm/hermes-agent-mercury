import { spawn, spawnSync } from 'node:child_process'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { createWriteStream } from 'node:fs'
import { isMain } from './utils.mjs'
import { assertReport, compareFiles, hashFile, inventory, readAssetContract,
  verifyStagedModule, writeReport } from './verify-doudian-package.mjs'
import { makeLocalBuilderConfig, makeLocalDeployment, validateLocalOrigin } from './local-deployment.mjs'

const desktopRoot = path.resolve(import.meta.dirname, '..')
const repoRoot = path.resolve(desktopRoot, '../..')
const require = createRequire(import.meta.url)

export function makeBuildInfo({ version, commit, branch, electron, node, artifact, bytes,
  sha512, assetContract, verified, enterpriseOrigin, builtAt = new Date().toISOString() }) {
  if (!verified?.passed || verified.matched_count !== assetContract.file_count ||
      !/^[a-f0-9]{40}$/.test(commit) || !branch || branch === 'HEAD' ||
      !/^[a-f0-9]{40}$/i.test(assetContract.source_commit) || !/^[a-f0-9]{64}$/i.test(assetContract.manifest_sha256) ||
      !/^[a-f0-9]{128}$/.test(sha512) || !Number.isSafeInteger(bytes) || bytes <= 0) {
    throw new Error('Cannot certify an unverified installer')
  }
  return { version, commit, branch, built_at: builtAt, built_by: { electron, node },
    artifact, bytes, sha512, sha512_encoding: 'hex', local_verification_only: true,
    published: false, ...(enterpriseOrigin ? { enterprise_origin: enterpriseOrigin } : {}), doudian: { source_commit: assetContract.source_commit,
      assets_manifest_sha256: assetContract.manifest_sha256, profile: 'hermes-module',
      files: verified.matched_count, bytes: verified.total_bytes } }
}

export function installerPayloadLayout(entries) {
  const names = new Set(entries.map(entry => entry.path))
  const direct = ['resources/app.asar', 'resources/install-stamp.json', 'resources/doudian/manifest.json']
    .every(name => names.has(name))
  const nested = entries.filter(entry => /(^|\/)app-64\.7z$/.test(entry.path))
  if (direct && nested.length === 0) return { type: 'direct' }
  if (!direct && nested.length === 1) return { type: 'nested', path: nested[0].path }
  throw new Error('Ambiguous or missing NSIS x64 payload')
}

async function main() {
  if (process.platform !== 'win32') throw new Error('NSIS verification requires Windows')
  const { values } = parseArgs({ options: {
    'assets-manifest': { type: 'string' }, output: { type: 'string' },
    'seven-zip': { type: 'string' }, 'npm-cli': { type: 'string' },
    'localprep': { type: 'boolean', default: false }, 'local-origin': { type: 'string' },
    'nsis-dir': { type: 'string' }, 'nsis-resources-dir': { type: 'string' },
  } })
  if (values['local-origin']) validateLocalOrigin(values['local-origin'])
  if (values.localprep || values['local-origin']) {
    throw new Error('Local verification packaging is unavailable until the 0.20.12 runtime isolation is integrated and verified')
  }
  if (!values['assets-manifest'] || !values.output || !values['seven-zip']) {
    throw new Error('Usage: npm run dist:win:doudian-local -- --assets-manifest <TD/docs/payment-assets-manifest.json> --output <new-directory> --seven-zip <7z.exe>')
  }
  if (values.localprep !== Boolean(values['local-origin'])) {
    throw new Error('--localprep requires --local-origin and vice versa')
  }
  const requestedOrigin = values.localprep ? validateLocalOrigin(values['local-origin']) : undefined
  if (values.localprep && (!values['nsis-dir'] || !values['nsis-resources-dir'])) {
    throw new Error('Local builds require existing --nsis-dir and --nsis-resources-dir; no downloads are attempted')
  }
  if (values.localprep) {
    for (const dir of [values['nsis-dir'], values['nsis-resources-dir']]) {
      if (!(await stat(path.resolve(dir))).isDirectory()) throw new Error('NSIS tool path must be an existing directory')
    }
    if (!(await stat(path.resolve(values['seven-zip']))).isFile()) throw new Error('7-Zip path must be an existing file')
  }
  const output = path.resolve(values.output)
  const npm = values['npm-cli'] || process.env.npm_execpath
  if (!npm) throw new Error('Run through npm or pass --npm-cli')
  await mkdir(output, { recursive: true })
  if ((await readdir(output)).length) throw new Error('Output directory must be empty; previous evidence is never overwritten')
  const steps = []
  async function run(name, command, args) {
    console.log(`START ${name} ${new Date().toISOString()}`)
    const start = Date.now()
    const log = `${steps.length + 1}-${name}.txt`
    const destination = createWriteStream(path.join(output, log), { flags: 'wx' })
    const child = spawn(command, args, { cwd: desktopRoot, windowsHide: true, shell: false,
      env: { ...process.env, PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH}`,
        CSC_IDENTITY_AUTO_DISCOVERY: 'false', ...(values.localprep ? {
          ELECTRON_BUILDER_OFFLINE: 'true', ELECTRON_BUILDER_NSIS_DIR: path.resolve(values['nsis-dir']),
          ELECTRON_BUILDER_NSIS_RESOURCES_DIR: path.resolve(values['nsis-resources-dir']),
          ELECTRON_BUILDER_7ZIP_PATH: path.resolve(values['seven-zip'])
        } : {}) } })
    const result = await new Promise(resolve => {
      let error
      destination.on('error', failure => { error = failure; child.kill() })
      child.on('error', failure => { error = failure })
      for (const source of [child.stdout, child.stderr]) {
        source.setEncoding('utf8')
        source.on('data', text => { process.stdout.write(text); destination.write(text) })
      }
      child.on('close', status => destination.end(() => resolve({ status, error })))
    })
    const end = Date.now()
    steps.push({ step: name, command, args, started_at: new Date(start).toISOString(),
      ended_at: new Date(end).toISOString(), elapsed_ms: end - start, exit_code: result.status, log })
    await writeFile(path.join(output, 'commands.json'), JSON.stringify(steps, null, 2) + '\n')
    console.log(`END ${name} exit=${result.status}`)
    if (result.error || result.status !== 0) throw new Error(`${name} failed; see ${log}`)
  }
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8', windowsHide: true })
    if (result.error || result.status !== 0) throw new Error(`git ${args.join(' ')} failed`)
    return result.stdout.trim()
  }
  const commit = git('rev-parse', 'HEAD')
  const branch = git('branch', '--show-current')
  if (!branch || git('diff', '--name-only', 'HEAD', '--', 'apps/desktop') ||
      git('ls-files', '--others', '--exclude-standard', '--', 'apps/desktop/scripts', 'apps/desktop/src', 'apps/desktop/electron')) {
    throw new Error('Commit desktop sources/packaging scripts before building an attributable verification package')
  }
  const contract = await readAssetContract(path.resolve(values['assets-manifest']))
  const staged = await verifyStagedModule(path.join(desktopRoot, 'build', 'doudian'))
  const stageReport = compareFiles(contract.files, staged)
  await writeReport(path.join(output, 'staged-assets'), stageReport)
  assertReport(stageReport, 'trusted-asset-profile')
  const pkg = JSON.parse(await readFile(path.join(desktopRoot, 'package.json'), 'utf8'))
  let localDeployment
  let localFile
  let productionDeploymentHash
  if (values.localprep) {
    const productionFile = path.join(desktopRoot, 'assets', 'enterprise-deployment.json')
    productionDeploymentHash = await hashFile(productionFile)
    const production = JSON.parse(await readFile(productionFile, 'utf8'))
    localDeployment = makeLocalDeployment(production, requestedOrigin)
    const tempDir = path.join(output, 'local-build')
    await mkdir(tempDir)
    localFile = path.join(tempDir, 'enterprise-deployment.json')
    await writeFile(localFile, JSON.stringify(localDeployment, null, 2) + '\n', { flag: 'wx' })
  }
  const electronPackage = require.resolve('electron/package.json')
  const electronVersion = (await readFile(path.join(path.dirname(electronPackage), 'dist', 'version'), 'utf8')).trim()
  if (electronVersion !== pkg.build.electronVersion) throw new Error('Installed Electron does not match packaging version')
  let localBuilderConfig
  if (localFile) {
    const electronDist = path.join(path.dirname(electronPackage), 'dist')
    if (!(await stat(path.join(electronDist, 'electron.exe'))).isFile()) throw new Error('Local Electron binary is missing')
    localBuilderConfig = path.join(path.dirname(localFile), 'builder-config.json')
    await writeFile(localBuilderConfig, JSON.stringify(makeLocalBuilderConfig(pkg.build, electronDist), null, 2) + '\n', { flag: 'wx' })
  }
  await run('build', process.execPath, [npm, 'run', 'build'])
  if (localFile) {
    await run('local-bundle', process.execPath, ['scripts/bundle-electron-main.mjs', '--local-deployment', localFile])
  }
  const localOptions = localBuilderConfig ? ['--config', localBuilderConfig] : []
  await run('nsis', process.execPath, ['scripts/run-electron-builder.mjs', '--win', 'nsis', '--x64',
    '--publish', 'never', `-c.directories.output=${output}`, ...localOptions])
  const installers = (await readdir(output)).filter(name => name.endsWith('.exe'))
  if (installers.length !== 1) throw new Error(`Expected one NSIS installer, found ${installers.length}`)
  const installer = path.join(output, installers[0])
  if (localFile && !installers[0].endsWith('-localprep.exe')) throw new Error('Local installer name must end with -localprep.exe')
  await run('nsis-listing', values['seven-zip'], ['l', '-slt', '-sccUTF-8', installer])
  const outer = path.join(output, 'extracted-installer')
  await run('nsis-extract', values['seven-zip'], ['x', '-y', '-sccUTF-8', installer, `-o${outer}`])
  // Extract the payload FROM the installer, never compare the builder's loose staging tree.
  const layout = installerPayloadLayout(await inventory(outer))
  let unpacked = outer
  if (layout.type === 'nested') {
    const payload = path.join(outer, layout.path)
    await run('payload-listing', values['seven-zip'], ['l', '-slt', '-sccUTF-8', payload])
    unpacked = path.join(output, 'extracted-payload')
    await run('payload-extract', values['seven-zip'], ['x', '-y', '-sccUTF-8', payload, `-o${unpacked}`])
  } else {
    console.log('NSIS payload was directly extracted from the installer by 7-Zip')
  }
  const report = compareFiles(contract.files, await inventory(path.join(unpacked, 'resources', 'doudian')))
  await writeReport(path.join(output, 'installer-assets'), report)
  assertReport(report, 'installer-embedded-payload')
  const stamp = JSON.parse(await readFile(path.join(unpacked, 'resources', 'install-stamp.json'), 'utf8'))
  if (stamp.commit !== commit || stamp.branch !== branch || stamp.dirty || git('rev-parse', 'HEAD') !== commit ||
      git('diff', '--name-only', 'HEAD', '--', 'apps/desktop')) throw new Error('Source/stamp changed during build')
  const asar = require('@electron/asar')
  const appAsar = path.join(unpacked, 'resources', 'app.asar')
  const packedPackage = JSON.parse(asar.extractFile(appAsar, 'package.json').toString())
  if (packedPackage.version !== pkg.version) throw new Error('Packaged version mismatch')
  if (localFile) {
    const localMain = await readFile(path.join(desktopRoot, 'dist', 'electron-main.mjs'))
    const packedMain = asar.extractFile(appAsar, 'dist/electron-main.mjs')
    if (!localMain.equals(packedMain) || !packedMain.includes(Buffer.from(localDeployment.enterprise_api_origin))) {
      throw new Error('Local deployment was not preserved in the installer main bundle')
    }
    if (await hashFile(path.join(desktopRoot, 'assets', 'enterprise-deployment.json')) !== productionDeploymentHash) {
      throw new Error('Production deployment file changed during local build')
    }
  }
  const buildInfo = makeBuildInfo({ version: pkg.version, commit, branch,
    electron: electronVersion, node: process.version, artifact: installers[0],
    bytes: (await stat(installer)).size, sha512: await hashFile(installer, 'sha512'),
    assetContract: contract, verified: report, enterpriseOrigin: localDeployment?.enterprise_api_origin })
  await writeFile(path.join(output, 'BUILD_INFO.json'), JSON.stringify(buildInfo, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify(buildInfo, null, 2))
}

if (isMain(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
