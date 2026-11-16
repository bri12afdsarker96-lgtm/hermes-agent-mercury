import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import type { ShopBrowserProfile } from '../../electron/shop-browser-types'

import { NativeAgentsPanel } from './native-agents'
import { nativeBusinessAdminApi, type ShopMailbox, type ShopSubAccount } from './native-business-admin-api'
import type { EnterpriseClientRuntime } from './runtime'
import { ShopMailboxButton } from './shop-mailbox'
import { ShopSharedAssignment } from './shop-shared-assignment'
import { ShopSubAccountsButton } from './shop-subaccounts'

vi.mock('@/i18n/context', () => ({ useI18n: () => ({ locale: 'zh', t: { common: { close: '关闭' } } }) }))
afterEach(cleanup)

const profile: ShopBrowserProfile = {
  id: 'p1',
  tenantId: 't1',
  principalId: 'a',
  displayName: '店铺甲',
  shopId: '1001',
  shopName: '店铺甲',
  createdAt: '',
  checkedAt: null,
  loginState: 'verified'
}

function fixture(role = 'tenant_admin') {
  const store = {
    identity: { tenant_id: 't1', principal_id: role === 'tenant_admin' ? 'admin' : 'a', role, name: '员工甲' },
    mailbox: { providerKey: 'qq', user: 'test@qq.com', hasPassword: true, revision: 3 } as ShopMailbox,
    accounts: [
      {
        id: '1',
        profileId: 'p1',
        subAccount: 'one@example.com',
        enabled: true,
        hasPassword: true,
        revision: 1,
        createdAt: '',
        updatedAt: '2026-11-16 12:00:00'
      }
    ] as ShopSubAccount[],
    profiles: [
      {
        profile_id: 'p1',
        revision: 7,
        deleted: false,
        servicing_principal_ids: ['a', 'b'],
        profile: { shop_name: '店铺甲' }
      },
      {
        profile_id: 'p2',
        revision: 4,
        deleted: false,
        servicing_principal_ids: ['b'],
        profile: { shop_name: '店铺乙' }
      }
    ],
    members: [
      { principal_id: 'a', name: '员工甲', login_name: 'agent-a', role: 'operator', status: 'active' },
      { principal_id: 'b', name: '员工乙', login_name: 'agent-b', role: 'operator', status: 'active' },
      { principal_id: 'off', name: '停用员工', role: 'operator', status: 'inactive' },
      { principal_id: 'foreign', name: '外企业员工', role: 'operator', status: 'active', tenant_id: 't2' }
    ]
  }

  const get = vi.fn(async (path: string): Promise<unknown> => {
    if (path === '/api/whoami') {
      return { ...store.identity }
    }

    if (path === '/api/shop-mailbox') {
      return { mailbox: { ...store.mailbox } }
    }

    if (path === '/api/shop-subaccounts?profileId=p1') {
      return { subAccounts: store.accounts.map(row => ({ ...row })) }
    }

    if (path === '/api/shop-login-profiles') {
      return { profiles: structuredClone(store.profiles) }
    }

    if (path === '/api/principals') {
      return { principals: store.members }
    }

    throw new Error('Unexpected read')
  })

  const post = vi.fn(async (path: string, body: unknown): Promise<unknown> => {
    const value = body as Record<string, unknown>

    if (path === '/api/shop-mailbox') {
      store.mailbox = {
        providerKey: value.providerKey as 'qq' | '126',
        user: String(value.user),
        hasPassword: true,
        revision: store.mailbox.revision + 1
      }

      return { mailbox: { ...store.mailbox } }
    }

    if (path === '/api/shop-mailbox-test') {
      return { ok: true }
    }

    if (path === '/api/shop-subaccounts') {
      const old = store.accounts.find(row => row.id === value.id)

      const row = {
        id: old?.id ?? '2',
        profileId: 'p1',
        subAccount: String(value.subAccount),
        enabled: Boolean(value.enabled),
        hasPassword: true,
        revision: (old?.revision ?? 0) + 1,
        createdAt: '',
        updatedAt: '2026-11-16 12:01:00'
      }

      store.accounts = [...store.accounts.filter(item => item.id !== row.id), row]

      return { subAccount: { ...row } }
    }

    if (path === '/api/shop-subaccounts-delete') {
      store.accounts = store.accounts.filter(row => row.id !== value.id)

      return { deleted: true }
    }

    if (path === '/api/shop-login-profiles-assign') {
      const row = store.profiles.find(item => item.profile_id === value.profile_id)!

      if (row.revision !== value.expected_revision) {
        throw Object.assign(new Error(), { status: 409 })
      }

      row.servicing_principal_ids = [...(value.principal_ids as string[])]
      row.revision++

      return { profile: structuredClone(row) }
    }

    throw new Error('Unexpected mutation')
  })

  const runtime = { get, post, disconnect: vi.fn() } as unknown as EnterpriseClientRuntime

  return { store, get, post, runtime }
}

it('preserves mailbox password whitespace, saves with revision and reloads on reopening', async () => {
  const f = fixture()
  render(<ShopMailboxButton runtime={f.runtime} />)
  fireEvent.click(screen.getByRole('button', { name: '收件邮箱' }))
  await screen.findByDisplayValue('test@qq.com')
  fireEvent.change(screen.getByLabelText('授权码 / 密码'), { target: { value: ' secret with spaces ' } })
  fireEvent.click(screen.getByRole('button', { name: '显示' }))
  expect(screen.getByLabelText('授权码 / 密码').getAttribute('type')).toBe('text')
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(f.post).toHaveBeenCalledExactlyOnceWith('/api/shop-mailbox', {
    providerKey: 'qq',
    user: 'test@qq.com',
    password: ' secret with spaces ',
    expectedRevision: 3
  })
  fireEvent.click(screen.getByRole('button', { name: '收件邮箱' }))
  await screen.findByDisplayValue('test@qq.com')
  expect((screen.getByLabelText('授权码 / 密码') as HTMLInputElement).value).toBe('')
})

it('requires a new mailbox credential after account/provider change and tests without saving', async () => {
  const f = fixture()
  render(<ShopMailboxButton runtime={f.runtime} />)
  fireEvent.click(screen.getByRole('button', { name: '收件邮箱' }))
  await screen.findByDisplayValue('test@qq.com')
  fireEvent.change(screen.getByLabelText('邮箱类型'), { target: { value: '126' } })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await screen.findByRole('alert')
  expect(f.post).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('授权码 / 密码'), { target: { value: 'draft' } })
  fireEvent.click(screen.getByRole('button', { name: '测试连接' }))
  await screen.findByText('收件邮箱连接成功')
  expect(f.post.mock.calls[0][0]).toBe('/api/shop-mailbox-test')
  expect(f.store.mailbox.providerKey).toBe('qq')
})

it.each([404, 500, 503])('shows mailbox capability unavailable for server status %s', async status => {
  const f = fixture()
  f.get.mockRejectedValueOnce(Object.assign(new Error(), { status }))
  render(<ShopMailboxButton runtime={f.runtime} />)
  fireEvent.click(screen.getByRole('button', { name: '收件邮箱' }))
  await screen.findByText('当前企业服务尚未提供此能力。')
  expect(screen.getByRole('button', { name: '保存' }).hasAttribute('disabled')).toBe(true)
  expect(f.post).not.toHaveBeenCalled()
})

it('keeps a mailbox draft visible after a conflict', async () => {
  const f = fixture()
  f.post.mockRejectedValueOnce(Object.assign(new Error(), { status: 409 }))
  render(<ShopMailboxButton runtime={f.runtime} />)
  fireEvent.click(screen.getByRole('button', { name: '收件邮箱' }))
  await screen.findByDisplayValue('test@qq.com')
  fireEvent.change(screen.getByLabelText('授权码 / 密码'), { target: { value: 'draft' } })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await screen.findByRole('alert')
  expect((screen.getByLabelText('授权码 / 密码') as HTMLInputElement).value).toBe('draft')
})

it('adds an email subaccount, trims its credentials and preserves the password when toggling', async () => {
  const f = fixture()
  render(<ShopSubAccountsButton profile={profile} runtime={f.runtime} />)
  fireEvent.click(screen.getByRole('button', { name: '子账号' }))
  await screen.findByText('one@example.com')
  fireEvent.click(screen.getByRole('button', { name: '新增账号' }))
  const editor = within(screen.getByRole('dialog', { name: '新增账号' }))
  fireEvent.change(editor.getByLabelText('子账号'), { target: { value: 'bad' } })
  fireEvent.click(editor.getByRole('button', { name: '保存' }))
  await editor.findByRole('alert')
  expect(f.post).not.toHaveBeenCalled()
  fireEvent.change(editor.getByLabelText('子账号'), { target: { value: ' two@example.com ' } })
  fireEvent.change(editor.getByLabelText('密码'), { target: { value: ' secret ' } })
  fireEvent.click(editor.getByRole('button', { name: '保存' }))
  await screen.findByText('two@example.com')
  expect(f.post.mock.calls[0]).toEqual([
    '/api/shop-subaccounts',
    {
      id: undefined,
      profileId: 'p1',
      subAccount: 'two@example.com',
      password: 'secret',
      enabled: true,
      expectedRevision: 0
    }
  ])
  const row = screen.getByText('two@example.com').closest('tr')!
  fireEvent.click(within(row).getByRole('button', { name: '停用' }))
  await waitFor(() => expect(f.store.accounts.find(item => item.id === '2')?.enabled).toBe(false))
  expect((f.post.mock.calls[1][1] as Record<string, unknown>).password).toBeUndefined()
})

it('requires delete confirmation and uses the account revision', async () => {
  const f = fixture()
  render(<ShopSubAccountsButton profile={profile} runtime={f.runtime} />)
  fireEvent.click(screen.getByRole('button', { name: '子账号' }))
  await screen.findByText('one@example.com')
  fireEvent.click(screen.getByRole('button', { name: '删除' }))
  expect(f.post).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '取消' }))
  expect(f.post).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '删除' }))
  fireEvent.click(screen.getByRole('button', { name: '确定' }))
  await screen.findByText('暂无子账号')
  expect(f.post).toHaveBeenCalledExactlyOnceWith('/api/shop-subaccounts-delete', {
    id: '1',
    profileId: 'p1',
    expectedRevision: 1
  })
})

it('rejects a subaccount from a different profile', async () => {
  const f = fixture()
  f.store.accounts[0].profileId = 'foreign'
  await expect(nativeBusinessAdminApi(f.runtime).listSubAccounts('p1')).rejects.toThrow('RESPONSE_INVALID')
})

it('ignores an old mailbox response after changing runtime', async () => {
  const first = fixture()
  const next = fixture()
  let resolve!: (value: unknown) => void
  first.get.mockReturnValueOnce(
    new Promise(done => {
      resolve = done
    })
  )
  const view = render(<ShopMailboxButton runtime={first.runtime} />)
  fireEvent.click(screen.getByRole('button', { name: '收件邮箱' }))
  view.rerender(<ShopMailboxButton runtime={next.runtime} />)
  await act(async () => resolve({ mailbox: first.store.mailbox }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.queryByDisplayValue('test@qq.com')).toBeNull()
})

it.each(['operator', 'supervisor', 'super_admin'])('does not expose assignment mutations to %s', async role => {
  const f = fixture(role)
  const view = render(<ShopSharedAssignment onSaved={() => {}} profileId="p1" runtime={f.runtime} />)
  await act(async () => undefined)
  expect(view.container.innerHTML).toBe('')
  expect(f.get.mock.calls).toEqual([['/api/whoami']])
  expect(f.post).not.toHaveBeenCalled()
})

it('saves multiple employees and then an empty administrator-only list with authoritative readback', async () => {
  const f = fixture()
  render(<ShopSharedAssignment onSaved={() => {}} profileId="p1" runtime={f.runtime} />)
  const a = await screen.findByRole('checkbox', { name: '员工甲' })
  expect(screen.queryByText('外企业员工')).toBeNull()
  expect(screen.getByRole('checkbox', { name: '停用员工 · 停用' }).hasAttribute('disabled')).toBe(true)
  fireEvent.click(a)
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await screen.findByText('已保存')
  expect(f.post.mock.calls[0]).toEqual([
    '/api/shop-login-profiles-assign',
    { profile_id: 'p1', principal_ids: ['b'], expected_revision: 7 }
  ])
  fireEvent.click(screen.getByRole('checkbox', { name: '员工乙' }))
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await waitFor(() => expect(f.post).toHaveBeenCalledTimes(2))
  expect(f.post.mock.calls[1]).toEqual([
    '/api/shop-login-profiles-assign',
    { profile_id: 'p1', principal_ids: [], expected_revision: 8 }
  ])
})

it('uses the latest revision when only shop session or settings changed', async () => {
  const f = fixture()
  render(<ShopSharedAssignment onSaved={() => {}} profileId="p1" runtime={f.runtime} />)
  fireEvent.click(await screen.findByRole('checkbox', { name: '员工甲' }))
  f.store.profiles[0].revision = 8
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await screen.findByText('已保存')
  expect(f.post).toHaveBeenCalledExactlyOnceWith('/api/shop-login-profiles-assign', {
    profile_id: 'p1', principal_ids: ['b'], expected_revision: 8
  })
})

it('preserves the draft and refuses to overwrite concurrent assignment changes', async () => {
  const f = fixture()
  render(<ShopSharedAssignment onSaved={() => {}} profileId="p1" runtime={f.runtime} />)
  fireEvent.click(await screen.findByRole('checkbox', { name: '员工甲' }))
  f.store.profiles[0].revision = 8
  f.store.profiles[0].servicing_principal_ids = ['a']
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await screen.findByRole('alert')
  expect((screen.getByRole('checkbox', { name: '员工甲' }) as HTMLInputElement).checked).toBe(false)
  expect(f.post).not.toHaveBeenCalled()
})

it('retains the draft and offers refresh if a 409 occurs after the final read', async () => {
  const f = fixture()
  render(<ShopSharedAssignment onSaved={() => {}} profileId="p1" runtime={f.runtime} />)
  fireEvent.click(await screen.findByRole('checkbox', { name: '员工甲' }))
  f.post.mockRejectedValueOnce(Object.assign(new Error('conflict'), { status: 409 }))
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  expect((await screen.findByRole('alert')).textContent).toContain('配置已更新')
  expect((screen.getByRole('checkbox', { name: '员工甲' }) as HTMLInputElement).checked).toBe(false)
  expect(f.post).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: '刷新' }))
  await screen.findByRole('checkbox', { name: '员工甲', checked: true })
  expect(f.post).toHaveBeenCalledTimes(1)
})

it('does not submit a draft when the authenticated tenant changes before save', async () => {
  const f = fixture()
  render(<ShopSharedAssignment onSaved={() => {}} profileId="p1" runtime={f.runtime} />)
  fireEvent.click(await screen.findByRole('checkbox', { name: '员工甲' }))
  f.store.identity.tenant_id = 't2'
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await screen.findByRole('alert')
  expect(f.post).not.toHaveBeenCalled()
})

it('rejects a selected employee who becomes inactive before save', async () => {
  const f = fixture()
  render(<ShopSharedAssignment onSaved={() => {}} profileId="p1" runtime={f.runtime} />)
  fireEvent.click(await screen.findByRole('checkbox', { name: '员工甲' }))
  f.store.members.find(member => member.principal_id === 'b')!.status = 'inactive'
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await screen.findByRole('alert')
  expect(f.post).not.toHaveBeenCalled()
})

it('loads a newly created local shop after its cloud record appears', async () => {
  const f = fixture()
  const originalGet = f.get.getMockImplementation()!
  let reads = 0
  f.get.mockImplementation(async path => {
    if (path === '/api/shop-login-profiles' && ++reads === 1) {
      return { profiles: [] }
    }

    return originalGet(path)
  })
  render(<ShopSharedAssignment onSaved={() => {}} profileId="p1" runtime={f.runtime} />)
  expect(await screen.findByRole('checkbox', { name: '员工甲' }, { timeout: 4000 })).toBeTruthy()
  expect(reads).toBe(2)
  expect(f.post).not.toHaveBeenCalled()
})

it('allows a read-only retry when a selected shop remains absent after bounded retries', async () => {
  const f = fixture()
  const originalGet = f.get.getMockImplementation()!
  let available = false
  f.get.mockImplementation(async path => {
    if (path === '/api/shop-login-profiles' && !available) {
      return { profiles: [] }
    }

    return originalGet(path)
  })
  render(<ShopSharedAssignment onSaved={() => {}} profileId="p1" runtime={f.runtime} />)
  await screen.findByRole('alert', {}, { timeout: 4000 })
  expect(f.get.mock.calls.filter(([path]) => path === '/api/shop-login-profiles')).toHaveLength(5)
  available = true
  fireEvent.click(screen.getByRole('button', { name: '刷新' }))
  expect(await screen.findByRole('checkbox', { name: '员工甲' })).toBeTruthy()
  expect(f.post).not.toHaveBeenCalled()
})

it('stops retrying the old shop after the editor unmounts', async () => {
  const f = fixture()
  const originalGet = f.get.getMockImplementation()!
  f.get.mockImplementation(async path =>
    path === '/api/shop-login-profiles' ? { profiles: [] } : originalGet(path)
  )
  const view = render(<ShopSharedAssignment onSaved={() => {}} profileId="p1" runtime={f.runtime} />)
  await waitFor(() => expect(f.get.mock.calls.some(([path]) => path === '/api/principals')).toBe(true))
  view.unmount()
  await act(async () => new Promise(resolve => setTimeout(resolve, 650)))
  expect(f.get.mock.calls.filter(([path]) => path === '/api/shop-login-profiles')).toHaveLength(1)
  expect(f.post).not.toHaveBeenCalled()
})

it('edits visible shops while preserving other employees and keeps scope-all unavailable', async () => {
  const f = fixture()
  render(<NativeAgentsPanel runtime={f.runtime} />)
  const name = await screen.findByText('agent-a')
  fireEvent.click(within(name.closest('tr')!).getByRole('button', { name: '可见店铺' }))
  const dialog = within(await screen.findByRole('dialog'))
  await dialog.findByRole('checkbox', { name: '店铺乙' })
  expect(dialog.getByRole('radio', { name: '团队全部店铺（新增店铺自动可见）' }).hasAttribute('disabled')).toBe(true)
  fireEvent.click(dialog.getByRole('checkbox', { name: '店铺乙' }))
  fireEvent.click(dialog.getByRole('button', { name: '保存' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(f.post).toHaveBeenCalledExactlyOnceWith('/api/shop-login-profiles-assign', {
    profile_id: 'p2',
    principal_ids: ['b', 'a'],
    expected_revision: 4
  })
})

it('omits implicit administrator ownership when assigning a newly created shop from a seat', async () => {
  const f = fixture()
  f.store.profiles[1].servicing_principal_ids = ['admin', 'b']
  render(<NativeAgentsPanel runtime={f.runtime} />)
  const name = await screen.findByText('agent-a')
  fireEvent.click(within(name.closest('tr')!).getByRole('button', { name: '可见店铺' }))
  const dialog = within(await screen.findByRole('dialog'))
  fireEvent.click(await dialog.findByRole('checkbox', { name: '店铺乙' }))
  fireEvent.click(dialog.getByRole('button', { name: '保存' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(f.post).toHaveBeenCalledExactlyOnceWith('/api/shop-login-profiles-assign', {
    profile_id: 'p2',
    principal_ids: ['b', 'a'],
    expected_revision: 4
  })
})

it('omits implicit administrator ownership in the per-shop employee editor', async () => {
  const f = fixture()
  f.store.profiles[0].servicing_principal_ids = ['admin', 'a', 'b']
  render(<ShopSharedAssignment onSaved={() => {}} profileId="p1" runtime={f.runtime} />)
  fireEvent.click(await screen.findByRole('checkbox', { name: '员工甲' }))
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await screen.findByText('已保存')
  expect(f.post).toHaveBeenCalledExactlyOnceWith('/api/shop-login-profiles-assign', {
    profile_id: 'p1',
    principal_ids: ['b'],
    expected_revision: 7
  })
})

it.each(['missing', 'unsupported-role'])('rejects an unverified assigned member when the roster is %s', async mode => {
  const f = fixture()
  f.store.profiles[0].servicing_principal_ids = ['a', 'unknown']

  if (mode === 'unsupported-role') {
    f.store.members.push({ principal_id: 'unknown', name: '未知角色', role: 'observer', status: 'active' })
  }

  render(<ShopSharedAssignment onSaved={() => {}} profileId="p1" runtime={f.runtime} />)
  await screen.findByText('配置未通过服务校验，请刷新后检查字段、员工状态与当前授权。')
  expect(f.post).not.toHaveBeenCalled()
})

it('reports a rejected assignment target without claiming the service capability is unavailable', async () => {
  const f = fixture()
  f.post.mockRejectedValueOnce(Object.assign(new Error(), { status: 404 }))
  render(<ShopSharedAssignment onSaved={() => {}} profileId="p1" runtime={f.runtime} />)
  fireEvent.click(await screen.findByRole('checkbox', { name: '员工甲' }))
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await screen.findByText('配置未通过服务校验，请刷新后检查字段、员工状态与当前授权。')
  expect(screen.queryByText('当前企业服务尚未提供此能力。')).toBeNull()
  expect(f.store.profiles[0].servicing_principal_ids).toEqual(['a', 'b'])
})

it.each(['shop', 'seat'])('does not start an assignment after the %s editor unmounts during roster refresh', async entry => {
  const f = fixture()
  const originalGet = f.get.getMockImplementation()!
  let holdRoster = false
  let resolveRoster: ((value: unknown) => void) | undefined
  f.get.mockImplementation(path => {
    if (holdRoster && path === '/api/principals') {
      return new Promise(resolve => {
        resolveRoster = resolve
      })
    }

    return originalGet(path)
  })

  const view = render(
    entry === 'shop' ? (
      <ShopSharedAssignment onSaved={() => {}} profileId="p1" runtime={f.runtime} />
    ) : (
      <NativeAgentsPanel runtime={f.runtime} />
    )
  )

  if (entry === 'shop') {
    fireEvent.click(await screen.findByRole('checkbox', { name: '员工甲' }))
  } else {
    const name = await screen.findByText('agent-a')
    fireEvent.click(within(name.closest('tr')!).getByRole('button', { name: '可见店铺' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: '店铺乙' }))
  }

  holdRoster = true
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await waitFor(() => expect(resolveRoster).toBeDefined())
  view.unmount()
  await act(async () => resolveRoster!({ principals: f.store.members }))
  expect(f.post).not.toHaveBeenCalled()
})

it('keeps original seat reset unavailable without posting credentials', async () => {
  const f = fixture()
  render(<NativeAgentsPanel runtime={f.runtime} />)
  const name = await screen.findByText('agent-a')
  fireEvent.click(within(name.closest('tr')!).getByRole('button', { name: '重置密码' }))
  const dialog = within(screen.getByRole('dialog'))
  fireEvent.change(dialog.getByLabelText('密码'), { target: { value: 'draft' } })
  expect(dialog.getByRole('button', { name: '确定' }).hasAttribute('disabled')).toBe(true)
  expect(f.post).not.toHaveBeenCalled()
})

it('retries only unfinished shop assignments after a partial conflict', async () => {
  const f = fixture()
  const actual = f.post.getMockImplementation()!
  let calls = 0
  f.post.mockImplementation(async (path, body) => {
    calls++

    if (calls === 2) {
      throw Object.assign(new Error(), { status: 409 })
    }

    return actual(path, body)
  })
  render(<NativeAgentsPanel runtime={f.runtime} />)
  const name = await screen.findByText('agent-a')
  fireEvent.click(within(name.closest('tr')!).getByRole('button', { name: '可见店铺' }))
  const dialog = within(await screen.findByRole('dialog'))
  await dialog.findByRole('checkbox', { name: '店铺乙' })
  fireEvent.click(dialog.getByRole('checkbox', { name: '店铺甲' }))
  fireEvent.click(dialog.getByRole('checkbox', { name: '店铺乙' }))
  fireEvent.click(dialog.getByRole('button', { name: '保存' }))
  await dialog.findByRole('alert')
  await waitFor(() => expect(dialog.getByRole('button', { name: '保存' }).hasAttribute('disabled')).toBe(false))
  fireEvent.click(dialog.getByRole('button', { name: '保存' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(f.post.mock.calls.map(([, body]) => (body as { profile_id: string }).profile_id)).toEqual(['p1', 'p2', 'p2'])
  expect(f.store.profiles[0].servicing_principal_ids).toEqual(['b'])
  expect(f.store.profiles[1].servicing_principal_ids).toEqual(['b', 'a'])
})

it('projects public mailbox and subaccount metadata even if a server includes extra fields', async () => {
  const f = fixture()
  f.get.mockResolvedValueOnce({ mailbox: { ...f.store.mailbox, password: 'must-not-enter-state' } })
  expect(await nativeBusinessAdminApi(f.runtime).getMailbox()).not.toHaveProperty('password')
  f.get.mockResolvedValueOnce({ subAccounts: [{ ...f.store.accounts[0], subPassword: 'must-not-enter-state' }] })
  expect((await nativeBusinessAdminApi(f.runtime).listSubAccounts('p1'))[0]).not.toHaveProperty('subPassword')
})

it.each(['new', 'edit'])('confirms an acknowledged %s subaccount write after readback failure without another POST', async mode => {
  const f = fixture()
  const originalGet = f.get.getMockImplementation()!
  let failReadback = true
  f.get.mockImplementation(async path => {
    if (path.startsWith('/api/shop-subaccounts?') && f.post.mock.calls.length && failReadback) {
      failReadback = false
      throw new Error('Readback interrupted')
    }

    return originalGet(path)
  })
  render(<ShopSubAccountsButton profile={profile} runtime={f.runtime} />)
  fireEvent.click(screen.getByRole('button', { name: '子账号' }))
  await screen.findByText('one@example.com')
  fireEvent.click(screen.getByRole('button', { name: mode === 'new' ? '新增账号' : '编辑' }))
  const editor = within(screen.getByRole('dialog', { name: mode === 'new' ? '新增账号' : '编辑账号' }))
  fireEvent.change(editor.getByLabelText('子账号'), { target: { value: 'confirmed@example.com' } })
  fireEvent.change(editor.getByLabelText('密码'), { target: { value: 'secret' } })
  fireEvent.click(editor.getByRole('button', { name: '保存' }))
  await editor.findByRole('alert')
  expect(f.post).toHaveBeenCalledTimes(1)
  expect(editor.getByLabelText('子账号').hasAttribute('disabled')).toBe(true)
  expect((editor.getByLabelText('密码') as HTMLInputElement).value).toBe('')
  fireEvent.click(editor.getByRole('button', { name: '刷新' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: mode === 'new' ? '新增账号' : '编辑账号' })).toBeNull())
  await screen.findByText('confirmed@example.com')
  expect(f.post).toHaveBeenCalledTimes(1)
})

it('confirms an acknowledged mailbox write after readback failure without reusing the old revision', async () => {
  const f = fixture()
  const originalGet = f.get.getMockImplementation()!
  let failReadback = true
  f.get.mockImplementation(async path => {
    if (path === '/api/shop-mailbox' && f.post.mock.calls.length && failReadback) {
      failReadback = false
      throw new Error('Readback interrupted')
    }

    return originalGet(path)
  })
  render(<ShopMailboxButton runtime={f.runtime} />)
  fireEvent.click(screen.getByRole('button', { name: '收件邮箱' }))
  await screen.findByDisplayValue('test@qq.com')
  fireEvent.change(screen.getByLabelText('授权码 / 密码'), { target: { value: 'secret' } })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await screen.findByRole('alert')
  expect(f.post).toHaveBeenCalledTimes(1)
  expect(screen.getByLabelText('邮箱地址').hasAttribute('disabled')).toBe(true)
  expect((screen.getByLabelText('授权码 / 密码') as HTMLInputElement).value).toBe('')
  fireEvent.click(screen.getByRole('button', { name: '刷新' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(f.post).toHaveBeenCalledTimes(1)
})

it('rejects a mailbox save receipt whose account differs from the submitted draft', async () => {
  const f = fixture()
  f.post.mockResolvedValueOnce({ mailbox: { ...f.store.mailbox, user: 'other@qq.com', revision: 4 } })
  await expect(nativeBusinessAdminApi(f.runtime).saveMailbox({
    providerKey: 'qq', user: 'test@qq.com', expectedRevision: 3
  })).rejects.toThrow('RESPONSE_INVALID')
})

it('rejects a subaccount save receipt whose enabled state differs from the submitted draft', async () => {
  const f = fixture()
  f.post.mockResolvedValueOnce({ subAccount: { ...f.store.accounts[0], revision: 2 } })
  await expect(nativeBusinessAdminApi(f.runtime).saveSubAccount({
    id: '1', profileId: 'p1', subAccount: 'one@example.com', enabled: false, expectedRevision: 1
  })).rejects.toThrow('RESPONSE_INVALID')
})
