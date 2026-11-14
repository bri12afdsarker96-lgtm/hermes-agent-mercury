import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import path from 'node:path'

export function testDoudianHost(executable) {
  const requests = [
    ['status', {}],
    ['initialize', { scope: '../invalid' }],
    ['initialize', { scope: randomBytes(32).toString('hex') }],
    ['capabilities', {}],
    ['status', {}],
    ['shops', {}],
    ['prepare', { shopId: 'a'.repeat(32), workbook: 'C:\\not-a-real-workbook.xlsx', command: 'forbidden' }],
    ['start', { taskId: 'a'.repeat(32) }],
    ['payment', {}],
    ['initialize', { scope: 'b'.repeat(64) }],
    ['resolvePaymentAuthorization', { authorizationId: 'd'.repeat(32), allowed: 'true' }]
  ].map(([method, params]) => ({ id: randomBytes(16).toString('hex'), method, params }))
  const child = spawnSync(executable, ['--hermes-review-host'], {
    input: requests.map(request => JSON.stringify(request)).join('\n') + '\n',
    encoding: 'utf8', windowsHide: true, shell: false, cwd: path.dirname(executable), timeout: 20000, maxBuffer: 262144
  })
  assert.equal(child.error, undefined)
  assert.equal(child.status, 0, child.stderr)
  const replies = child.stdout.trim().split('\n').map(line => JSON.parse(line))
  assert.equal(replies.length, requests.length)
  replies.forEach((reply, i) => assert.equal(reply.id, requests[i].id))
  assert.equal(replies[0].error, 'NOT_INITIALIZED')
  assert.equal(replies[1].error, 'INVALID_SCOPE')
  assert.equal(replies[2].result.integration, 'hermes-review-v1')
  assert.equal(replies[2].result.version, '1.0.54')
  assert.equal(replies[2].result.taskIsolation, 'hermes-task-isolation-v1')
  assert.equal(replies[3].result.authorized, false)
  assert.equal(replies[3].result.licenseVerification, 'unverified')
  assert.equal(replies[3].result.licenseActivation, 0)
  assert.equal(replies[3].result.reviewOptions, 1)
  assert.equal(replies[3].result.taskIsolation, 'hermes-task-isolation-v1')
  assert.equal(typeof replies[3].result.chrome, 'boolean')
  assert.equal(replies[3].result.paymentUi, 1)
  assert.equal(replies[3].result.reviewUi, 1)
  assert.equal(replies[3].result.feigeUi, 1)
  assert.equal(replies[4].result.state, 'idle')
  assert.equal(replies[4].result.saved, 0)
  assert.deepEqual(replies[5].result, [])
  assert.equal(replies[6].error, 'INVALID_REQUEST')
  assert.equal(replies[7].error, 'TASK_NOT_FOUND')
  assert.equal(replies[8].error, 'METHOD_NOT_ALLOWED')
  assert.equal(replies[9].error, 'INVALID_SCOPE')
  assert.equal(replies[10].result.accepted, false)
  const direct = spawnSync(executable, ['--payment'], { encoding: 'utf8', windowsHide: true, shell: false, timeout: 20000 })
  assert.equal(direct.status, 2)
  assert.match(direct.stderr, /HERMES_ENTRY_REQUIRED/)
  console.log('PASS: real Windows host handshake, isolated local session, empty scoped shops, task capability and forbidden commands. Enterprise identity is verified by controller tests. No live account, workbook, browser or network used.')
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  if (process.platform !== 'win32' || !process.argv[2]) { throw new Error('Windows and an explicit built executable are required') }
  testDoudianHost(path.resolve(process.argv[2]))
}
