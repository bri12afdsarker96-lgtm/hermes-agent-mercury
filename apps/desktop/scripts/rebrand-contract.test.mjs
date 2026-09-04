import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'vitest'

const desktopRoot = path.resolve(import.meta.dirname, '..')
const repositoryRoot = path.resolve(desktopRoot, '..', '..')
const packageJson = JSON.parse(fs.readFileSync(path.join(desktopRoot, 'package.json'), 'utf8'))

test('packaged product surfaces use the Hermes-企业助手 brand', () => {
  assert.equal(packageJson.productName, 'Hermes-企业助手')
  assert.equal(packageJson.build.productName, 'Hermes-企业助手')
  assert.equal(packageJson.build.artifactName, 'Hermes-企业助手-${version}-${arch}.${ext}')
  assert.equal(packageJson.build.mac.extendInfo.CFBundleDisplayName, 'Hermes-企业助手')
  assert.equal(packageJson.build.mac.extendInfo.CFBundleName, 'Hermes-企业助手')
  assert.equal(packageJson.build.dmg.title, 'Install Hermes-企业助手')
  assert.equal(packageJson.build.nsis.shortcutName, 'Hermes-企业助手')
  assert.equal(packageJson.build.nsis.uninstallDisplayName, 'Hermes-企业助手')

  const html = fs.readFileSync(path.join(desktopRoot, 'index.html'), 'utf8')
  assert.match(html, /<title>Hermes-企业助手<\/title>/)
})

test('protocol identity stays upgrade-compatible while executable is rebranded', () => {
  assert.equal(packageJson.name, 'hermes')
  assert.equal(packageJson.build.appId, 'com.qiqiaoban.hermes-enterprise-assistant')
  assert.equal(packageJson.build.executableName, 'HermesEnterpriseAssistant')
  assert.deepEqual(packageJson.build.protocols[0].schemes, ['hermes'])
  assert.equal(packageJson.build.mac.extendInfo.CFBundleExecutable, 'HermesEnterpriseAssistant')
})

test('desktop packaging and renderer ship the enterprise brand artwork', () => {
  const binaryAssets = [
    'assets/brand/hermes-mark-hires.png',
    'assets/brand/hermes-mark-hires.ico',
    'public/apple-touch-icon.png'
  ]
  for (const relative of binaryAssets) {
    const asset = path.join(desktopRoot, relative)
    assert.equal(fs.existsSync(asset), true, `${relative} must exist`)
    assert.ok(fs.statSync(asset).size > 10_000, `${relative} must contain rendered artwork`)
  }

  const brandMark = fs.readFileSync(path.join(desktopRoot, 'assets', 'brand', 'hermes-mark.svg'), 'utf8')
  assert.match(brandMark, /aria-label="Hermes"/)
  assert.equal(packageJson.build.icon, 'assets/brand/hermes-mark-hires.png')
  assert.equal(packageJson.build.win.icon, 'assets/brand/hermes-mark-hires.ico')
  assert.deepEqual(packageJson.build.extraResources.slice(1), [
    { from: 'assets/brand/hermes-mark-hires.ico', to: 'brand-icon.ico' },
    { from: 'src/fonts/LICENSE-HarmonyOS-Sans.txt', to: 'licenses/LICENSE-HarmonyOS-Sans.txt' }
  ])
})

test('upstream MIT attribution remains present', () => {
  const license = fs.readFileSync(path.join(repositoryRoot, 'LICENSE'), 'utf8')
  assert.match(license, /MIT License/)
  assert.match(license, /Nous Research/)
})
