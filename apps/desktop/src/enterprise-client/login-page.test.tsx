import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { EnterpriseLoginPage } from './login-page'

describe('EnterpriseLoginPage', () => {
  it('uses the owned Chinese enterprise entry and delegates authentication to its controller', () => {
    const onLogin = vi.fn()

    render(
      <EnterpriseLoginPage
        busy={false}
        error={null}
        onLogin={onLogin}
        status="等待连接企业服务"
      />
    )

    expect(screen.getByRole('heading', { name: '登录企业账号' })).toBeTruthy()
    expect(screen.getByText(/本客户端不提供自助注册/)).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '使用企业账号登录' }))

    expect(onLogin).toHaveBeenCalledOnce()
  })

  it('makes the connecting state non-repeatable', () => {
    render(
      <EnterpriseLoginPage
        busy
        error={null}
        onLogin={vi.fn()}
        status="正在连接企业服务"
      />
    )

    expect(screen.getByRole('button', { name: '正在验证企业身份…' }).getAttribute('disabled')).not.toBeNull()
  })
})
