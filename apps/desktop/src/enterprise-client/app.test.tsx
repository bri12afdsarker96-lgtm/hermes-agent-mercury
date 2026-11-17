import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider, useTheme } from '@/themes/context'

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
  vi.unstubAllGlobals()
  delete (window as unknown as { hermesDesktop?: unknown }).hermesDesktop
})

describe('EnterpriseClientApp authority lifecycle', () => {
  it('opens the personal removal dialog from the normal App using a synthetic authorized shop fixture', async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    const syntheticProfile = {id:'11111111-1111-1111-1111-111111111110', tenantId:'synthetic-tenant', principalId:'synthetic-employee', displayName:'合成店铺A', shopName:'合成店铺A', shopId:'synthetic-shop-A', createdAt:'2026-11-15T00:00:00Z', checkedAt:null, loginState:'verified'}

    const bridge = installAuthorityBridge({
      '/api/health': {kind:'ok', data:HEALTH},
      '/api/whoami': {kind:'ok', data:{...IDENTITY, name:'合成员工', tenant_id:'synthetic-tenant', principal_id:'synthetic-employee', role:'operator', product_capabilities:{doudian_review:{enabled:true, status:'LIVE'}}}}
    })

    const shopBrowser = vi.fn(async (request: {action: string; sessionId?: string}) => request.action === 'list'
      ? {ok:true, profiles:[syntheticProfile], openProfileId:null}
      : {ok:true, openProfileId:null})

    Object.assign(bridge, {shopBrowser})
    render(<EnterpriseClientApp />)
    fireEvent.click(await screen.findByRole('button', {name:'店铺与客服'}))
    const row = (await screen.findByText('合成店铺A')).closest('tr')!
    const trigger = within(row).getByRole('button', {name:'从我的列表移除'})
    trigger.focus()
    fireEvent.click(trigger)
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('synthetic-shop-A')
    expect(dialog.textContent).toContain('企业店铺资产')
    expect(dialog.contains(globalThis.document.activeElement)).toBe(true)
    fireEvent.keyDown(globalThis.window, {key:'Escape'})
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(shopBrowser.mock.calls.some(([request]) => request.action === 'delete')).toBe(false)
    expect(shopBrowser.mock.calls.some(([request]) => request.action === 'list' && request.sessionId === 'opaque-session')).toBe(true)
  })
  it('clears prior staff secrets, confirmation and draft after foreground identity changes', async () => {
    let identity = {name: '旧管理员', tenant_id: 'tenant-a', principal_id: 'admin-a', role: 'tenant_admin', effective_permissions: ['principal.crud'], desktop_surfaces: {surfaces: {governance: {available: true}}}, product_capabilities: {}}
    const bridge = installAuthorityBridge({})
    bridge.request.mockImplementation(async (request: {path: string; method?: string}) => {
      if (request.path === '/api/health') {return {kind: 'ok', data: HEALTH}}

      if (request.path === '/api/whoami') {return {kind: 'ok', data: {...identity}}}

      if (request.path === '/api/principals' && request.method === 'GET') {return {kind: 'ok', data: {principals: [{principal_id:'seat', name:'员工甲', login_name:'seat-a', role:'operator', status:'active'}]}}}

      if (request.path === '/api/principals' && request.method === 'POST') {return {kind: 'ok', data: {login_name:'created-a', temporary_password:'synthetic-secret-a'}}}

      return {kind: 'error', code: 'not_found', message: 'unavailable', status: 404}
    })
    render(<EnterpriseClientApp />)
    fireEvent.click(await screen.findByRole('button', {name:'员工与权限'}))
    await screen.findByText('seat-a')
    fireEvent.change(screen.getByLabelText('员工姓名'), {target:{value:'员工甲'}})
    fireEvent.change(screen.getByLabelText('员工登录账号'), {target:{value:'created-a'}})
    fireEvent.click(screen.getByRole('button', {name:'开通员工账号'}))
    await screen.findByText(/synthetic-secret-a/)
    fireEvent.change(screen.getByLabelText('员工姓名'), {target:{value:'旧企业草稿'}})
    fireEvent.click(screen.getByRole('button', {name:'删除账号'}))
    expect(screen.getByRole('dialog')).toBeTruthy()
    identity = {...identity, name:'新管理员', tenant_id:'tenant-b', principal_id:'admin-b'}
    fireEvent.focus(window)
    await waitFor(() => expect(globalThis.document.body.textContent).toContain('新管理员'))
    expect(screen.queryByText(/synthetic-secret-a/)).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    await screen.findByText('seat-a')
    expect((screen.getByLabelText('员工姓名') as HTMLInputElement).value).toBe('')
  })
  it('preserves staff draft when refreshed authority is semantically unchanged', async () => {
    const identity = {name:'管理员', tenant_id:'tenant-a', principal_id:'admin-a', role:'tenant_admin', effective_permissions:['principal.crud','tenant.read'], desktop_surfaces:{surfaces:{governance:{available:true}}}, product_capabilities:{}}
    const bridge = installAuthorityBridge({})
    let reads = 0
    bridge.request.mockImplementation(async (request: {path:string; method?:string}) => {
      if (request.path === '/api/health') {return {kind:'ok', data:HEALTH}}

      if (request.path === '/api/whoami') {return {kind:'ok', data:{...identity, effective_permissions: ++reads % 2 ? [...identity.effective_permissions] : [...identity.effective_permissions].reverse()}}}

      if (request.path === '/api/principals') {return {kind:'ok', data:{principals:[]}}}

      return {kind:'error', code:'not_found', message:'unavailable', status:404}
    })
    render(<EnterpriseClientApp />)
    fireEvent.click(await screen.findByRole('button', {name:'员工与权限'}))
    fireEvent.change(await screen.findByLabelText('员工姓名'), {target:{value:'保留草稿'}})
    const before = bridge.request.mock.calls.filter(([request]) => request.path === '/api/whoami').length
    fireEvent.focus(window)
    await waitFor(() => expect(bridge.request.mock.calls.filter(([request]) => request.path === '/api/whoami').length).toBeGreaterThan(before))
    await act(async () => {await new Promise(resolve=>setTimeout(resolve, 30))})
    expect((screen.getByLabelText('员工姓名') as HTMLInputElement).value).toBe('保留草稿')
  })
  it('clears staff draft when effective permissions change for the same actor', async () => {
    let permissions = ['principal.crud', 'tenant.read']
    const bridge = installAuthorityBridge({})
    bridge.request.mockImplementation(async (request: {path:string}) => {
      if (request.path === '/api/health') {return {kind:'ok', data:HEALTH}}

      if (request.path === '/api/whoami') {return {kind:'ok', data:{name:'权限管理员', tenant_id:'tenant-a', principal_id:'admin-a', role:'tenant_admin', effective_permissions:permissions, desktop_surfaces:{surfaces:{governance:{available:true}}}, product_capabilities:{}}}}

      if (request.path === '/api/principals') {return {kind:'ok', data:{principals:[]}}}

      return {kind:'error', code:'not_found', message:'unavailable', status:404}
    })
    render(<EnterpriseClientApp />)
    fireEvent.click(await screen.findByRole('button', {name:'员工与权限'}))
    fireEvent.change(await screen.findByLabelText('员工姓名'), {target:{value:'权限变化前草稿'}})
    const before = bridge.request.mock.calls.filter(([request]) => request.path === '/api/whoami').length
    permissions = ['principal.crud']
    fireEvent.focus(window)
    await waitFor(() => expect(bridge.request.mock.calls.filter(([request]) => request.path === '/api/whoami').length).toBeGreaterThan(before))
    await waitFor(() => expect((screen.getByLabelText('员工姓名') as HTMLInputElement).value).toBe(''))
  })
  it('does not show a late provisioning result after the foreground actor changes', async () => {
    let finish!: (result: EnterpriseBridgeResponse) => void
    const pending = new Promise<EnterpriseBridgeResponse>(resolve => {finish = resolve})
    let identity = {name:'旧管理员', tenant_id:'tenant-a', principal_id:'admin-a', role:'tenant_admin', effective_permissions:['principal.crud'], desktop_surfaces:{surfaces:{governance:{available:true}}}, product_capabilities:{}}
    const bridge = installAuthorityBridge({})
    bridge.request.mockImplementation(async (request: {path:string; method?:string}) => {
      if (request.path === '/api/health') {return {kind:'ok', data:HEALTH}}

      if (request.path === '/api/whoami') {return {kind:'ok', data:{...identity}}}

      if (request.path === '/api/principals' && request.method === 'POST') {return await pending}

      if (request.path === '/api/principals') {return {kind:'ok', data:{principals:[]}}}

      return {kind:'error', code:'not_found', message:'unavailable', status:404}
    })
    render(<EnterpriseClientApp />)
    fireEvent.click(await screen.findByRole('button', {name:'员工与权限'}))
    fireEvent.change(await screen.findByLabelText('员工姓名'), {target:{value:'员工甲'}})
    fireEvent.change(screen.getByLabelText('员工登录账号'), {target:{value:'seat-a'}})
    fireEvent.click(screen.getByRole('button', {name:'开通员工账号'}))
    await waitFor(() => expect(bridge.request.mock.calls.filter(([request]) => request.path === '/api/principals' && (request as {method?: string}).method === 'POST')).toHaveLength(1))
    identity = {...identity, name:'新管理员', tenant_id:'tenant-b', principal_id:'admin-b'}
    fireEvent.focus(window)
    await waitFor(() => expect(globalThis.document.body.textContent).toContain('新管理员'))
    await act(async () => {finish({kind:'ok', data:{login_name:'seat-a', temporary_password:'late-secret-a'}}); await pending; await new Promise(resolve => setTimeout(resolve, 30))})
    expect(screen.queryByText(/late-secret-a/)).toBeNull()
    expect((await screen.findByLabelText('员工姓名') as HTMLInputElement).value).toBe('')
  })
  it('clears the staff draft when the same actor changes role and returns', async () => {
    let role = 'tenant_admin'
    const bridge = installAuthorityBridge({})
    bridge.request.mockImplementation(async (request: {path:string}) => {
      if (request.path === '/api/health') {return {kind:'ok', data:HEALTH}}

      if (request.path === '/api/whoami') {return {kind:'ok', data:{name:'角色管理员', tenant_id:'tenant-a', principal_id:'admin-a', role, effective_permissions:['principal.crud'], desktop_surfaces:{surfaces:{governance:{available:true}}}, product_capabilities:{}}}}

      if (request.path === '/api/principals') {return {kind:'ok', data:{principals:[]}}}

      if (request.path === '/api/audit-list') {return {kind:'ok', data:{events:[]}}}

      return {kind:'error', code:'not_found', message:'unavailable', status:404}
    })
    render(<EnterpriseClientApp />)
    fireEvent.click(await screen.findByRole('button', {name:'员工与权限'}))
    fireEvent.change(await screen.findByLabelText('员工姓名'), {target:{value:'角色变化前草稿'}})
    role = 'operator'
    fireEvent.focus(window)
    await waitFor(() => expect(screen.queryByLabelText('员工姓名')).toBeNull())
    role = 'tenant_admin'
    fireEvent.focus(window)
    fireEvent.click(await screen.findByRole('button', {name:'员工与权限'}))
    expect((await screen.findByLabelText('员工姓名') as HTMLInputElement).value).toBe('')
  })
  it('opens staff governance without shop capability and sends reset and status once through the actual runtime', async () => {
    let status = 'active'
    const bridge = installAuthorityBridge({})
    bridge.request.mockImplementation(async (request: { path: string; method?: string; body?: unknown }) => {
      if (request.path === '/api/health') {return {kind: 'ok', data: HEALTH}}

      if (request.path === '/api/whoami') {return {kind: 'ok', data: {name: '管理员', tenant_id: 't1', principal_id: 'admin', role: 'tenant_admin', effective_permissions: ['principal.crud'], desktop_surfaces: {surfaces: {governance: {available: true}}}, product_capabilities: {}}}}

      if (request.path === '/api/principals' && request.method === 'GET') {return {kind: 'ok', data: {principals: [{principal_id: 'seat', name: '坐席甲', login_name: 'seat-a', role: 'operator', status}]}}}

      if (request.path === '/api/principals-password-reset') {return {kind: 'ok', data: {principal: {principal_id: 'seat', must_change_password: true}}}}

      if (request.path === '/api/principals-status') { status = (request.body as {status: string}).status;

 return {kind: 'ok', data: {principal: {principal_id: 'seat', status}}} }

      return {kind: 'error', code: 'not_found', message: 'unavailable', status: 404}
    })
    render(<EnterpriseClientApp />)
    fireEvent.click(await screen.findByRole('button', {name: '员工与权限'}))
    let row = (await screen.findByText('seat-a')).closest('tr')!
    fireEvent.click(within(row).getByRole('button', {name: /重置密码|Reset password/}))
    let dialog = within(screen.getByRole('dialog'))
    fireEvent.change(dialog.getByLabelText(/密码|Password/), {target: {value: ' 123456 '}})
    fireEvent.click(dialog.getByRole('button', {name: /确定|Confirm/}))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    row = (await screen.findByText('seat-a')).closest('tr')!
    fireEvent.click(within(row).getByRole('button', {name: /停用|Disable/}))
    dialog = within(screen.getByRole('dialog'))
    fireEvent.click(dialog.getByRole('button', {name: /确定|Confirm/}))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    row = (await screen.findByText('seat-a')).closest('tr')!
    fireEvent.click(await within(row).findByRole('button', {name: /启用|Enable/}))
    dialog = within(screen.getByRole('dialog'))
    fireEvent.click(dialog.getByRole('button', {name: /确定|Confirm/}))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const requests = bridge.request.mock.calls.map(([request]) => request as {path: string; method?: string; body?: unknown})
    expect(requests.filter(item => item.path === '/api/principals-password-reset')).toMatchObject([{method:'POST',body:{principal_id:'seat',new_password:' 123456 '}}])
    expect(requests.filter(item => item.path === '/api/principals-status')).toMatchObject([{method:'POST',body:{principal_id:'seat',status:'disabled'}}, {method:'POST',body:{principal_id:'seat',status:'active'}}])
    expect(requests.filter(item => item.path === '/api/shop-login-profiles')).toHaveLength(0)
  })
  it.each(['reset', 'status'] as const)('keeps a pending %s action gated across real workspace navigation', async action => {
    let finish!: (value: EnterpriseBridgeResponse) => void
    const pending = new Promise<EnterpriseBridgeResponse>(resolve => { finish = resolve })
    const endpoint = action === 'reset' ? '/api/principals-password-reset' : '/api/principals-status'
    const bridge = installAuthorityBridge({})
    bridge.request.mockImplementation(async (request: { path: string; method?: string; body?: unknown }) => {
      if (request.path === '/api/health') {return {kind: 'ok', data: HEALTH}}

      if (request.path === '/api/whoami') {return {kind: 'ok', data: {name: '管理员', tenant_id: 't1', principal_id: 'admin', role: 'tenant_admin', effective_permissions: ['principal.crud'], desktop_surfaces: {surfaces: {governance: {available: true}}}, product_capabilities: {}}}}

      if (request.path === '/api/principals' && request.method === 'GET') {return {kind: 'ok', data: {principals: [{principal_id: 'seat', name: '坐席甲', login_name: 'seat-a', role: 'operator', status: 'active'}]}}}

      if (request.path === endpoint) {return await pending}

      return {kind: 'error', code: 'not_found', message: 'unavailable', status: 404}
    })
    render(<EnterpriseClientApp />)

    const openAction = async () => {
      fireEvent.click(await screen.findByRole('button', {name: '员工与权限'}))
      const row = (await screen.findByText('seat-a')).closest('tr')!
      fireEvent.click(within(row).getByRole('button', {name: action === 'reset' ? /重置密码|Reset password/ : /停用|Disable/}))
      const dialog = within(screen.getByRole('dialog'))

      if (action === 'reset') {fireEvent.change(dialog.getByLabelText(/密码|Password/), {target: {value: '123456'}})}
      fireEvent.click(dialog.getByRole('button', {name: /确定|Confirm/}))
    }

    await openAction()
    await waitFor(() => expect(bridge.request.mock.calls.filter(([request]) => request.path === endpoint)).toHaveLength(1))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', {name: /取消|Cancel/}))
    fireEvent.click(screen.getByRole('button', {name: '运营总览'}))
    await openAction()
    expect((within(screen.getByRole('dialog')).getByRole('button', {name: /确定|Confirm/}) as HTMLButtonElement).disabled).toBe(true)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
    expect(bridge.request.mock.calls.filter(([request]) => request.path === endpoint)).toHaveLength(1)
    await act(async () => {
      finish({kind: 'ok', data: {principal: {principal_id: 'seat', status: 'disabled', must_change_password: true}}})
      await pending
      await new Promise(resolve => setTimeout(resolve, 50))
    })
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect((within(screen.getByRole('dialog')).getByRole('button', {name: /确定|Confirm/}) as HTMLButtonElement).disabled).toBe(false)
    expect(bridge.request.mock.calls.filter(([request]) => request.path === endpoint)).toHaveLength(1)
  })
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
  it('follows the selected light palette for native Windows window controls', async () => {
    const bridge = installAuthorityBridge({})
    bridge.autoConnect.mockResolvedValue({ ok: false, code: 'no_native_session', message: '' } as never)

    const toggleNativeTheme = vi.fn()
    Object.assign(window.hermesDesktop!, { setNativeTheme: toggleNativeTheme })
    function ChangeSkinMode() {
      const theme = useTheme()
      return <button onClick={() => theme.setMode('light')}>浅色聊天主题</button>
    }
    render(<ThemeProvider><EnterpriseClientApp /><ChangeSkinMode /></ThemeProvider>)

    await screen.findByText('等待登录企业账号')
    fireEvent.click(screen.getByRole('button', { name: '浅色聊天主题' }))
    expect(bridge.setTitleBarTheme).toHaveBeenLastCalledWith({
      background: expect.any(String),
      foreground: '#242424'
    })
    expect(toggleNativeTheme).toHaveBeenLastCalledWith('light')
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
