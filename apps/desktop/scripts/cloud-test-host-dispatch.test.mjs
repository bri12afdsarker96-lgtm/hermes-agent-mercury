import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const compiled = await build({ entryPoints: [fileURLToPath(new URL('../electron/doudian-host.ts', import.meta.url))],
  bundle: true, platform: 'node', format: 'esm', write: false })
const { DoudianController, DoudianHost } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`)

function fixture(cloudTestBuild, isolatedHost = false, actualRoot = 'C:\\synthetic-test\\td', workbook = null) {
  const calls = []
  const host = { close() {}, async request(method) {
    calls.push(method)
    if (method === 'initialize') return { protocol: 1, version: '1.0.54', integration: 'hermes-review-v1', taskIsolation: 'hermes-task-isolation-v1', authorizationMode: 'enterprise-session-v1', ...(isolatedHost ? { localTestIsolation: 'profile-isolated-coordination-shared-v1', localTestRoot: actualRoot } : {}) }
    if (method === 'capabilities') return { protocol: 1, version: '1.0.54', authorized: true, authorizationMode: 'enterprise-session-v1', paymentUi: 1, shopManagement: 1, embeddedBrowser: 1, paymentCdp: 1 }
    if (method === 'shopManagementList') return []
    if (['prepare', 'preparePayment', 'start', 'startPayment'].includes(method)) return {
      taskId: 'c'.repeat(32), kind: method === 'preparePayment' || method === 'startPayment' ? 'payment' : 'review',
      state: method.startsWith('prepare') ? 'awaiting_confirmation' : 'running', saved: 0, summary: '', error: '', messages: [] }
    return { ok: true }
  } }
  return { calls, controller: new DoudianController({ platform: 'win32', root: 'fixture', cloudTestBuild, hostEnvironment: { HERMES_TD_LOCAL_TEST_ROOT: 'C:\\synthetic-test\\td' },
    authorize: async () => 'a'.repeat(64), isCurrent: () => true, chooseWorkbook: async () => workbook,
    verify: async () => 'fixture.exe', createHost: () => host,
    connectBrowser: async () => ({ connectionId: 'a'.repeat(32), shopId: 'shop-1', shopName: 'synthetic shop', validate: async () => {}, close: async () => {}, command: async () => ({}) }) }) }
}

test('test build rejects legacy payment window before starting host', async () => {
  const f = fixture(true)
  const result = await f.controller.operate({ sessionId: 'fixture', action: 'openPayment' })
  assert.equal(result.ok, false)
  assert.equal(result.error, 'DOUDIAN_TEST_LEGACY_PAYMENT_DISABLED')
  assert.deepEqual(f.calls, [])
})

for (const action of ['openReview', 'openFeige', 'manageShops']) {
  test(`test build rejects legacy ${action} window before starting host`, async () => {
    const f = fixture(true)
    const result = await f.controller.operate({ sessionId: 'fixture', action })
    assert.equal(result.ok, false)
    assert.equal(result.error, 'DOUDIAN_TEST_LEGACY_WINDOW_DISABLED')
    assert.deepEqual(f.calls, [])
  })
}

test('cloud test rejects an old host that does not attest the profile and coordination contract', async () => {
  const f = fixture(true)
  const result = await f.controller.operate({ sessionId: 'fixture', action: 'capabilities' })
  assert.equal(result.ok, false)
  assert.equal(result.error, 'DOUDIAN_TEST_HOST_ISOLATION_UNVERIFIED')
  assert.deepEqual(f.calls, ['initialize'])
})

test('cloud test permits capability discovery from a host attesting the isolation contract', async () => {
  const f = fixture(true, true)
  const result = await f.controller.operate({ sessionId: 'fixture', action: 'capabilities' })
  assert.equal(result.ok, true)
  assert.ok(f.calls.includes('capabilities'))
})

test('cloud test rejects a host that declares support but reports a different active root', async () => {
  const f = fixture(true, true, 'C:\\other\\td')
  const result = await f.controller.operate({ sessionId: 'fixture', action: 'capabilities' })
  assert.equal(result.ok, false)
  assert.equal(result.error, 'DOUDIAN_TEST_HOST_ISOLATION_UNVERIFIED')
  assert.deepEqual(f.calls, ['initialize'])
})

test('Windows path case and trailing separators do not cause a false handshake failure', async () => {
  const f = fixture(true, true, 'c:\\SYNTHETIC-TEST\\TD\\')
  const result = await f.controller.operate({ sessionId: 'fixture', action: 'capabilities' })
  assert.equal(result.ok, true)
})

for (const kind of ['review', 'payment']) {
  test(`attested test host permits embedded ${kind} prepare and start`, async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 't105-host-fixture-'))
    const file = path.join(dir, 'synthetic.xlsx')
    await writeFile(file, 'synthetic')
    const f = fixture(true, true, 'C:\\synthetic-test\\td', file)
    try {
      const choice = await f.controller.operate({ sessionId: 'fixture', action: 'chooseWorkbook' })
      assert.equal(choice.ok, true)
      const profile = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
      const prepare = kind === 'review'
        ? { action: 'prepare', shopId: profile, browserProfileId: profile, workbookId: choice.workbook.id }
        : { action: 'preparePayment', browserProfileId: profile, transport: 'cdp', workbookId: choice.workbook.id, amount: '1', startRow: '1', maxRows: '0', mode: 'standard' }
      const prepared = await f.controller.operate({ sessionId: 'fixture', ...prepare })
      assert.equal(prepared.ok, true)
      const started = await f.controller.operate({ sessionId: 'fixture', action: kind === 'review' ? 'start' : 'startPayment', taskId: 'c'.repeat(32) })
      assert.equal(started.ok, true)
      assert.ok(f.calls.includes(prepare.action))
    } finally {
      f.controller.close()
      await rm(dir, { recursive: true, force: true })
    }
  })
}

test('attested test host permits embedded shop management dispatch', async () => {
  const f = fixture(true, true)
  const reply = await f.controller.operate({ sessionId: 'fixture', action: 'shopManagementList' })
  assert.equal(reply.ok, true)
  assert.ok(f.calls.includes('shopManagementList'))
})

for (const action of ['prepare', 'preparePayment']) {
  test(`test mode rejects non-embedded ${action} before starting TD`, async () => {
    const f = fixture(true, true)
    const result = await f.controller.operate({ sessionId: 'fixture', action })
    assert.equal(result.ok, false)
    assert.equal(result.error, 'DOUDIAN_TEST_EMBEDDED_BROWSER_REQUIRED')
    assert.deepEqual(f.calls, [])
  })
}

test('production still dispatches legacy payment window', async () => {
  const f = fixture(false)
  await f.controller.operate({ sessionId: 'fixture', action: 'openPayment' })
  assert.ok(f.calls.includes('openPayment'))
})

test('actual host forwards its explicit root to host and foreground helper children', async () => {
  const environment = { ...process.env, HERMES_TD_LOCAL_TEST_ROOT: 'synthetic-test-root' }
  let child
  let helperRoot
  const launch = (_file, _args, options) => {
    child = spawn(process.execPath, ['-e', `process.stdin.once('data', data => {
      const r = JSON.parse(data.toString());
      process.stdout.write(JSON.stringify({id:r.id,ok:true,result:process.env.HERMES_TD_LOCAL_TEST_ROOT})+'\\n')
    }); setInterval(() => {}, 1000)`], { ...options, cwd: undefined, windowsHide: true })
    return child
  }
  const foreground = (_file, _args, options) => {
    helperRoot = options.env.HERMES_TD_LOCAL_TEST_ROOT
    return spawn(process.execPath, ['-e', 'process.exit(0)'], { env: options.env, stdio: 'ignore', windowsHide: true })
  }
  const host = new DoudianHost('fixture.exe', launch, foreground, undefined, environment)
  try {
    assert.equal(await host.request('startPayment', { taskId: 'a'.repeat(32) }), 'synthetic-test-root')
    assert.equal(helperRoot, 'synthetic-test-root')
  } finally {
    host.close()
    child?.kill()
  }
})
