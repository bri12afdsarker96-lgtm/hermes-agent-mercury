import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n/context'
import { AccountControls } from './account-controls'
import { ReceivablesPage } from './receivables-page'
import { WeComDutyPanel } from './wecom-duty-panel'
import { DeliveryHistory } from './delivery-history'
import { KnowledgeUploadHistory, RechunkControls } from './knowledge-upload-history'
import { supplementaryReplyOptions } from './assistant-response'
import { enterpriseClientErrorForStatus } from './runtime-errors'
import { prepareEnterprisePackageInstall, releaseEnterprisePackageInstall } from './enterprise-install-readiness'
import type { EnterpriseClientRuntime } from './runtime'

function mount(child: ReactNode) {
  return render(
    <I18nProvider initialLocale="zh" configClient={null}>
      {child}
    </I18nProvider>
  )
}
function runtimeWith(
  get = vi.fn(async (_path: string): Promise<unknown> => ({})),
  post = vi.fn(async (_path: string, _body: unknown): Promise<unknown> => ({}))
) {
  return { get, post, disconnect: vi.fn() } as unknown as EnterpriseClientRuntime
}
function expand(label: string) {
  const details = screen.getByText(label, { selector: 'summary' }).closest('details')!
  details.open = true
  fireEvent(details, new Event('toggle'))
}
afterEach(() => releaseEnterprisePackageInstall())

describe('account security', () => {
  it('validates confirmation, keeps typing focus and clears submitted secrets before awaiting the server', async () => {
    let finish!: (value: unknown) => void
    let submitted: unknown
    const post = vi.fn(async (_path: string, body: unknown) => {
      submitted = structuredClone(body)
      return await new Promise(resolve => {
        finish = resolve
      })
    })
    mount(<AccountControls runtime={runtimeWith(undefined, post)} onLogout={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '账户安全' }))
    const current = screen.getByLabelText('当前密码') as HTMLInputElement
    const next = screen.getByLabelText('新密码') as HTMLInputElement
    current.focus()
    fireEvent.change(current, { target: { value: 'old-password' } })
    expect(document.activeElement).toBe(current)
    fireEvent.change(next, { target: { value: 'new-password' } })
    fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: 'mismatch' } })
    expect(screen.getByRole('button', { name: '修改密码' }).hasAttribute('disabled')).toBe(true)
    expect((await prepareEnterprisePackageInstall('dirty-account')).ready).toBe(false)
    fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: 'new-password' } })
    fireEvent.click(screen.getByRole('button', { name: '修改密码' }))
    expect(submitted).toEqual({ current_password: 'old-password', new_password: 'new-password' })
    expect(current.value).toBe('')
    expect(next.value).toBe('')
    expect(screen.getByRole('button', { name: '退出登录' }).hasAttribute('disabled')).toBe(true)
    expect(post).toHaveBeenCalledTimes(1)
    await act(async () => finish({ ok: true }))
    expect(await screen.findByText('密码已修改，当前会话已更新。')).toBeTruthy()
  })
  it('only logs out on the explicit account action', async () => {
    const logout = vi.fn(async () => {})
    mount(<AccountControls runtime={runtimeWith()} onLogout={logout} />)
    fireEvent.click(screen.getByRole('button', { name: '账户安全' }))
    expect(logout).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '退出登录' }))
    await waitFor(() => expect(logout).toHaveBeenCalledOnce())
  })
})

describe('receivable delivery', () => {
  function draft() {
    fireEvent.change(screen.getByLabelText('业务对象 / 群名称'), { target: { value: '验收客户' } })
    fireEvent.change(screen.getByLabelText('应收金额（元）'), { target: { value: '128.30' } })
    fireEvent.change(screen.getByLabelText('预计到账日期'), { target: { value: '2026-10-20' } })
  }
  it('filters older team-scoped lists to the owner and retains exact idempotency data on uncertain retry', async () => {
    const mine = {
      source_id: 'f1',
      owner_principal_id: 'me',
      business_subject: '本人应收款',
      status: 'open',
      allowed_actions: ['received']
    }
    const get = vi.fn(async (_path: string) => ({
      available: true,
      followups: [mine, { ...mine, source_id: 'f2', owner_principal_id: 'other', business_subject: '别人应收款' }]
    }))
    const post = vi.fn(async (_path: string, _body: unknown): Promise<unknown> => {
      throw new Error('network')
    })
    post.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce({ ok: true, followup: mine })
    const inspect = vi.fn()
    mount(<ReceivablesPage runtime={runtimeWith(get, post)} principalId="me" scope="t:me" onInspect={inspect} />)
    expect(await screen.findByText('本人应收款')).toBeTruthy()
    expect(screen.getByText('别人应收款')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('人员筛选'), {target:{value:'mine'}})
    expect(screen.queryByText('别人应收款')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '查看与处理' }))
    expect(inspect).toHaveBeenCalledWith(mine)
    draft()
    expect((await prepareEnterprisePackageInstall('dirty-followup')).ready).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '新建' }))
    expect((await screen.findByRole('alert')).textContent).toContain('未确认提交结果')
    expect(screen.getByLabelText('应收金额（元）').hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '重试提交' }))
    expect(await screen.findByText('已创建，提醒已同步到提醒中心。')).toBeTruthy()
    expect(post.mock.calls[0]).toEqual(post.mock.calls[1])
    expect(post.mock.calls[0][1]).toEqual(
      expect.objectContaining({ business_subject: '验收客户', amount: '128.30', idempotency_key: expect.any(String) })
    )
    expect((screen.getByLabelText('应收金额（元）') as HTMLInputElement).value).toBe('')
  })
  it('allows correcting an explicitly rejected request without losing its draft', async () => {
    const get = vi.fn(async (_path: string) => ({ followups: [] }))
    const post = vi.fn(async (_path: string, _body: unknown): Promise<unknown> => {
      throw enterpriseClientErrorForStatus(400)
    })
    mount(<ReceivablesPage runtime={runtimeWith(get, post)} principalId="me" scope="t:me" onInspect={vi.fn()} />)
    await screen.findByText('暂无记录。')
    draft()
    fireEvent.click(screen.getByRole('button', { name: '新建' }))
    await screen.findByRole('alert')
    expect(screen.getByLabelText('应收金额（元）').hasAttribute('disabled')).toBe(false)
    expect((screen.getByLabelText('应收金额（元）') as HTMLInputElement).value).toBe('128.30')
  })
})

describe('answer presentation', () => {
  it('shows each server reply once without inventing a missing alternative', () => {
    const followup = { kind: 'follow_up' as const, text: '收到后继续核实。' }
    const alternate = { kind: 'alternative_reply' as const, text: '请先提供订单资料。' }
    expect(
      supplementaryReplyOptions(' 您好。 ', [{ kind: 'current_reply', text: '您好。' }, followup, followup, alternate])
    ).toEqual([followup, alternate])
    expect(supplementaryReplyOptions('您好。')).toEqual([])
    expect(supplementaryReplyOptions('内部说明', [{ kind: 'current_reply', text: '您好。' }])).toHaveLength(1)
  })
})

describe('read-only histories and duty settings', () => {
  it('loads notification history only on request and distinguishes an unavailable feature from empty records', async () => {
    const get = vi.fn(async (_path: string) => ({ available: false }))
    mount(<DeliveryHistory runtime={runtimeWith(get)} kind="outbox" />)
    expect(get).not.toHaveBeenCalled()
    expand('通知投递记录')
    expect((await screen.findByRole('alert')).textContent).toContain('尚未启用')
    expect(screen.queryByText('暂无记录。')).toBeNull()
    expect(get).toHaveBeenCalledWith('/api/delivery-outbox')
  })
  it('never changes duty optimistically or hides a failed write during reconciliation', async () => {
    const get = vi.fn(async (_path: string) => ({ my_on_duty: false, my_auto_reply_enabled: false }))
    const post = vi.fn(async (_path: string, _body: unknown): Promise<unknown> => {
      throw new Error('offline')
    })
    mount(<WeComDutyPanel role="operator" runtime={runtimeWith(get, post)} />)
    fireEvent.click(await screen.findByLabelText('本人正在值守'))
    await screen.findByRole('alert')
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2))
    expect((screen.getByLabelText('本人正在值守') as HTMLInputElement).checked).toBe(false)
    expect(screen.getByRole('alert').textContent).toContain('操作未完成')
    expect(post).toHaveBeenCalledWith('/api/wecom-duty', { on_duty: true })
  })
  it('does not expose the operator automatic-reply switch to a supervisor', async () => {
    const get = vi.fn(async (_path: string) => ({ my_on_duty: true }))
    mount(<WeComDutyPanel role="supervisor" runtime={runtimeWith(get)} />)
    expect(((await screen.findByLabelText('本人正在值守')) as HTMLInputElement).checked).toBe(true)
    expect(screen.queryByLabelText('本人自动答复')).toBeNull()
  })
})

describe('knowledge staging', () => {
  it('resumes only editable upload batches and keeps published records read-only', async () => {
    const get = vi.fn(async (_path: string) => ({
      uploads: [
        { upload_id: 'u1', filename: '待提交.txt', status: 'staged', created_ts: 1 },
        { upload_id: 'u2', filename: '已发布.txt', status: 'committed', created_ts: 2 }
      ]
    }))
    const resume = vi.fn(async () => {})
    mount(<KnowledgeUploadHistory runtime={runtimeWith(get)} disabled={false} onResume={resume} />)
    expect(get).not.toHaveBeenCalled()
    expand('历史上传')
    const pending = (await screen.findByText('待提交.txt')).closest('tr')!
    fireEvent.click(within(pending).getByRole('button', { name: '继续处理' }))
    expect(resume).toHaveBeenCalledWith(expect.objectContaining({ upload_id: 'u1' }))
    expect(within(screen.getByText('已发布.txt').closest('tr')!).getByRole('button').hasAttribute('disabled')).toBe(
      true
    )
  })
  it('validates chunk size and overlap before any rechunk mutation', () => {
    const rechunk = vi.fn(async () => {})
    mount(<RechunkControls disabled={false} onRechunk={rechunk} />)
    expand('重新切分')
    fireEvent.change(screen.getByLabelText('重叠字符数'), { target: { value: 500 } })
    expect(screen.getByRole('button', { name: '重新切分' }).hasAttribute('disabled')).toBe(true)
    fireEvent.change(screen.getByLabelText('重叠字符数'), { target: { value: 100 } })
    fireEvent.click(screen.getByRole('button', { name: '重新切分' }))
    expect(rechunk).toHaveBeenCalledWith(500, 100)
  })
})
