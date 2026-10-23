import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LanghuaConfigEntry } from './langhua-config-panel'
import { enterpriseClientErrorForStatus } from './runtime-errors'
import type { EnterpriseClientRuntime } from './runtime'

const CANARY = 'synthetic-langhua-key-not-for-output'
const STATUS = {configured: true, connection_id: 'langhua_synthetic', version: 1, enabled: false,
  encryption_ready: true, credential_state: 'unverified', gateway_url: 'https://api6.beikke.com/aibot/v1'}

function runtime(get = vi.fn(async () => STATUS), post = vi.fn(async () => ({...STATUS, version: 2}))) {
  return {get, post, disconnect: vi.fn(), serverOrigin: 'https://enterprise.example'} as unknown as EnterpriseClientRuntime
}
function deferred<T = unknown>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no})
  return {promise, resolve, reject}
}
function toggle(open = true) {
  const details = screen.getByText('浪花数字员工连接配置').closest('details')!
  details.open = open
  fireEvent(details, new Event('toggle'))
}
async function ready() {
  toggle()
  await waitFor(() => expect((screen.getByLabelText('AppKey') as HTMLInputElement).disabled).toBe(false))
}
function inputKey() {
  const input = screen.getByLabelText('AppKey') as HTMLInputElement
  fireEvent.change(input, {target: {value: CANARY}})
  return input
}

afterEach(cleanup)

describe('protected Langhua configuration form', () => {
  it('makes no request until expanded and shows unverified configuration honestly', async () => {
    const api = runtime()
    render(<LanghuaConfigEntry runtime={api} scope="seat-a" />)
    expect(api.get).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('AppKey')).toBeNull()
    await ready()
    expect(api.get).toHaveBeenCalledExactlyOnceWith('/api/langhua-config')
    expect(screen.getByText('配置已停用 · 资格未验证')).toBeTruthy()
    expect(screen.getByText(/固定服务地址/).textContent).toContain(STATUS.gateway_url)
    expect(api.post).not.toHaveBeenCalled()
  })

  it('clears password before one same-render double-click POST and never persists it', async () => {
    const pending = deferred()
    const api = runtime(vi.fn(async () => STATUS), vi.fn(() => pending.promise) as never)
    const storage = vi.spyOn(Storage.prototype, 'setItem')
    render(<LanghuaConfigEntry runtime={api} scope="seat-a" />)
    await ready()
    const input = inputKey()
    expect(input.type).toBe('password')
    expect(input.autocomplete).toBe('new-password')
    const button = screen.getByRole('button', {name: '加密保存 AppKey'})
    act(() => {button.click(); button.click()})
    expect(api.post).toHaveBeenCalledExactlyOnceWith('/api/langhua-config', {expected_version: 1, app_key: CANARY})
    expect(input.value).toBe('')
    expect(document.body.textContent).not.toContain(CANARY)
    expect(storage).not.toHaveBeenCalled()
    await act(async () => pending.resolve({...STATUS, version: 2}))
    expect(screen.getByText(/连接配置已加密保存/)).toBeTruthy()
    expect(input.value).toBe('')
    storage.mockRestore()
  })

  it('toggles using the current CAS version without retaining or sending the typed key', async () => {
    const api = runtime()
    render(<LanghuaConfigEntry runtime={api} scope="seat-a" />)
    await ready()
    const input = inputKey()
    fireEvent.click(screen.getByRole('button', {name: '启用连接配置'}))
    expect(input.value).toBe('')
    expect(api.post).toHaveBeenCalledExactlyOnceWith('/api/langhua-config', {expected_version: 1, enabled: true})
    await screen.findByText(/连接配置已加密保存/)
  })

  it.each([409, 0, 503])('never automatically repeats a failed POST (%s), refills a key, or renders an arbitrary error', async status => {
    const api = runtime(vi.fn(async () => STATUS), vi.fn(async () => {
      if (status) {throw enterpriseClientErrorForStatus(status)}
      throw new Error(CANARY)
    }))
    render(<LanghuaConfigEntry runtime={api} scope="seat-a" />)
    await ready()
    const input = inputKey()
    fireEvent.click(screen.getByRole('button', {name: '加密保存 AppKey'}))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(input.value).toBe('')
    expect(document.body.textContent).not.toContain(CANARY)
    expect(api.post).toHaveBeenCalledTimes(1)
    expect(api.get).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', {name: '刷新状态'}))
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2))
    expect(api.post).toHaveBeenCalledTimes(1)
  })

  it.each(['get-success', 'get-failure', 'post-success', 'post-failure'])('rejects old %s and finally after the same seat receives a new runtime', async kind => {
    const old = deferred()
    const next = deferred()
    const oldApi = runtime(kind.startsWith('get') ? vi.fn(() => old.promise) as never : vi.fn(async () => STATUS),
      vi.fn(() => old.promise) as never)
    const nextApi = runtime(vi.fn(() => next.promise) as never)
    const {rerender} = render(<LanghuaConfigEntry runtime={oldApi} scope="same-seat" />)
    toggle()
    if (kind.startsWith('post')) {
      await waitFor(() => expect((screen.getByLabelText('AppKey') as HTMLInputElement).disabled).toBe(false))
      inputKey()
      fireEvent.click(screen.getByRole('button', {name: '加密保存 AppKey'}))
    }
    rerender(<LanghuaConfigEntry runtime={nextApi} scope="same-seat" />)
    expect(screen.queryByLabelText('AppKey')).toBeNull()
    expect(nextApi.get).not.toHaveBeenCalled()
    toggle()
    await waitFor(() => expect(nextApi.get).toHaveBeenCalledTimes(1))
    await act(async () => kind.endsWith('success') ? old.resolve({...STATUS, enabled: true}) : old.reject(new Error(CANARY)))
    expect(screen.getByTestId('langhua-config-panel').getAttribute('aria-busy')).toBe('true')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText(/连接配置已加密保存/)).toBeNull()
    expect((screen.getByLabelText('AppKey') as HTMLInputElement).disabled).toBe(true)
    await act(async () => next.resolve(STATUS))
    expect(screen.getByText('配置已停用 · 资格未验证')).toBeTruthy()
    expect((screen.getByLabelText('AppKey') as HTMLInputElement).value).toBe('')
  })

  it.each(['close', 'scope', 'unmount'])('clears the unsubmitted password on %s', async change => {
    const api = runtime()
    const view = render(<LanghuaConfigEntry runtime={api} scope="a" />)
    await ready()
    const input = inputKey()
    if (change === 'close') {toggle(false)}
    if (change === 'scope') {view.rerender(<LanghuaConfigEntry runtime={api} scope="b" />)}
    if (change === 'unmount') {view.unmount()}
    expect(input.value).toBe('')
    expect(screen.queryByLabelText('AppKey')).toBeNull()
    expect(screen.queryByText(/连接配置已加密保存/)).toBeNull()
  })

  it.each(['resolve', 'reject'])('ignores a closed form POST %s, including its finally, after reopening', async ending => {
    const old = deferred()
    const nextRead = deferred()
    const api = runtime(vi.fn().mockResolvedValueOnce(STATUS).mockImplementationOnce(() => nextRead.promise) as never,
      vi.fn(() => old.promise) as never)
    render(<LanghuaConfigEntry runtime={api} scope="a" />)
    await ready()
    inputKey()
    fireEvent.click(screen.getByRole('button', {name: '加密保存 AppKey'}))
    toggle(false)
    expect(screen.queryByLabelText('AppKey')).toBeNull()
    toggle()
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2))
    await act(async () => ending === 'resolve' ? old.resolve({...STATUS, enabled: true}) : old.reject(new Error(CANARY)))
    expect(screen.getByTestId('langhua-config-panel').getAttribute('aria-busy')).toBe('true')
    expect(screen.queryByRole('alert')).toBeNull()
    await act(async () => nextRead.resolve(STATUS))
    expect(screen.getByText('配置已停用 · 资格未验证')).toBeTruthy()
  })

  it('does not use malformed or credential-bearing response fields as UI status', async () => {
    const api = runtime(vi.fn(async () => ({...STATUS, gateway_url: CANARY, app_key: CANARY})) as never)
    render(<LanghuaConfigEntry runtime={api} scope="a" />)
    toggle()
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(document.body.textContent).not.toContain(CANARY)
    expect(api.post).not.toHaveBeenCalled()
  })
})
