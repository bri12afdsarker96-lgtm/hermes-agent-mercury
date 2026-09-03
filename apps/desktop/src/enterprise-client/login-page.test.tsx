import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { EnterpriseLoginPage } from './login-page'

describe('EnterpriseLoginPage', () => {
  it('uses the owned Chinese enterprise entry and delegates authentication to its controller', () => {
    const onRetry = vi.fn()

    render(
      <EnterpriseLoginPage
        busy={false}
        error={null}
        onRetry={onRetry}
        status="等待连接企业服务"
      />
    )

    expect(screen.getByRole('heading', { name: '登录企业账号' })).toBeTruthy()
    expect(screen.getByText('本客户端不提供自助注册。请联系企业管理员开通或恢复账号。')).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '登录并进入工作台' }))

    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('makes the connecting state non-repeatable', () => {
    render(
      <EnterpriseLoginPage
        busy
        error={null}
        onRetry={vi.fn()}
        status="正在连接企业服务"
      />
    )

    expect(screen.getByRole('button', { name: '正在验证企业身份…' })).toBeDisabled()
  })
})
