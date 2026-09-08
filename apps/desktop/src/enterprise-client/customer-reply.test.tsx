import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AssistantPage } from './assistant-page'
import { assistantSessionFor, releaseAssistantSession } from './assistant-session'
import {
  addCustomerReply,
  closeCustomerReply,
  createCustomerReplyWorkspace,
  generateCustomerReply,
  updateCustomerReplyInput
} from './customer-reply'
import type { EnterpriseClientRuntime } from './runtime'

interface Reply {
  text: string
  knowledge_grounded: boolean
}

function deferred() {
  let resolve!: (result: Reply) => void

  const promise = new Promise<Reply>(done => {
    resolve = done
  })

  return { promise, resolve }
}

function makeRuntime(
  post: (path: string, body: unknown) => Promise<Reply> = vi.fn(async () => ({
    text: '可以为您核实退款条件。',
    knowledge_grounded: true
  }))
) {
  return {
    disconnect: vi.fn(async () => undefined),
    get: vi.fn(async () => ({
      configured: true,
      models: [
        { configuration_id: 'default', is_default: true, model: '企业模型', provider: 'test' },
        { configuration_id: 'fast', is_default: false, model: '快速模型', provider: 'test' }
      ]
    })) as unknown as EnterpriseClientRuntime['get'],
    post: post as unknown as NonNullable<EnterpriseClientRuntime['post']>
  }
}

async function startPage(runtime: EnterpriseClientRuntime) {
  const view = render(<AssistantPage principalId="seat_a" runtime={runtime} tenantId="tenant_a" />)
  await screen.findByText('企业默认 · test · 企业模型')

  return view
}

function setContext(text: string) {
  fireEvent.change(screen.getByLabelText('客户会话上下文'), { target: { value: text } })
}

function renameCustomer(text: string) {
  fireEvent.change(screen.getByLabelText('客户备注（仅用于区分工作区）'), { target: { value: text } })
}

afterEach(() => vi.restoreAllMocks())

describe('customer reply workspaces', () => {
  it('keeps simultaneous, out-of-order replies and edited drafts with their originating customers', async () => {
    const first = deferred()
    const second = deferred()
    const post = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const runtime = makeRuntime(post)
    await startPage(runtime)
    renameCustomer('张女士')
    setContext('客户甲：甲订单可以退款吗？')
    fireEvent.click(screen.getByRole('button', { name: '生成回复建议' }))
    fireEvent.click(screen.getByRole('button', { name: '新增客户' }))
    renameCustomer('李先生')
    setContext('客户乙：乙订单如何开发票？')
    fireEvent.change(screen.getByLabelText('当前使用模型'), { target: { value: 'fast' } })
    fireEvent.click(screen.getByRole('button', { name: '生成回复建议' }))
    expect(post).toHaveBeenCalledTimes(2)
    expect(post.mock.calls[0][1]).toMatchObject({ mode: 'knowledge_question', configuration_id: undefined })
    expect(post.mock.calls[0][1].content).toContain('客户甲：甲订单')
    expect(post.mock.calls[0][1].content).not.toContain('客户乙')
    expect(post.mock.calls[1][1]).toMatchObject({ mode: 'knowledge_question', configuration_id: 'fast' })
    expect(post.mock.calls[1][1].content).not.toContain('客户甲')

    await act(async () => {
      second.resolve({ text: '乙客户发票答复', knowledge_grounded: true })
    })
    fireEvent.change(screen.getByLabelText('待审核回复（可修改）'), { target: { value: '乙客户人工修改的答复' } })
    await act(async () => {
      first.resolve({ text: '甲客户退款答复', knowledge_grounded: true })
    })
    expect((screen.getByLabelText('待审核回复（可修改）') as HTMLTextAreaElement).value).toBe('乙客户人工修改的答复')
    fireEvent.click(screen.getByRole('button', { name: /张女士.*待审核/ }))
    expect((screen.getByLabelText('客户会话上下文') as HTMLTextAreaElement).value).toContain('甲订单')
    expect((screen.getByLabelText('待审核回复（可修改）') as HTMLTextAreaElement).value).toBe('甲客户退款答复')
    fireEvent.click(screen.getByRole('button', { name: /李先生.*待审核/ }))
    expect((screen.getByLabelText('待审核回复（可修改）') as HTMLTextAreaElement).value).toBe('乙客户人工修改的答复')
  })

  it('copies only the active edited draft and reports the customer without marking it sent', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    await startPage(makeRuntime())
    renameCustomer('待核对客户')
    setContext('客户：可以退款吗？')
    fireEvent.click(screen.getByRole('button', { name: '生成回复建议' }))
    await screen.findByLabelText('待审核回复（可修改）')
    fireEvent.change(screen.getByLabelText('待审核回复（可修改）'), { target: { value: '人工确认过的文字' } })
    fireEvent.click(screen.getByRole('button', { name: '复制当前客户回复' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('人工确认过的文字'))
    expect(await screen.findByText(/已复制「待核对客户/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /待核对客户.*已复制 · 待发送/ })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('待审核回复（可修改）'), { target: { value: '再次修改' } })
    expect(screen.getByRole('button', { name: /待核对客户.*待审核/ })).toBeTruthy()
  })

  it('keeps a recoverable draft when clipboard access fails', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn(async () => {
          throw new Error('denied')
        })
      }
    })
    await startPage(makeRuntime())
    setContext('客户：退款条件？')
    fireEvent.click(screen.getByRole('button', { name: '生成回复建议' }))
    await screen.findByLabelText('待审核回复（可修改）')
    fireEvent.click(screen.getByRole('button', { name: '复制当前客户回复' }))
    expect(await screen.findByText(/复制失败/)).toBeTruthy()
    expect((screen.getByLabelText('待审核回复（可修改）') as HTMLTextAreaElement).value).not.toBe('')
  })

  it('does not offer an ungrounded result as a customer reply', async () => {
    await startPage(makeRuntime(vi.fn(async () => ({ text: '没有资料', knowledge_grounded: false }))))
    setContext('客户：退款条件？')
    fireEvent.click(screen.getByRole('button', { name: '生成回复建议' }))
    expect(await screen.findByText(/企业知识库中未找到足够依据/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: '复制当前客户回复' })).toBeNull()
  })

  it('preserves work across navigation and isolates the same principal in another tenant', async () => {
    const runtime = makeRuntime()
    const view = await startPage(runtime)
    renameCustomer('只属于甲租户的客户')
    setContext('只属于甲租户的内容')
    view.unmount()
    const next = await startPage(runtime)
    expect((screen.getByLabelText('客户会话上下文') as HTMLTextAreaElement).value).toBe('只属于甲租户的内容')
    next.rerender(<AssistantPage principalId="seat_a" runtime={runtime} tenantId="tenant_b" />)
    await screen.findByText('企业默认 · test · 企业模型')
    expect((screen.getByLabelText('客户会话上下文') as HTMLTextAreaElement).value).toBe('')
    expect(screen.queryByText('只属于甲租户的客户')).toBeNull()
  })

  it('finds a customer in a hundred independent workspaces without changing the active target', async () => {
    const runtime = makeRuntime()
    const workspace = assistantSessionFor(runtime, 'tenant_a', 'seat_a').customerReply

    for (let i = 1; i < 100; i += 1) {
      addCustomerReply(workspace)
    }

    await startPage(runtime)
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索客户备注或编号' }), { target: { value: '客户 42' } })
    const target = screen.getByRole('button', { name: /客户 42.*待处理/ })
    expect(screen.queryByRole('button', { name: /客户 41.*待处理/ })).toBeNull()
    expect((screen.getByLabelText('客户备注（仅用于区分工作区）') as HTMLInputElement).value).toBe('客户 100')
    fireEvent.click(target)
    expect((screen.getByLabelText('客户备注（仅用于区分工作区）') as HTMLInputElement).value).toBe('客户 42')
  })
})

describe('customer reply queue', () => {
  it('bounds a hundred requests, routes each result independently, and never replays a completed call', async () => {
    const workspace = createCustomerReplyWorkspace()

    for (let i = 1; i < 100; i += 1) {
      addCustomerReply(workspace)
    }

    let inFlight = 0
    let peak = 0

    const post = vi.fn(async (_path: string, body: unknown) => {
      const content = (body as { content: string }).content
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await Promise.resolve()
      inFlight -= 1

      return { text: content.split('【本次客户会话】\n')[1], knowledge_grounded: true }
    })

    const runtime = makeRuntime(post)
    await Promise.all(
      workspace.get().customers.map((customer, i) => {
        updateCustomerReplyInput(customer.reply, 'context', `唯一客户问题 ${i}`)

        return generateCustomerReply(workspace, customer.reply, runtime)
      })
    )
    expect(peak).toBeGreaterThan(1)
    expect(peak).toBeLessThanOrEqual(3)
    expect(post).toHaveBeenCalledTimes(100)
    workspace.get().customers.forEach((customer, i) => {
      expect(customer.reply.get().draft).toBe(`唯一客户问题 ${i}`)
      expect(customer.reply.get().requestId).toBeNull()
    })
  })

  it('discards closed customer replies and stops queued work when authentication ends', async () => {
    const first = deferred()
    const post = vi.fn(() => first.promise)
    const runtime = makeRuntime(post)
    const workspace = assistantSessionFor(runtime, 'tenant_a', 'seat_a').customerReply

    for (let i = 1; i < 5; i += 1) {
      addCustomerReply(workspace)
    }

    const customers = workspace.get().customers

    const pending = customers.map(customer => {
      updateCustomerReplyInput(customer.reply, 'context', customer.label)

      return generateCustomerReply(workspace, customer.reply, runtime)
    })

    expect(post).toHaveBeenCalledTimes(3)
    expect(customers[3].reply.get().phase).toBe('queued')
    closeCustomerReply(workspace, customers[0].id)
    releaseAssistantSession(runtime)
    first.resolve({ text: '已失效的旧答复', knowledge_grounded: true })
    await Promise.all(pending)
    expect(post).toHaveBeenCalledTimes(3)
    expect(customers.every(customer => customer.reply.get().draft === '')).toBe(true)
    expect(customers.every(customer => customer.reply.get().context === '')).toBe(true)
  })

  it('preserves failed input for retry and rejects oversize requests without truncation', async () => {
    const workspace = createCustomerReplyWorkspace()
    const store = workspace.get().customers[0].reply

    const post = vi
      .fn()
      .mockRejectedValueOnce(new Error('模型暂不可用'))
      .mockResolvedValue({ text: '恢复后的建议', knowledge_grounded: true })

    const runtime = makeRuntime(post)
    updateCustomerReplyInput(store, 'context', '客户的完整退款问题')
    await generateCustomerReply(workspace, store, runtime)
    expect(store.get().context).toBe('客户的完整退款问题')
    expect(store.get().error).toBe('模型暂不可用')
    await generateCustomerReply(workspace, store, runtime)
    expect(store.get().draft).toBe('恢复后的建议')
    updateCustomerReplyInput(store, 'context', '文'.repeat(24_001))
    await generateCustomerReply(workspace, store, runtime)
    expect(post).toHaveBeenCalledTimes(2)
    expect(store.get().error).toContain('24000')
    expect(store.get().context).toHaveLength(24_001)
  })
})
