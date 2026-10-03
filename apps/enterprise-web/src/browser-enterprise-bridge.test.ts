import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { enterpriseRequestTimeoutMs } from '../../desktop/electron/enterprise-transport'

let module: typeof import('./browser-enterprise-bridge')
let bridge: NonNullable<Window['hermesDesktop']['enterprise']>
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
const fetchMock = vi.fn<typeof fetch>()

beforeEach(async () => {
  vi.resetModules()
  vi.useFakeTimers()
  fetchMock.mockReset().mockImplementation(async () => json({ ok: true, principal_id: 'test' }))
  vi.stubGlobal('fetch', fetchMock)
  module = await import('./browser-enterprise-bridge')
  module.installEnterpriseWebBridge()
  bridge = window.hermesDesktop.enterprise!
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function session() {
  const result = await bridge.autoConnect()
  if (!result.ok) {
    throw new Error('fixture login failed')
  }
  return result.sessionId
}

it('allows an answer after 20 seconds but aborts at the desktop assist budget, without retrying POST', async () => {
  const sessionId = await session()
  let signal: AbortSignal
  let reply: (response: Response) => void = () => {}
  fetchMock.mockImplementation(
    (_url, init) =>
      new Promise((resolve, reject) => {
        signal = init!.signal!
        reply = resolve
        signal.addEventListener('abort', () => reject(new Error('aborted')))
      })
  )
  const request = () => bridge.request({ sessionId, path: '/api/tenant-ai-assist', method: 'POST', body: {} })
  const delayed = request()
  await vi.advanceTimersByTimeAsync(21_000)
  expect(signal!.aborted).toBe(false)
  reply(json({ answer_text: 'delayed answer' }))
  expect(await delayed).toMatchObject({ kind: 'ok', data: { answer_text: 'delayed answer' } })
  fetchMock.mockClear()
  const expired = request()
  await vi.advanceTimersByTimeAsync(enterpriseRequestTimeoutMs('/api/tenant-ai-assist', 20_000) - 1)
  expect(signal!.aborted).toBe(false)
  await vi.advanceTimersByTimeAsync(1)
  expect(await expired).toMatchObject({ kind: 'error', status: 504 })
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(vi.getTimerCount()).toBe(0)
})

it('retains the shorter deadline for non-AI business writes', async () => {
  const sessionId = await session()
  fetchMock.mockImplementation(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init!.signal!.addEventListener('abort', () => reject(new Error('aborted')))
      })
  )
  const pending = bridge.request({ sessionId, path: '/api/business-followup-manage', method: 'POST', body: {} })
  await vi.advanceTimersByTimeAsync(20_000)
  expect(await pending).toMatchObject({ kind: 'error', status: 504 })
})

it('lifecycle disconnect never logs out the browser cookie session', async () => {
  const id = await session()
  fetchMock.mockClear()
  await bridge.disconnect(id)
  expect(fetchMock).not.toHaveBeenCalled()
  expect(await bridge.autoConnect()).toMatchObject({ ok: true })
})

it.each([200, 401])('explicit logout clears sessions after server confirmation (%i)', async status => {
  const id = await session()
  fetchMock.mockResolvedValue(json({ ok: true }, status))
  await module.logoutEnterpriseWebSession()
  expect(fetchMock).toHaveBeenLastCalledWith(
    '/api/browser-logout',
    expect.objectContaining({
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }
    })
  )
  expect(await bridge.request({ sessionId: id, path: '/api/whoami' })).toMatchObject({ status: 401 })
  expect(await bridge.autoConnect()).toMatchObject({ ok: false, code: 'no_native_session' })
})

it('a failed logout is visible, retains the session and permits an explicit retry', async () => {
  const id = await session()
  fetchMock.mockResolvedValueOnce(json({}, 503))
  await expect(module.logoutEnterpriseWebSession()).rejects.toThrow('logout failed')
  expect(await bridge.request({ sessionId: id, path: '/api/whoami' })).toMatchObject({ kind: 'ok' })
  await module.logoutEnterpriseWebSession()
  expect(await bridge.autoConnect()).toMatchObject({ ok: false })
})

it('does not claim logout succeeded for a proxy HTML response', async () => {
  const id = await session()
  fetchMock.mockResolvedValueOnce(new Response('<html>proxy page</html>', { status: 200 }))
  await expect(module.logoutEnterpriseWebSession()).rejects.toThrow('logout failed')
  expect(await bridge.request({ sessionId: id, path: '/api/whoami' })).toMatchObject({ kind: 'ok' })
})

it('fences a late autoConnect response across explicit logout and allows fresh password login', async () => {
  let resolveWhoami: (value: Response) => void = () => {}
  fetchMock.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        resolveWhoami = resolve
      })
  )
  const late = bridge.autoConnect()
  await module.logoutEnterpriseWebSession()
  resolveWhoami(json({ principal_id: 'test' }))
  expect(await late).toMatchObject({ ok: false })
  expect(await bridge.loginWithPassword!({ loginName: 'fixture', password: 'fixture-only' })).toMatchObject({
    ok: true
  })
  expect(await bridge.autoConnect()).toMatchObject({ ok: true })
})
