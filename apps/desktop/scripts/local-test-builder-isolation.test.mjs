import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { makeLocalBuilderConfig, registerDesktopProtocol } from './local-deployment.mjs'

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

test('existing protocol gate suppresses registration only for the local selection', () => {
  const calls = []
  const app = { setAsDefaultProtocolClient: (...args) => calls.push(args) }
  const options = { protocol: 'hermes', defaultApp: false, argv: [], executable: 'fixture.exe' }
  registerDesktopProtocol(app, { ...options, local: true })
  assert.deepEqual(calls, [])
  registerDesktopProtocol(app, { ...options, local: false })
  assert.deepEqual(calls, [['hermes']])
})
