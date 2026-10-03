import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { EnterpriseClientApp } from './app'
import { WebPresentationContext } from './web-presentation'

type EnterpriseBridgeResponse =
  | { data: unknown; kind: 'ok' }
  | { code: string; kind: 'error'; message: string; status: number }

const HEALTH = { auth_mode: 'native_bearer', ok: true }

const IDENTITY = {
  desktop_surfaces: {
    schema_version: 1,
    surfaces: {
      conversations: { available: true },
      governance: { available: false },
      handoffs: { available: true },
      knowledge: { available: false },
      workflows: { available: true }
    }
  },
  effective_permissions: ['*'],
  name: 'Lin Qiao',
  principal_id: 'principal-operator-042',
  product_capabilities: { knowledge_rag: { enabled: true, status: 'LIVE' } },
  role: 'operator',
  tenant_id: 'tenant-acme-logistics'
}

const METRICS = { alerts: [] }

function installAuthorityBridge(responses: Record<string, EnterpriseBridgeResponse>) {
  const bridge = {
    autoConnect: vi.fn(async () => ({
      baseUrl: 'https://enterprise.example.com',
      ok: true as const,
      sessionId: 'opaque-session'
    })),
    loginWithPassword: vi.fn(async () => ({
      code: 'invalid_credentials',
      message: 'internal',
      ok: false as const
    })),
    disconnect: vi.fn(async () => ({ ok: true })),
    setTitleBarTheme: vi.fn(),
    request: vi.fn(async (request: { path: string }) => responses[request.path] ?? {
      code: 'http',
      kind: 'error' as const,
      message: 'fixture endpoint not defined',
      status: 404
    })
  }

  ;(window as unknown as { hermesDesktop?: unknown }).hermesDesktop = {
    enterprise: bridge,
    setTitleBarTheme: bridge.setTitleBarTheme
  }

  return bridge
}

afterEach(() => {
  cleanup()
  delete (window as unknown as { hermesDesktop?: unknown }).hermesDesktop
})

describe('EnterpriseClientApp authority lifecycle', () => {
  it.each([false, true])('retains overview modules but hides them only on web: %s', async web => {
    const time={now:'2026-10-03T09:00:00+08:00',timezone_label:'北京时间',reminder_rule:'测试规则',runner:{running:true}}
    installAuthorityBridge({
      '/api/health':{kind:'ok',data:HEALTH},
      '/api/metrics?window=24h':{kind:'ok',data:METRICS},
      '/api/whoami':{kind:'ok',data:{...IDENTITY,role:'tenant_admin'}},
      '/api/operations-overview':{kind:'ok',data:{groups:[],knowledge:{published:0,pending_review:0},scope:{operator_count:2,scoped_operator_count:1},staff:[{principal_id:'seat-active',name:'活跃测试坐席',login_name:'active.seat',group_name:'测试组',today_questions:3,today_answers:2,week_answers:5,total_answers:8,today_customer_replies:1}],summary:{},reminders:[],server_time:time}},
      '/api/operations-reminders':{kind:'ok',data:{reminders:[],server_time:time}}
    })
    render(<WebPresentationContext.Provider value={web}><EnterpriseClientApp /></WebPresentationContext.Provider>)
    await screen.findByText('服务端时间与提醒规则')
    const panel=screen.getByTestId('operations-overview')
    expect(panel.hasAttribute('hidden')).toBe(false)
    expect(screen.getByRole('heading',{name:web ? '坐席活跃情况' : '坐席活跃度'})).toBeTruthy()
    expect(screen.getByRole('row',{name:/活跃测试坐席/}).textContent).toContain('active.seat')
    expect(screen.queryByRole('region',{name:'任务预览'})).toBeNull()
    expect(screen.queryByRole('region',{name:'逾期事项预览'}) === null).toBe(web)
    for(const text of ['运营数据看板','服务端时间与提醒规则','下属定时任务提醒（只读）','员工组别']) {
      expect(panel.textContent).toContain(text)
      expect(screen.queryByRole('heading',{name:text}) === null).toBe(web)
    }
    expect(document.querySelector('.hesc-workbench-shortcuts')?.hasAttribute('hidden')).toBe(web)
    expect(screen.getByTestId('enterprise-client-workbench').hasAttribute('hidden')).toBe(false)
  })
  it('uses white glyphs for the native Windows window controls', async () => {
    const bridge = installAuthorityBridge({})
    bridge.autoConnect.mockResolvedValue({ ok: false, code: 'no_native_session', message: '' } as never)

    render(<EnterpriseClientApp />)

    await screen.findByText('等待登录企业账号')
    expect(bridge.setTitleBarTheme).toHaveBeenCalledWith({
      background: '#0c1825',
      foreground: '#ffffff'
    })
  })

  it('keeps rejected credentials on the login form without claiming the service is offline', async () => {
    const bridge = installAuthorityBridge({})
    bridge.autoConnect.mockResolvedValue({ ok: false, code: 'no_native_session', message: '' } as never)
    Object.assign(bridge, { loginWithPassword: vi.fn(async () => ({ ok: false, code: 'invalid_credentials', message: 'internal' })) })
    render(<EnterpriseClientApp />)
    await screen.findByText('等待登录企业账号')
    fireEvent.change(screen.getByLabelText('登录账号'), { target: { value: 'old.account' } })
    fireEvent.change(screen.getByLabelText('登录密码'), { target: { value: 'incorrect-password' } })
    fireEvent.click(screen.getByRole('button', { name: '登录企业工作台' }))
    await screen.findByText('账号或密码不正确，或账号已停用。请使用管理员提供的新账号。')
    expect(screen.queryByText('企业服务不可用')).toBeNull()
    expect(screen.queryByText(/无法连接企业服务/)).toBeNull()
    expect(screen.getByLabelText('登录密码')).toHaveProperty('value', '')
  })

  it('forwards the selected password-remembering preference to the main-process login bridge', async () => {
    const bridge = installAuthorityBridge({})
    bridge.autoConnect.mockResolvedValue({ ok: false, code: 'no_native_session', message: '' } as never)
    Object.assign(bridge, {
      loginWithPassword: vi.fn(async () => ({
        baseUrl: 'https://enterprise.example.com', mustChangePassword: true, ok: true, sessionId: 'password-session'
      })),
      rememberedLogin: vi.fn(async () => null)
    })
    render(<EnterpriseClientApp />)
    await screen.findByText('等待登录企业账号')
    fireEvent.change(screen.getByLabelText('登录账号'), { target: { value: 'member.account' } })
    fireEvent.change(screen.getByLabelText('登录密码'), { target: { value: 'a-valid-password' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /记住密码/ }))
    fireEvent.click(screen.getByRole('button', { name: '登录企业工作台' }))
    await waitFor(() => expect(bridge.loginWithPassword).toHaveBeenCalledWith({
      loginName: 'member.account', password: 'a-valid-password', rememberPassword: true
    }))
  })
  it('shows a normal login state when main has no session without claiming a network failure', async () => {
    const bridge = installAuthorityBridge({})
    bridge.autoConnect.mockResolvedValue({ ok: false, code: 'no_native_session', message: 'no authenticated native session' } as never)
    render(<EnterpriseClientApp />)
    expect(await screen.findByText('等待登录企业账号')).toBeTruthy()
    expect(screen.getByRole('button', { name: '登录企业工作台' })).toBeTruthy()
    expect(screen.queryByText('企业服务不可用')).toBeNull()
    expect(screen.queryByText(/无法连接企业服务/)).toBeNull()
    expect(bridge.request).not.toHaveBeenCalled()
  })

  it('renders only the server-provided tenant identity through the token-free bridge', async () => {
    const bridge = installAuthorityBridge({
      '/api/health': { data: HEALTH, kind: 'ok' },
      '/api/metrics?window=24h': { data: METRICS, kind: 'ok' },
      '/api/whoami': { data: IDENTITY, kind: 'ok' }
    })

    render(<EnterpriseClientApp />)

    await screen.findAllByText('企业服务已连接')
    expect(screen.getAllByText('Lin Qiao')).toHaveLength(2)
    expect(screen.getAllByText('tenant-acme-logistics')).toHaveLength(2)
    expect(screen.getAllByText('员工')).toHaveLength(3)
    expect(screen.getByRole('button', { name: '提醒中心' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '工具集' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '企业会话' })).toBeNull()
    expect(screen.queryByRole('button', { name: '人工接管' })).toBeNull()
    expect(screen.queryByRole('button', { name: '企业知识' })).toBeNull()
    expect(screen.queryByRole('button', { name: '员工与权限' })).toBeNull()
    expect(bridge.autoConnect).toHaveBeenCalledWith()
    expect(bridge.request).toHaveBeenCalledWith({
      method: 'GET',
      path: '/api/whoami',
      sessionId: 'opaque-session'
    })
    expect(JSON.stringify(bridge.request.mock.calls)).not.toMatch(/token|bearer/i)
  })

  it('mounts the enterprise task workspace only when the server marks that capability live', async () => {
    const bridge = installAuthorityBridge({
      '/api/biz-tasks': { data: { available: true, tasks: [] }, kind: 'ok' },
      '/api/health': { data: HEALTH, kind: 'ok' },
      '/api/metrics?window=24h': { data: METRICS, kind: 'ok' },
      '/api/whoami': {
        data: {
          ...IDENTITY,
          product_capabilities: {
            ...IDENTITY.product_capabilities,
            team_tasks: { enabled: true, status: 'LIVE' }
          }
        },
        kind: 'ok'
      }
    })

    render(<EnterpriseClientApp />)

    expect(await screen.findByText('企业任务执行')).toBeTruthy()
    expect(await screen.findByText('当前授权范围内没有企业任务。')).toBeTruthy()
    expect(bridge.request).toHaveBeenCalledWith({
      method: 'GET',
      path: '/api/biz-tasks',
      sessionId: 'opaque-session'
    })
  })

  it('fails closed for server-backed workspaces when the authority contract is absent', async () => {
    const bridge = installAuthorityBridge({
      '/api/health': { data: HEALTH, kind: 'ok' },
      '/api/metrics?window=24h': { data: METRICS, kind: 'ok' },
      '/api/whoami': {
        data: {
          name: IDENTITY.name,
          principal_id: IDENTITY.principal_id,
          product_capabilities: IDENTITY.product_capabilities,
          role: IDENTITY.role,
          tenant_id: IDENTITY.tenant_id
        },
        kind: 'ok'
      }
    })

    render(<EnterpriseClientApp />)

    await screen.findAllByText('企业服务已连接')
    expect(screen.getByRole('button', { name: '工作台' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '企业 AI 助手' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '企业会话' })).toBeNull()
    expect(screen.queryByRole('button', { name: '人工接管' })).toBeNull()
    expect(screen.queryByRole('button', { name: '企业知识' })).toBeNull()
    expect(screen.queryByRole('button', { name: '业务运营' })).toBeNull()
    expect(screen.queryByRole('button', { name: '员工与权限' })).toBeNull()
    expect(bridge.disconnect).not.toHaveBeenCalled()
  })

  it('releases the opaque session and clears authority presentation after a 401', async () => {
    const bridge = installAuthorityBridge({
      '/api/health': { code: 'http', kind: 'error', message: 'request failed (401)', status: 401 },
      '/api/metrics?window=24h': { data: METRICS, kind: 'ok' },
      '/api/whoami': { data: IDENTITY, kind: 'ok' }
    })

    render(<EnterpriseClientApp />)

    expect(await screen.findByText('企业会话已失效，请重新连接')).toBeTruthy()
    await waitFor(() => expect(bridge.disconnect).toHaveBeenCalledWith('opaque-session'))
    expect(screen.queryByText('Lin Qiao')).toBeNull()
    expect(screen.getByTestId('enterprise-login-root')).toBeTruthy()
    expect(screen.getByText('登录企业账号')).toBeTruthy()
  })

  it('does not release a session for a 403 authority denial', async () => {
    const bridge = installAuthorityBridge({
      '/api/health': { data: HEALTH, kind: 'ok' },
      '/api/metrics?window=24h': { data: METRICS, kind: 'ok' },
      '/api/whoami': { code: 'http', kind: 'error', message: 'request failed (403)', status: 403 }
    })

    render(<EnterpriseClientApp />)

    expect(await screen.findByText('当前身份无权访问此资源')).toBeTruthy()
    expect(bridge.disconnect).not.toHaveBeenCalled()
  })

  it('revalidates with main-owned credentials when the app returns to the foreground', async () => {
    const bridge = installAuthorityBridge({
      '/api/health': { data: HEALTH, kind: 'ok' },
      '/api/metrics?window=24h': { data: METRICS, kind: 'ok' },
      '/api/whoami': { data: IDENTITY, kind: 'ok' }
    })

    render(<EnterpriseClientApp />)
    await screen.findAllByText('企业服务已连接')
    const initialAutoConnects = bridge.autoConnect.mock.calls.length

    const initialIdentityReads = bridge.request.mock.calls.filter(([request]) => request.path === '/api/whoami').length
    fireEvent.focus(window)

    await waitFor(() => expect(bridge.request.mock.calls.filter(([request]) => request.path === '/api/whoami').length).toBeGreaterThan(initialIdentityReads))
    expect(bridge.autoConnect.mock.calls.length).toBe(initialAutoConnects)
    expect(bridge.disconnect).not.toHaveBeenCalled()
  })
  it('keeps the existing authority and session during a transient foreground refresh failure', async () => {
    const responses: Record<string, EnterpriseBridgeResponse> = {
      '/api/health': { data: HEALTH, kind: 'ok' },
      '/api/metrics?window=24h': { data: METRICS, kind: 'ok' },
      '/api/whoami': { data: IDENTITY, kind: 'ok' }
    }
    const bridge = installAuthorityBridge(responses)
    render(<EnterpriseClientApp />)
    await screen.findAllByText('企业服务已连接')
    responses['/api/whoami'] = { code: 'http', kind: 'error', message: 'temporary outage', status: 503 }
    fireEvent.focus(window)
    await screen.findByText(/网络暂时波动/)
    expect(screen.getAllByText('Lin Qiao').length).toBeGreaterThan(0)
    expect(screen.queryByTestId('enterprise-login-root')).toBeNull()
    expect(bridge.disconnect).not.toHaveBeenCalled()
    responses['/api/whoami'] = { data: IDENTITY, kind: 'ok' }
    fireEvent.focus(window)
    await waitFor(() => expect(screen.queryByText(/网络暂时波动/)).toBeNull())
    expect(bridge.autoConnect).toHaveBeenCalledTimes(1)
  })

})
