import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { EnterpriseClientRuntime } from './runtime'
import { WeComSeatBindingPanel } from './wecom-seat-binding-panel'

describe('WeComSeatBindingPanel', () => {
  it('lets a signed-in member create only their own one-time WeCom binding code', async () => {
    const post = vi.fn(async () => ({code: 'BINDCODE', expires_in: 600, instruction: '请向企业微信自建应用发送：BIND BINDCODE'}))
    const runtime = {post, disconnect: vi.fn()} as unknown as EnterpriseClientRuntime

    render(<WeComSeatBindingPanel runtime={runtime} />)
    fireEvent.click(screen.getByRole('button', {name: '绑定我的企业微信'}))

    expect(await screen.findByText(/BIND BINDCODE/)).toBeTruthy()
    expect(post).toHaveBeenCalledWith('/api/wecom-seat-binding', {})
  })
})
