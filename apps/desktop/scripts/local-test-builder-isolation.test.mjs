import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { makeLocalBuilderConfig, registerDesktopProtocol } from './local-deployment.mjs'
import * as deployment from './local-deployment.mjs'
import { makeBuildInfo } from './pack-doudian-nsis.mjs'

test('local builder identity and publication are separate from production', () => {
  const { build: production } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)))
  const original = JSON.stringify(production)
  const local = makeLocalBuilderConfig(production, 'fixture-electron')
  assert.notEqual(local.executableName, production.executableName)
  assert.notEqual(local.appId, production.appId)
  assert.deepEqual(local.protocols, [])
  assert.equal(local.publish, null)
  assert.equal(JSON.stringify(production), original)
})

test('cloud test paths are separate and reject production paths and ambiguous input', () => {
  assert.equal(typeof deployment.cloudTestPaths, 'function')
  const opts = { appData: 'C:\\Users\\fixture\\AppData\\Roaming', protectedPaths: ['C:\\Users\\fixture\\AppData\\Roaming\\hermes', 'C:\\Users\\fixture\\AppData\\Local\\hermes'], pathModule: path.win32 }
  const defaults = deployment.cloudTestPaths({ ...opts, argv: [] })
  assert.equal(defaults.userData, 'C:\\Users\\fixture\\AppData\\Roaming\\Hermes-Enterprise-LocalTest\\electron')
  assert.equal(defaults.hermesHome, 'C:\\Users\\fixture\\AppData\\Roaming\\Hermes-Enterprise-LocalTest\\hermes-home')
  assert.throws(() => deployment.cloudTestPaths({ ...opts, argv: ['--hermes-test-data-root=C:\\Users\\fixture\\AppData\\Roaming\\hermes'] }), /overlap/i)
  assert.throws(() => deployment.cloudTestPaths({ ...opts, argv: ['--hermes-test-data-root=relative'] }), /absolute/i)
  assert.throws(() => deployment.cloudTestPaths({ ...opts, argv: ['--hermes-test-data-root=C:\\test', '--hermes-test-data-root=C:\\other'] }), /one/i)
  assert.throws(() => deployment.cloudTestPaths({ ...opts, argv: ['--hermes-test-data-root=C:\\alias'],
    canonicalize: value => value.toLowerCase() === 'c:\\alias' ? 'C:\\Users\\fixture\\AppData\\Roaming\\hermes' : value }), /overlap/i)
})

test('existing protocol gate suppresses registration only for the local selection', () => {
  const calls = []
  const app = { setAsDefaultProtocolClient: (...args) => calls.push(args) }
  const options = { protocol: 'hermes', defaultApp: false, argv: [], executable: 'fixture.exe' }
  registerDesktopProtocol(app, { ...options, local: true })
  assert.deepEqual(calls, [])
  registerDesktopProtocol(app, { ...options, local: false })
  assert.deepEqual(calls, [['hermes']])
})

test('real cloud test build has a separate identity and no OS protocol or publish target', () => {
  assert.equal(typeof deployment.makeCloudTestBuilderConfig, 'function')
  const { build } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)))
  const testConfig = deployment.makeCloudTestBuilderConfig(build, 'fixture-electron')
  assert.notEqual(testConfig.appId, build.appId)
  assert.notEqual(testConfig.executableName, build.executableName)
  assert.notEqual(testConfig.productName, build.productName)
  assert.deepEqual(testConfig.protocols, [])
  assert.equal(testConfig.publish, null)
  assert.equal(testConfig.nsis.runAfterFinish, false)
  assert.equal(testConfig.nsis.allowToChangeInstallationDirectory, false)
  assert.notEqual(testConfig.extraMetadata.name, 'hermes')
  assert.notEqual(testConfig.nsis.include, build.nsis.include)
})

test('startup applies test profile and identity before instance lock while production stays unchanged', () => {
  assert.equal(typeof deployment.applyCloudTestStartup, 'function')
  const calls = []
  const app = { setPath: (...args) => calls.push(['path', ...args]), setName: value => calls.push(['name', value]), setAppUserModelId: value => calls.push(['id', value]) }
  const opts = { app, platform: 'win32', appData: 'C:\\test-data', argv: [], protectedPaths: [], pathModule: path.win32, mkdir: value => calls.push(['mkdir', value]) }
  assert.equal(deployment.applyCloudTestStartup({ ...opts, enabled: false }), null)
  assert.deepEqual(calls, [])
  const result = deployment.applyCloudTestStartup({ ...opts, enabled: true })
  assert.deepEqual(calls.map(call => call[0]), ['mkdir', 'path', 'name', 'id'])
  assert.equal(calls[1][2], result.userData)
  assert.equal(calls[3][1], 'com.qiqiaoban.hermes-enterprise-assistant.localtest')
})

test('cloud test build record states real cloud and cannot be published', () => {
  const common = { version: '1', commit: 'a'.repeat(40), branch: 'fixture', electron: '1', node: '1', artifact: 'fixture-localtest.exe', bytes: 1,
    sha512: 'b'.repeat(128), assetContract: { file_count: 1, source_commit: 'c'.repeat(40), manifest_sha256: 'd'.repeat(64), asset_approval: 'UNTRUSTED', candidate_status: 'UNTRUSTED' },
    verified: { passed: true, matched_count: 1, total_bytes: 1 } }
  const info = makeBuildInfo({ ...common, cloudTest: true, enterpriseOrigin: 'https://enterprise.example.test' })
  assert.equal(info.cloud_test_build, true)
  assert.equal(info.test_only, true)
  assert.equal(info.local_verification_only, false)
  assert.equal(info.published, false)
  assert.equal(info.cloud_data_isolated, false)
  assert.equal(info.publication_allowed, false)
  assert.equal(info.enterprise_origin, 'https://enterprise.example.test')
})

test('TD root is passed only by the cloud test build and overrides inherited input', () => {
  assert.equal(typeof deployment.tdHostEnvironment, 'function')
  const inherited = { SYSTEMROOT: 'C:\\Windows', HERMES_TD_LOCAL_TEST_ROOT: 'C:\\unexpected' }
  const options = { inherited, root: 'C:\\test-root', pathModule: path.win32 }
  assert.deepEqual(deployment.tdHostEnvironment({ ...options, cloudTest: true }), { SYSTEMROOT: 'C:\\Windows', HERMES_TD_LOCAL_TEST_ROOT: 'C:\\test-root\\td' })
  assert.deepEqual(deployment.tdHostEnvironment({ ...options, cloudTest: false }), { SYSTEMROOT: 'C:\\Windows' })
  assert.equal(inherited.HERMES_TD_LOCAL_TEST_ROOT, 'C:\\unexpected')
})

test('TD test root is removed case-insensitively from inherited Windows environment', () => {
  const inherited = { SystemRoot: 'C:\\Windows', hermes_td_local_test_root: 'C:\\unexpected' }
  const env = deployment.tdHostEnvironment({ inherited, cloudTest: false })
  assert.deepEqual(env, { SystemRoot: 'C:\\Windows' })
})
