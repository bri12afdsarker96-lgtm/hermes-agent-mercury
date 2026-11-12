import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { EnterpriseClientRuntime } from './runtime'
import { WeComSeatBindingPanel } from './wecom-seat-binding-panel'

describe('WeComSeatBindingPanel', () => {
  it('lets a signed-in member create only their own one-time WeCom binding code', async () => {
    const post = vi.fn(async () => ({code: 'BINDCODE', expires_in: 600, instruction: '请向企业微信自建应用发送：BIND BINDCODE'}))
    const runtime = {post, get: vi.fn(async () => ({bound: false, pending: true})), disconnect: vi.fn()} as unknown as EnterpriseClientRuntime

    render(<WeComSeatBindingPanel runtime={runtime} />)
    fireEvent.click(screen.getByRole('button', {name: '绑定我的企业微信'}))

    expect(await screen.findByText(/BIND BINDCODE/)).toBeTruthy()
    expect(post).toHaveBeenCalledWith('/api/wecom-seat-binding', {})
  })

  it('shows the verified account from the server on first load and after refresh', async () => {
    const get = vi.fn(async () => ({bound: true, pending: false, account_id: 'verified-user', app_config_ref: 'app-a'}))
    const runtime = {get, post: vi.fn(), disconnect: vi.fn()} as unknown as EnterpriseClientRuntime
    render(<WeComSeatBindingPanel runtime={runtime} />)
    expect(await screen.findByText('企业微信绑定成功')).toBeTruthy()
    expect(screen.getByText(/UserID.*verified-user/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', {name: '刷新绑定状态'}))
    expect(get).toHaveBeenCalledWith('/api/wecom-seat-binding')
    expect(runtime.post).not.toHaveBeenCalled()
  })

  it('does not treat issuing a code as a successful binding', async () => {
    const get = vi.fn(async () => ({bound: false, pending: true}))
    const post = vi.fn(async () => ({code: 'ABC', expires_in: 600, instruction: 'BIND ABC'}))
    const runtime = {get, post, disconnect: vi.fn()} as unknown as EnterpriseClientRuntime
    render(<WeComSeatBindingPanel runtime={runtime} />)
    fireEvent.click(screen.getByRole('button', {name: '绑定我的企业微信'}))
    await screen.findByText(/BIND ABC/)
    expect(screen.queryByText('企业微信绑定成功')).toBeNull()
    get.mockResolvedValue({bound: true, pending: false, account_id: 'new-user', app_config_ref: 'app-a'} as never)
    fireEvent.click(screen.getByRole('button', {name: '刷新绑定状态'}))
    expect(await screen.findByText(/UserID.*new-user/)).toBeTruthy()
    expect(screen.queryByText(/BIND ABC/)).toBeNull()
  })
})
