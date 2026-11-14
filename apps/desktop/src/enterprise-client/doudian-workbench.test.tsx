import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { zh } from '@/i18n/zh'

import type { DoudianReply, DoudianRequest, DoudianTask } from '../../electron/doudian-types'

import { DoudianWorkbench } from './doudian-workbench'
import type { EnterpriseClientRuntime } from './runtime'

vi.mock('@/i18n/context', () => ({ useI18n: () => ({ t: zh }) }))

function setup() {
  let task: DoudianTask = { taskId: null, state: 'idle', saved: 0, summary: '', error: '', messages: [] }

  const send = vi.fn(async (request: Omit<DoudianRequest, 'sessionId'>): Promise<DoudianReply> => {
    if (request.action === 'capabilities') {
      return {
        ok: true,
        capabilities: { protocol: 1, version: '1.0.54', authorized: true, chrome: true, spreadsheet: true }
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

  return { send, runtime, view: render(<DoudianWorkbench runtime={runtime} />) }
}

describe('Doudian workbench (offline fixtures)', () => {
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
