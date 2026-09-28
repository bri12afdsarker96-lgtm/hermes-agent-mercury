import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { EnterpriseLoginPage, EnterprisePasswordChangePage } from './login-page'

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

    expect(onLogin).toHaveBeenCalledWith('测试账号', 'Password-2026!', false)
  })

  it('does not offer desktop credential persistence when rendered as the web product', () => {
    document.documentElement.dataset.hermesSurface = 'web'

    try {
      render(
        <EnterpriseLoginPage
          busy={false}
          error={null}
          onLogin={vi.fn()}
          onOpenLogs={vi.fn()}
          status="等待登录企业服务"
        />
      )

      expect(screen.queryByRole('checkbox', { name: /记住密码/ })).toBeNull()
      expect(screen.getByText('网页不会保存密码或会话令牌。请使用浏览器自身的密码管理器（如需）。')).toBeTruthy()
    } finally {
      delete document.documentElement.dataset.hermesSurface
    }
  })

  it('restores a system-encrypted remembered password and keeps its checkbox beside the password field', async () => {
    const onLogin = vi.fn()
    const rememberedLogin = vi.fn(async () => ({ loginName: 'acceptance.user', password: 'stored-password' }))
    const descriptor = Object.getOwnPropertyDescriptor(window, 'hermesDesktop')
    Object.defineProperty(window, 'hermesDesktop', {
      configurable: true,
      value: { enterprise: { rememberedLogin } }
    })

    try {
      render(
        <EnterpriseLoginPage
          busy={false}
          error={null}
          onLogin={onLogin}
          onOpenLogs={vi.fn()}
          status="等待登录企业服务"
        />
      )

      await waitFor(() => expect((screen.getByLabelText('登录账号') as HTMLInputElement).value).toBe('acceptance.user'))
      const checkbox = screen.getByRole('checkbox', { name: '记住密码' })
      expect((checkbox as HTMLInputElement).checked).toBe(true)
      expect(checkbox.closest('label')?.className).toContain('hesc-login-remember')
      fireEvent.click(screen.getByRole('button', { name: '登录企业工作台' }))

      expect(onLogin).toHaveBeenCalledWith('acceptance.user', 'stored-password', true)
    } finally {
      if (descriptor) {
        Object.defineProperty(window, 'hermesDesktop', descriptor)
      } else {
        Reflect.deleteProperty(window, 'hermesDesktop')
      }
    }
  })

  it('guides a native pre-release tester through only the fixed VPN actions', async () => {
    const command = vi.fn(async () => ({
      enabled: true,
      message: '请导入企业管理员为你签发的个人 .ovpn 配置。',
      stage: 'profile_missing'
    }))
    const descriptor = Object.getOwnPropertyDescriptor(window, 'hermesDesktop')
    Object.defineProperty(window, 'hermesDesktop', {
      configurable: true,
      value: {
        enterprise: {
          preReleaseAccess: {
            command,
            status: vi.fn(async () => ({
              canInstall: true,
              enabled: true,
              message: '需要先安装 OpenVPN Connect，才能导入个人预发布配置。',
              stage: 'client_missing'
            }))
          }
        }
      }
    })

    try {
      render(
        <EnterpriseLoginPage
          busy={false}
          error={null}
          onLogin={vi.fn()}
          onOpenLogs={vi.fn()}
          status="等待登录企业服务"
        />
      )

      await screen.findByRole('button', { name: '安装 OpenVPN Connect' })
      fireEvent.click(screen.getByRole('button', { name: '安装 OpenVPN Connect' }))

      await waitFor(() => expect(command).toHaveBeenCalledWith({ action: 'install' }))
      expect(await screen.findByRole('button', { name: '导入个人 .ovpn 配置' })).toBeTruthy()
    } finally {
      if (descriptor) {
        Object.defineProperty(window, 'hermesDesktop', descriptor)
      } else {
        Reflect.deleteProperty(window, 'hermesDesktop')
      }
    }
  })

  it('makes the connecting state non-repeatable', () => {
    render(<EnterpriseLoginPage busy error={null} onLogin={vi.fn()} onOpenLogs={vi.fn()} status="正在连接企业服务" />)

    expect(screen.getByRole('button', { name: '正在验证账号…' }).getAttribute('disabled')).not.toBeNull()
  })

  it('allows a six-character replacement password during first-login rotation', () => {
    const onComplete = vi.fn()

    render(<EnterprisePasswordChangePage error={null} onComplete={onComplete} />)

    fireEvent.change(screen.getByLabelText('当前初始密码'), { target: { value: 'initial' } })
    fireEvent.change(screen.getByLabelText('新登录密码'), { target: { value: 'new123' } })
    fireEvent.change(screen.getByLabelText('确认新登录密码'), { target: { value: 'new123' } })
    fireEvent.click(screen.getByRole('button', { name: '确认并进入工作台' }))

    expect(onComplete).toHaveBeenCalledWith('initial', 'new123')
  })
})
