import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { EnterpriseLoginPage } from './login-page'

describe('EnterpriseLoginPage', () => {
  it('uses the owned Chinese enterprise entry and delegates authentication to its controller', () => {
    const onLogin = vi.fn()
    const onOpenLogs = vi.fn()

    render(
      <EnterpriseLoginPage
        busy={false}
        error={null}
        onLogin={onLogin}
        onOpenLogs={onOpenLogs}
        status="等待连接企业服务"
      />
    )

    expect(screen.getByRole('heading', { name: '登录企业账号' })).toBeTruthy()
    expect(screen.getByText(/本客户端不提供自助注册/)).toBeTruthy()
    expect(screen.getByLabelText('登录账号')).toBeTruthy()
    expect(screen.getByLabelText('登录密码')).toBeTruthy()
    expect(screen.queryByText('使用已配置的企业单点登录')).toBeNull()

    fireEvent.change(screen.getByLabelText('登录账号'), { target: { value: '测试账号' } })
    fireEvent.change(screen.getByLabelText('登录密码'), { target: { value: 'Password-2026!' } })
    fireEvent.click(screen.getByRole('button', { name: '登录企业工作台' }))

    expect(onLogin).toHaveBeenCalledWith('测试账号', 'Password-2026!')
  })

  it('makes the connecting state non-repeatable', () => {
    render(
      <EnterpriseLoginPage
        busy
        error={null}
        onLogin={vi.fn()}
        onOpenLogs={vi.fn()}
        status="正在连接企业服务"
      />
    )

    expect(screen.getByRole('button', { name: '正在验证账号…' }).getAttribute('disabled')).not.toBeNull()
  })
})
