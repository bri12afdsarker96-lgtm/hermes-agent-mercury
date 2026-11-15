import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { test } from 'vitest'
import { observeBackendStartup } from './backend-child'

test('fast backend exit preserves its import failure before ownership can be registered', async () => {
  const child = spawn(process.execPath, ['-e', 'process.stderr.write("ModuleNotFoundError: No module named ruamel\\n");process.exit(23)'])
  const startup = observeBackendStartup(child)
  await new Promise(resolve => child.once('close', resolve))
  assert.equal(startup.failed, true)
  assert.match(startup.error(new Error('PID already gone')).message, /23.*ModuleNotFoundError: No module named ruamel/)
  startup.dispose()
  assert.equal(child.stderr!.listenerCount('data'), 0)
  assert.equal(child.listenerCount('error'), 0)
})

test('missing executable reports the spawn failure without an unhandled error', async () => {
  const child = spawn('hermes-nonexistent-backend-fixture', [])
  const startup = observeBackendStartup(child)
  await new Promise(resolve => child.once('close', resolve))
  assert.equal(startup.failed, true)
  assert.match(startup.error(new Error('PID unavailable')).message, /ENOENT/)
  startup.dispose()
})

test('startup observation leaves a live process and ownership failure distinct', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'])
  const startup = observeBackendStartup(child)
  await new Promise(resolve => child.once('spawn', resolve))
  assert.equal(startup.failed, false)
  startup.dispose()
  child.kill()
  await new Promise(resolve => child.once('close', resolve))
})
