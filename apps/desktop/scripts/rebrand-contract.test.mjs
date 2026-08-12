import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'vitest'

const desktopRoot = path.resolve(import.meta.dirname, '..')
const repositoryRoot = path.resolve(desktopRoot, '..', '..')
const packageJson = JSON.parse(fs.readFileSync(path.join(desktopRoot, 'package.json'), 'utf8'))

test('packaged product surfaces use the hermes_Agent brand', () => {
  assert.equal(packageJson.productName, 'hermes_Agent')
  assert.equal(packageJson.build.productName, 'hermes_Agent')
  assert.equal(packageJson.build.artifactName, 'hermes_Agent-${version}-${os}-${arch}.${ext}')
  assert.equal(packageJson.build.mac.extendInfo.CFBundleDisplayName, 'hermes_Agent')
  assert.equal(packageJson.build.mac.extendInfo.CFBundleName, 'hermes_Agent')
  assert.equal(packageJson.build.dmg.title, 'Install hermes_Agent')
  assert.equal(packageJson.build.nsis.shortcutName, 'hermes_Agent')
  assert.equal(packageJson.build.nsis.uninstallDisplayName, 'hermes_Agent')

  const html = fs.readFileSync(path.join(desktopRoot, 'index.html'), 'utf8')
  assert.match(html, /<title>hermes_Agent<\/title>/)
})

test('protocol and executable identities stay upgrade-compatible', () => {
  assert.equal(packageJson.name, 'hermes')
  assert.equal(packageJson.build.appId, 'com.nousresearch.hermes')
  assert.equal(packageJson.build.executableName, 'Hermes')
  assert.deepEqual(packageJson.build.protocols[0].schemes, ['hermes'])
  assert.equal(packageJson.build.mac.extendInfo.CFBundleExecutable, 'Hermes')
})

test('desktop packaging and renderer ship the hermes_Agent artwork', () => {
  const binaryAssets = ['assets/icon.png', 'assets/icon.ico', 'assets/icon.icns', 'public/apple-touch-icon.png']
  for (const relative of binaryAssets) {
    const asset = path.join(desktopRoot, relative)
    assert.equal(fs.existsSync(asset), true, `${relative} must exist`)
    assert.ok(fs.statSync(asset).size > 10_000, `${relative} must contain rendered artwork`)
  }

  const publicLogo = fs.readFileSync(path.join(desktopRoot, 'public', 'hermes-agent-logo.svg'), 'utf8')
  assert.match(publicLogo, /aria-label="hermes_Agent"/)
  assert.match(publicLogo, /<title>hermes_Agent<\/title>/)
})

test('upstream MIT attribution remains present', () => {
  const license = fs.readFileSync(path.join(repositoryRoot, 'LICENSE'), 'utf8')
  assert.match(license, /MIT License/)
  assert.match(license, /Nous Research/)
})
