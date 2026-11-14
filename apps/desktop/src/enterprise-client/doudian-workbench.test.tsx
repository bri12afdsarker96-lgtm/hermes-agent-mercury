import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { zh } from '@/i18n/zh'

import type { DoudianReply, DoudianRequest, DoudianTask } from '../../electron/doudian-types'

import { DoudianWorkbench } from './doudian-workbench'
import { ReviewCapturePage } from './review-capture-page'
import type { EnterpriseClientRuntime } from './runtime'

vi.mock('@/i18n/context', () => ({ useI18n: () => ({ t: zh }) }))

function setup(reviewOptions?: number) {
  let task: DoudianTask = { taskId: null, state: 'idle', saved: 0, summary: '', error: '', messages: [] }

  const send = vi.fn(async (request: Omit<DoudianRequest, 'sessionId'>): Promise<DoudianReply> => {
    if (request.action === 'capabilities') {
      return {
        ok: true,
        capabilities: { protocol: 1, version: '1.0.54', authorized: true, chrome: true, spreadsheet: true, reviewOptions }
      }
    }

    if (request.action === 'shops') {
      return { ok: true, shops: [{ id: 'a'.repeat(32), name: '模拟店铺', platformId: '123', status: 'Valid' }] }
    }

    if (request.action === 'chooseWorkbook') {
      return { ok: true, workbook: { id: 'b'.repeat(32), name: '测试副本.xlsx' } }
    }

    if (request.action === 'prepare') {
      task = {
        ...task,
        taskId: 'c'.repeat(32),
        state: 'awaiting_confirmation',
        summary: '模拟表格：从第 4 行继续，B 列已有内容保留。'
      }
    }

    if (request.action === 'start') {
      task = { ...task, state: 'running' }
    }

    if (request.action === 'stop') {
      task = { ...task, state: 'stopped', saved: 1 }
    }

    return { ok: true, task }
  })

  const runtime = { doudian: send } as unknown as EnterpriseClientRuntime

  return { send, runtime, setReviewOptions: (value: number | undefined) => { reviewOptions = value }, view: render(<DoudianWorkbench runtime={runtime} />) }
}

describe('Doudian workbench (offline fixtures)', () => {
  it('shows the integrated screenshot page without an activation-code form or request', async () => {
    const send = vi.fn(async (request: Omit<DoudianRequest, 'sessionId'>): Promise<DoudianReply> => {
      if (request.action === 'capabilities') return { ok: true, capabilities: { protocol: 1, version: '1.0.54', authorized: true, chrome: true, spreadsheet: true, authorizationMode: 'enterprise-session-v1' } }
      if (request.action === 'shops') return { ok: true, shops: [] }
      return { ok: true, task: { taskId: null, state: 'idle', saved: 0, summary: '', error: '', messages: [] } }
    })
    render(<ReviewCapturePage runtime={{ doudian: send } as unknown as EnterpriseClientRuntime} />)
    await screen.findByText('请选择店铺')
    expect(screen.queryByText(/激活码/)).toBeNull()
    expect(send.mock.calls.some(([request]) => ['activateLicense', 'resumeLicense', 'licenseStatus'].includes(request.action))).toBe(false)
  })
  it('sends chosen range and concurrency to the prepare bridge', async () => {
    const { send } = setup(1)
    await screen.findByText('模拟店铺 (123)')
    fireEvent.change(screen.getByLabelText('起始行'), { target: { value: '7' } })
    fireEvent.change(screen.getByLabelText('最多行'), { target: { value: '13' } })
    fireEvent.change(screen.getByLabelText('截图并发'), { target: { value: '4' } })
    fireEvent.change(screen.getByRole('combobox', { name: '店铺' }), { target: { value: 'a'.repeat(32) } })
    fireEvent.click(screen.getByText('选择工作簿副本'))
    await screen.findByText('测试副本.xlsx')
    fireEvent.click(screen.getByText('检查待回填表格'))
    await waitFor(() => expect(send).toHaveBeenCalledWith({ action: 'prepare', shopId: 'a'.repeat(32), workbookId: 'b'.repeat(32), startRow: '7', maxRows: '13', concurrency: '4' }))
  })
  it('shows old host limitations and preserves the old no-options request', async () => {
    const { send } = setup()
    await screen.findByText('模拟店铺 (123)')
    expect(screen.getByLabelText('起始行').matches(':disabled')).toBe(true)
    expect(screen.getByText(/当前执行模块不支持范围与并发设置/)).toBeTruthy()
    fireEvent.change(screen.getByRole('combobox', { name: '店铺' }), { target: { value: 'a'.repeat(32) } })
    fireEvent.click(screen.getByText('选择工作簿副本'))
    await screen.findByText('测试副本.xlsx')
    fireEvent.click(screen.getByText('检查待回填表格'))
    await waitFor(() => expect(send).toHaveBeenCalledWith({ action: 'prepare', shopId: 'a'.repeat(32), workbookId: 'b'.repeat(32) }))
  })
  it('does not discard selected options when the host loses the capability', async () => {
    const { send, setReviewOptions } = setup(1)
    await screen.findByText('模拟店铺 (123)')
    fireEvent.change(screen.getByLabelText('起始行'), { target: { value: '7' } })
    fireEvent.change(screen.getByRole('combobox', { name: '店铺' }), { target: { value: 'a'.repeat(32) } })
    fireEvent.click(screen.getByText('选择工作簿副本'))
    await screen.findByText('测试副本.xlsx')
    setReviewOptions(undefined)
    fireEvent.click(screen.getByText(zh.doudian.refresh))
    await screen.findByText(/当前执行模块不支持范围与并发设置/)
    fireEvent.click(screen.getByText('检查待回填表格'))
    await screen.findByRole('alert')
    expect(send.mock.calls.some(([request]) => request.action === 'prepare')).toBe(false)
  })
  it('previews continuation before explicit start, and reports only saved counts', async () => {
    const { send } = setup()
    await screen.findByText('模拟店铺 (123)')
    fireEvent.change(screen.getByRole('combobox', { name: '店铺' }), { target: { value: 'a'.repeat(32) } })
    fireEvent.click(screen.getByText('选择工作簿副本'))
    await screen.findByText('测试副本.xlsx')
    fireEvent.click(screen.getByText('检查待回填表格'))
    await screen.findByText(/模拟表格：从第 4 行继续/)
    expect(send.mock.calls.some(([request]) => request.action === 'start')).toBe(false)
    fireEvent.click(screen.getByText('确认截图并回填'))
    await screen.findByText('正在截图')
    expect(screen.getByText('已保存回填: 0')).toBeTruthy()
    fireEvent.click(screen.getByText('停止'))
    await screen.findByText('已停止')
    expect(screen.getByText('已保存回填: 1')).toBeTruthy()
    expect(send.mock.calls.filter(([request]) => request.action === 'start')).toHaveLength(1)
  })
  it('shows a missing module instead of fictional shops or success', async () => {
    const send = vi.fn(async () => ({ ok: false, error: 'DOUDIAN_MODULE_MISSING' }))
    render(<DoudianWorkbench runtime={{ doudian: send } as unknown as EnterpriseClientRuntime} />)
    await screen.findByText('尚未安装本机截图执行模块。')
    expect(screen.queryByText('模拟店铺')).toBeNull()
    expect((screen.getByText('检查待回填表格').closest('button') as HTMLButtonElement).disabled).toBe(true)
  })
  it('clears old account data and ignores its late response after changing runtime', async () => {
    const { view } = setup()
    await screen.findByText('模拟店铺 (123)')
    let finish!: (reply: DoudianReply) => void

    const runtime = {
      doudian: vi.fn(
        () =>
          new Promise<DoudianReply>(resolve => {
            finish = resolve
          })
      )
    } as unknown as EnterpriseClientRuntime

    view.rerender(<DoudianWorkbench runtime={runtime} />)
    expect(screen.queryByText('模拟店铺 (123)')).toBeNull()
    await waitFor(() => expect(finish).toBeTypeOf('function'))
    finish({ ok: false, error: 'DOUDIAN_FORBIDDEN' })
    await screen.findByText('当前企业账号无权使用此工作台。')
  })
})
