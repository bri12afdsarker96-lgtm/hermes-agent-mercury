import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { spawnSync } from 'node:child_process'
import { build } from 'esbuild'
import { afterEach, expect, it } from 'vitest'
import { localDeploymentPlugin, makeLocalBuilderConfig, makeLocalDeployment, registerDesktopProtocol, validateLocalOrigin } from './local-deployment.mjs'
import { installerPayloadLayout, makeBuildInfo } from './pack-doudian-nsis.mjs'

const directories = []
afterEach(async () => { for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true }) })

it('distinguishes direct and nested installer payloads and rejects ambiguous or incomplete layouts', () => {
  const direct = ['resources/app.asar', 'resources/install-stamp.json', 'resources/doudian/manifest.json'].map(path => ({ path }))
  const nested = [{ path: '$PLUGINSDIR/app-64.7z' }]
  expect(installerPayloadLayout(direct)).toEqual({ type: 'direct' })
  expect(installerPayloadLayout(nested)).toEqual({ type: 'nested', path: '$PLUGINSDIR/app-64.7z' })
  expect(() => installerPayloadLayout([...direct, ...nested])).toThrow(/Ambiguous/)
  expect(() => installerPayloadLayout(direct.slice(0, 2))).toThrow(/missing/)
  expect(() => installerPayloadLayout([...nested, { path: 'other/app-64.7z' }])).toThrow(/Ambiguous/)
})

it('injects a separate validated config into the real esbuild pipeline without modifying the production file', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'hermes-local-build-'))
  directories.push(dir)
  const productionPath = path.join(dir, 'enterprise-deployment.json')
  const localPath = path.join(dir, 'local.json')
  const original = JSON.stringify({ enterprise_api_origin: 'https://enterprise.example.test', pre_release_access: { enabled: true } })
  await writeFile(productionPath, original)
  await writeFile(localPath, JSON.stringify(makeLocalDeployment(JSON.parse(original), 'http://localhost:18080')))
  const options = { stdin: { contents: `import deployment from ${JSON.stringify(productionPath)}; export default deployment`, resolveDir: dir },
    bundle: true, platform: 'node', format: 'cjs', write: false }
  const local = await build({ ...options, plugins: [await localDeploymentPlugin(localPath, productionPath)] })
  const normal = await build(options)
  const evaluate = output => {
    const context = { module: { exports: {} }, exports: {} }
    context.exports = context.module.exports
    vm.runInNewContext(output.outputFiles[0].text, context)
    return context.module.exports.default
  }
  expect(evaluate(local)).toMatchObject({ enterprise_api_origin: 'http://127.0.0.1:18080', local_verification_only: true, pre_release_access: { enabled: false } })
  expect(evaluate(normal)).toMatchObject(JSON.parse(original))
  expect(evaluate(normal)).not.toHaveProperty('local_verification_only')
  expect(await readFile(productionPath, 'utf8')).toBe(original)
  await writeFile(localPath, JSON.stringify({ enterprise_api_origin: 'https://enterprise.example.test', local_verification_only: true, pre_release_access: { enabled: false } }))
  await expect(localDeploymentPlugin(localPath, productionPath)).rejects.toThrow(/Local origin/)
})

it('rejects local configuration in the actual desktop main bundle until runtime isolation is integrated', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'hermes-local-main-'))
  directories.push(dir)
  const deploymentPath = path.resolve('assets/enterprise-deployment.json')
  const original = await readFile(deploymentPath, 'utf8')
  const localPath = path.join(dir, 'local.json')
  await writeFile(localPath, JSON.stringify(makeLocalDeployment(JSON.parse(original), 'http://127.0.0.1:18080')))
  const result = spawnSync(process.execPath, [path.resolve('scripts/bundle-electron-main.mjs'), '--local-deployment', localPath], { encoding: 'utf8' })
  expect(result.status).not.toBe(0)
  expect(result.stderr).toMatch(/runtime isolation is integrated/)
  expect(await readFile(deploymentPath, 'utf8')).toBe(original)
})

it.each(['https://example.test', 'http://192.168.1.5:18080', 'http://localhost', 'http://127.1:18080'])
('rejects unsafe packaging origin %s', value => { expect(() => validateLocalOrigin(value)).toThrow() })

it.skipIf(process.platform !== 'win32')('rejects an unsafe CLI origin before creating output or reading assets', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'hermes-local-cli-'))
  directories.push(dir)
  const output = path.join(dir, 'output')
  const script = path.resolve('scripts/pack-doudian-nsis.mjs')
  const result = spawnSync(process.execPath, [script, '--localprep', '--local-origin', 'https://example.test',
    '--assets-manifest', path.join(dir, 'missing.json'), '--seven-zip', path.join(dir, 'missing.exe'), '--output', output], { encoding: 'utf8' })
  expect(result.status).not.toBe(0)
  expect(result.stderr).toMatch(/allowed loopback host/)
  await expect(readFile(path.join(output, 'BUILD_INFO.json'))).rejects.toMatchObject({ code: 'ENOENT' })
})

it('records local endpoint only in a validated local verification build record', () => {
  const common = { version: '1', commit: 'a'.repeat(40), branch: 'fixture', electron: '1', node: '1', artifact: 'fixture-localprep.exe', bytes: 1,
    sha512: 'b'.repeat(128), assetContract: { file_count: 1, source_commit: 'c'.repeat(40), manifest_sha256: 'd'.repeat(64), asset_approval: 'UNVERIFIED' },
    verified: { passed: true, matched_count: 1, total_bytes: 1 } }
  expect(makeBuildInfo({ ...common, localprep: true, enterpriseOrigin: 'http://127.0.0.1:18080' })).toMatchObject({ local_verification_only: true, enterprise_origin: 'http://127.0.0.1:18080', published: false })
  expect(makeBuildInfo(common)).not.toHaveProperty('enterprise_origin')
})

it('creates an isolated installer configuration without changing production settings', () => {
  const production = { appId: 'production', productName: 'production', beforePack: 'production-hook', win: { signAndEditExecutable: true },
    protocols: [{ name: 'Production', schemes: ['hermes'] }],
    nsis: { shortcutName: 'production' }, extraResources: [{ from: 'doudian', to: 'doudian' }, { from: 'vpn.msi', to: 'openvpn-connect/vpn.msi' }] }
  const snapshot = JSON.stringify(production)
  const local = makeLocalBuilderConfig(production, 'installed-electron')
  expect(local.appId).not.toBe(production.appId)
  expect(local.productName).not.toBe(production.productName)
  expect(local.protocols).toEqual([])
  expect(local.appId).toBe('com.qiqiaoban.hermes-enterprise-assistant.localprep')
  expect(local.artifactName).toContain('-localprep.')
  expect(local.beforePack).toBe('scripts/before-pack-localprep.mjs')
  expect(local.extraResources).toEqual([{ from: 'doudian', to: 'doudian' }])
  expect(local.win.signAndEditExecutable).toBe(false)
  expect(JSON.stringify(production)).toBe(snapshot)
})

it('never registers a protocol locally and preserves production registration options', () => {
  const calls = []
  const app = { setAsDefaultProtocolClient: (...args) => calls.push(args) }
  const options = { local: true, protocol: 'hermes', defaultApp: true, argv: ['electron', 'main.js'], executable: 'electron.exe' }
  registerDesktopProtocol(app, options)
  registerDesktopProtocol(app, { ...options, defaultApp: false })
  expect(calls).toEqual([])
  registerDesktopProtocol(app, { ...options, local: false })
  expect(calls).toEqual([['hermes', 'electron.exe', [path.resolve('main.js')]]])
  registerDesktopProtocol(app, { ...options, local: false, defaultApp: false })
  expect(calls[1]).toEqual(['hermes'])
})

it('clears protocols and aligns the local app ID with the actual production builder config', async () => {
  const { build: production } = JSON.parse(await readFile(path.resolve('package.json'), 'utf8'))
  const local = makeLocalBuilderConfig(production, 'installed-electron')
  expect(production.protocols.flatMap(protocol => protocol.schemes)).toContain('hermes')
  expect(local.protocols).toEqual([])
  expect(local.appId).toBe(`${production.appId}.localprep`)
  expect(local.nsis.shortcutName).toBe(local.productName)
})
