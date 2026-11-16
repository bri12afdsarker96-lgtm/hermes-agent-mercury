import { EventEmitter } from 'node:events'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { DoudianController, DoudianHost } from './doudian-host'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) {
    await fs.rm(root, { recursive: true, force: true })
  }
})
const profileId = '11111111-2222-4333-8444-555555555555'

async function fixture(embeddedBrowser = 1) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hermes-embedded-engine-'))
  roots.push(root)
  const workbook = path.join(root, 'test.xlsx')
  await fs.writeFile(workbook, 'fixture')

  const execution = {
    connectionId: 'c'.repeat(32),
    profileId,
    shopId: '123',
    shopName: 'Shop',
    identify: vi.fn(async () => ({ shopId: '123', shopName: 'Shop' })),
    validate: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    command: vi.fn(async () => ({}))
  }

  let state = 'awaiting_confirmation'
  let kind = 'review'

  const host = {
    close: vi.fn(),
    request: vi.fn(async (method: string, _params?: Record<string, string>) => {
      if (method === 'initialize') {
        return {
          protocol: 1,
          version: '1.0.54',
          integration: 'hermes-review-v1',
          taskIsolation: 'hermes-task-isolation-v1',
          authorizationMode: 'enterprise-session-v1'
        }
      }

      if (method === 'capabilities') {
        return {
          protocol: 1,
          version: '1.0.54',
          authorized: true,
          authorizationMode: 'enterprise-session-v1',
          embeddedBrowser,
          reviewOptions: 1,
          paymentCdp: 1,
          paymentControls: 1
        }
      }

      if (method === 'shops') {
        return []
      }

      if (method === 'preparePayment') {
        kind = 'payment'
      }

      if (method === 'start' || method === 'startPayment') {
        state = 'running'
      }

      if (method === 'stop') {
        state = 'stopped'
      }

      return { taskId: 'a'.repeat(32), kind, state, saved: 0, summary: '', error: '', messages: [] }
    })
  }

  const deps = {
    platform: 'win32',
    root,
    authorize: vi.fn(async () => 'scope'),
    isCurrent: vi.fn(() => true),
    verify: async () => 'fixture-exe',
    chooseWorkbook: async () => workbook,
    createHost: () => host,
    connectBrowser: vi.fn(async (_id: string, _target: string) => execution),
    listBrowserProfiles: vi.fn(async () => [
      {
        id: profileId,
        displayName: 'Shop',
        tenantId: 't',
        principalId: 'p',
        shopId: '123',
        shopName: 'Shop',
        createdAt: '',
        checkedAt: '',
        loginState: 'verified' as const
      }
    ])
  }

  const controller = new DoudianController(deps)
  const selected = await controller.operate({ action: 'chooseWorkbook', sessionId: 's' })

  return { controller, deps, execution, host, workbookId: selected.workbook!.id }
}

describe('real controller embedded shop binding', () => {
  it('does not preflight or start when live login verification is unavailable', async () => {
    const f = await fixture()
    const request = { sessionId: 's', action: 'prepare' as const, shopId: profileId,
      browserProfileId: profileId, workbookId: f.workbookId, startRow: '1', maxRows: '0', concurrency: '4' }
    f.deps.connectBrowser.mockRejectedValueOnce(new Error('SHOP_PROFILE_IDENTITY_UNAVAILABLE'))
    expect((await f.controller.operate(request)).error).toBe('SHOP_PROFILE_IDENTITY_UNAVAILABLE')
    expect(f.host.request.mock.calls.some(([method]) => ['prepare', 'start'].includes(method))).toBe(false)
    const prepared = await f.controller.operate(request)
    expect(prepared.ok).toBe(true)
    f.execution.validate.mockRejectedValueOnce(new Error('SHOP_PROFILE_IDENTITY_UNAVAILABLE'))
    expect((await f.controller.operate({ sessionId: 's', action: 'start', taskId: prepared.task!.taskId! })).error)
      .toBe('SHOP_PROFILE_IDENTITY_UNAVAILABLE')
    expect(f.host.request.mock.calls.some(([method]) => method === 'start')).toBe(false)
    expect((await f.controller.operate({ sessionId: 's', action: 'start', taskId: prepared.task!.taskId! })).ok).toBe(true)
    expect(f.host.request.mock.calls.filter(([method]) => method === 'start')).toHaveLength(1)
    f.controller.close()
  })

  it.each(['review', 'payment'] as const)(
    'passes the verified %s binding through prepare and rechecks it at start',
    async kind => {
      const f = await fixture()

      const prepared = await f.controller.operate(
        kind === 'review'
          ? {
              sessionId: 's',
              action: 'prepare',
              shopId: profileId,
              browserProfileId: profileId,
              workbookId: f.workbookId,
              startRow: '2',
              maxRows: '1'
            }
          : {
              sessionId: 's',
              action: 'preparePayment',
              browserProfileId: profileId,
              workbookId: f.workbookId,
              amount: '7.25',
              startRow: '2',
              maxRows: '1',
              mode: 'standard',
              transport: 'cdp'
            }
      )

      expect(prepared.ok).toBe(true)
      expect(f.deps.connectBrowser).toHaveBeenCalledWith(profileId, kind === 'review' ? 'merchant' : 'feige')
      expect(
        f.host.request.mock.calls.find(([method]) => method === (kind === 'review' ? 'prepare' : 'preparePayment'))?.[1]
      ).toMatchObject({ browserConnectionId: 'c'.repeat(32), platformShopId: '123', platformShopName: 'Shop' })
      expect(
        (
          await f.controller.operate({
            sessionId: 's',
            action: kind === 'review' ? 'start' : 'startPayment',
            taskId: prepared.task!.taskId!
          })
        ).ok
      ).toBe(true)
      expect(f.execution.validate).toHaveBeenCalledOnce()
      await f.controller.operate({ sessionId: 's', action: 'stop', taskId: prepared.task!.taskId! })
      expect(f.execution.close).toHaveBeenCalledOnce()
    }
  )

  it('lists saved profiles without exposing storage paths and rejects old modules before acquiring a browser', async () => {
    const f = await fixture(0)
    expect((await f.controller.operate({ sessionId: 's', action: 'shops' })).shops).toEqual([
      { id: profileId, name: 'Shop', platformId: '123', status: 'verified', browserProfileId: profileId }
    ])
    const result = await f.controller.operate({
      sessionId: 's',
      action: 'prepare',
      shopId: profileId,
      browserProfileId: profileId,
      workbookId: f.workbookId
    })
    expect(result).toEqual({ ok: false, error: 'SHOP_BROWSER_MODULE_INCOMPATIBLE' })
    expect(f.deps.connectBrowser).not.toHaveBeenCalled()
  })

  it('blocks changed identity and releases the profile on logout without starting the engine', async () => {
    const f = await fixture()
    const prepared = await f.controller.operate({
      sessionId: 's',
      action: 'prepare',
      shopId: profileId,
      browserProfileId: profileId,
      workbookId: f.workbookId
    })
    f.execution.validate.mockRejectedValue(new Error('SHOP_PROFILE_IDENTITY_CHANGED'))
    expect(
      (await f.controller.operate({ sessionId: 's', action: 'start', taskId: prepared.task!.taskId! })).error
    ).toBe('SHOP_PROFILE_IDENTITY_CHANGED')
    expect(f.host.request.mock.calls.some(([method]) => method === 'start')).toBe(false)
    f.deps.isCurrent.mockReturnValue(false)
    await f.controller.operate({ sessionId: 's', action: 'status' })
    expect(f.execution.close).toHaveBeenCalledOnce()
  })

  it('uses the actual host private stdio event and response envelope', async () => {
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn()
    })
    const spawn = vi.fn(() => child)
    const command = vi.fn(async () => ({ result: { value: 42 } }))
    const written: string[] = []
    child.stdin.on('data', chunk => written.push(chunk.toString()))
    const host = new DoudianHost('verified-exe', spawn as never, spawn as never, command)
    child.stdout.write(
      JSON.stringify({
        event: 'browserCommand',
        id: 'a'.repeat(32),
        connectionId: 'c'.repeat(32),
        targetId: 'root',
        method: 'Runtime.evaluate',
        params: { expression: '42', returnByValue: true, awaitPromise: true }
      }) + '\n'
    )
    await vi.waitFor(() => expect(written).toHaveLength(1))
    const response = JSON.parse(written[0])
    expect(response.method).toBe('browserResult')
    expect(response.params.commandId).toBe('a'.repeat(32))
    expect(JSON.parse(response.params.payload)).toEqual({ ok: true, result: { result: { value: 42 } } })
    expect(command).toHaveBeenCalledOnce()
    host.close()
  })
})
