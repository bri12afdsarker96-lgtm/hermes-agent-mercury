import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AssistantPage } from './assistant-page'
import { assistantSessionFor, releaseAssistantSession } from './assistant-session'
import {
  addCustomerReply,
  closeCustomerReply,
  confirmCustomerMemory,
  createCustomerReplyWorkspace,
  type CustomerReplyWorkspaceStore,
  generateCustomerReply,
  updateCustomerMemoryDraft,
  updateCustomerReplyInput
} from './customer-reply'
import { customerDraftSyncFor, startCustomerDraftSync, stopCustomerDraftSync } from './customer-reply-persistence'
import { updateCustomerReplyPreferences } from './enterprise-reply-preferences'
import type { EnterpriseClientRuntime } from './runtime'
import { enterpriseClientErrorForStatus } from './runtime-errors'

interface Reply {
  text: string
  knowledge_grounded: boolean
}

it('keeps customer A unknown without clearing it when concurrent customer B succeeds', async () => {
  const choice = { backend_id: 'tenant_model' as const, configuration_id: 'first', configuration_version: 3,
    model: 'model', runtime_protocol: 'openai_chat_completions', reasoning_effort: null, availability: 'available' as const }
  let reject!: (error: Error) => void
  const pending = new Promise<Reply>((_resolve, failed) => {reject = failed})
  const post = vi.fn(async (_path: string, body: unknown) => (body as { configuration_id: string }).configuration_id === 'first'
    ? pending : { text: 'B 的审核建议', knowledge_grounded: true, backend_choice: { ...choice, configuration_id: 'second' } })
  const runtime = makeRuntime(post)
  const workspace = createCustomerReplyWorkspace()
  await startWorkspace(workspace, runtime)
  const first = workspace.get().customers[0]!
  updateCustomerReplyInput(first.reply, 'context', '客户 A')
  const requestA = generateCustomerReply(workspace, first.reply, runtime, undefined, choice, true)
  await waitFor(() => expect(post).toHaveBeenCalledOnce())
  addCustomerReply(workspace)
  const second = workspace.get().customers[1]!
  updateCustomerReplyInput(second.reply, 'context', '客户 B')
  await generateCustomerReply(workspace, second.reply, runtime, undefined, { ...choice, configuration_id: 'second' }, true)
  expect(first.reply.get().outcomeUnknown).toBe(true)
  expect(second.reply.get().outcomeUnknown).toBe(false)
  reject(new Error('private provider token'))
  await requestA
  expect(first.reply.get().error).toContain('结果未确认')
  expect(first.reply.get().error).not.toContain('private')
  await generateCustomerReply(workspace, first.reply, runtime, undefined, choice, true)
  expect(post).toHaveBeenCalledTimes(2)
  await generateCustomerReply(workspace, second.reply, runtime, undefined, { ...choice, configuration_id: 'changed' }, true)
  expect(second.reply.get().error).toContain('模型配置已变化')
  expect(post).toHaveBeenCalledTimes(2)
})

it('rejects a customer response that does not match the captured model choice', async () => {
  const choice = { backend_id: 'tenant_model' as const, configuration_id: 'owned', configuration_version: 1,
    model: 'model', runtime_protocol: 'openai_chat_completions', reasoning_effort: null, availability: 'available' as const }
  const runtime = makeRuntime(vi.fn(async () => ({ text: '不可信结果', knowledge_grounded: true, backend_choice: { ...choice, configuration_id: 'foreign' } })))
  const workspace = createCustomerReplyWorkspace()
  await startWorkspace(workspace, runtime)
  const customer = workspace.get().customers[0]!
  updateCustomerReplyInput(customer.reply, 'context', '退款条件')
  await generateCustomerReply(workspace, customer.reply, runtime, undefined, choice, true)
  expect(customer.reply.get().outcomeUnknown).toBe(true)
  expect(customer.reply.get().draft).toBe('')
  expect(customer.reply.get().backendChoice?.configuration_id).toBe(choice.configuration_id)
})

const testRuntimes: EnterpriseClientRuntime[] = []
const directWorkspaces: CustomerReplyWorkspaceStore[] = []

async function startWorkspace(workspace: CustomerReplyWorkspaceStore, runtime: EnterpriseClientRuntime) {
  directWorkspaces.push(workspace)
  startCustomerDraftSync(workspace, runtime)
  await waitFor(() => expect(customerDraftSyncFor(workspace).get().loaded).toBe(true))
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
  const runtime = {
    disconnect: vi.fn(async () => undefined),
    get: vi.fn(async (path: string) =>
      path === '/api/customer-reply-workspace'
        ? { revision: 0, workspace: null, updated_at: null }
        : path === '/api/tenant-voice-capabilities'
          ? { available: false, reason: '测试未启用录音' }
          : {
              configured: true,
              models: [
                { configuration_id: 'default', is_default: true, model: '企业模型', provider: 'test' },
                { configuration_id: 'fast', is_default: false, model: '快速模型', provider: 'test' }
              ]
            }
    ) as unknown as EnterpriseClientRuntime['get'],
    post: ((path: string, body: unknown) =>
      path === '/api/customer-reply-workspace'
        ? Promise.resolve({
            revision: (body as { expected_revision: number }).expected_revision + 1,
            workspace: (body as { workspace: unknown }).workspace,
            updated_at: 1
          })
        : post(path, body)) as unknown as NonNullable<EnterpriseClientRuntime['post']>
  }

  testRuntimes.push(runtime)

  return runtime
}

async function startPage(runtime: EnterpriseClientRuntime) {
  const view = render(<AssistantPage principalId="seat_a" runtime={runtime} tenantId="tenant_a" />)
  await screen.findByText('企业默认 · test · 企业模型')
  fireEvent.click(screen.getByRole('button', { name: /客户回复建议/ }))
  await waitFor(() => expect(screen.getByRole('button', { name: '新增客户' }).hasAttribute('disabled')).toBe(false))

  return view
}

function setContext(text: string) {
  fireEvent.change(screen.getByLabelText('客户会话上下文'), { target: { value: text } })
}

function renameCustomer(text: string) {
  fireEvent.change(screen.getByLabelText('客户备注（仅用于区分工作区）'), { target: { value: text } })
}

afterEach(async () => {
  await act(async () => {
    testRuntimes.forEach(releaseAssistantSession)
    testRuntimes.length = 0
    directWorkspaces.forEach(stopCustomerDraftSync)
    directWorkspaces.length = 0
  })
  vi.restoreAllMocks()
})

describe('customer reply workspaces', () => {
  // Staged learning contracts are retained while this delivery is user-frozen.
  it.skip('keeps memory edits with their customer, confirms them explicitly, and leaves another customer usable', async () => {
    const post = vi.fn(async () => ({ text: '企业发布原文', knowledge_grounded: true }))
    const runtime = makeRuntime(post)
    await startPage(runtime)
    setContext('客户甲问题')
    fireEvent.change(screen.getByLabelText('此客户的参考记忆'), { target: { value: '甲客户私人偏好' } })
    expect((screen.getByRole('button', { name: '生成回复建议' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '新增客户' }))
    setContext('客户乙问题')
    expect((screen.getByLabelText('此客户的参考记忆') as HTMLTextAreaElement).value).toBe('')
    fireEvent.click(screen.getByRole('button', { name: '生成回复建议' }))
    await screen.findByLabelText('待审核回复（可修改）')
    expect(JSON.stringify(post.mock.calls)).not.toContain('甲客户私人偏好')
    fireEvent.click(screen.getByRole('button', { name: /客户 1.*待处理/ }))
    expect((screen.getByLabelText('此客户的参考记忆') as HTMLTextAreaElement).value).toBe('甲客户私人偏好')
    fireEvent.click(screen.getByRole('button', { name: '确认保存记忆' }))
    await screen.findByText('记忆已保存，仅作为此客户的参考资料。')
    fireEvent.change(screen.getByLabelText('回复语气'), { target: { value: 'warm' } })
    fireEvent.change(screen.getByLabelText('回复长度'), { target: { value: 'concise' } })
    fireEvent.click(screen.getByRole('button', { name: '生成回复建议' }))
    await screen.findByLabelText('待审核回复（可修改）')
    const lastCall = post.mock.calls.at(-1) as unknown as [string, Record<string, unknown>]
    expect(lastCall[1]).toMatchObject({ reply_preferences: { tone: 'warm', length: 'concise', address: 'nin' } })
    expect(JSON.stringify(lastCall[1])).not.toContain('甲客户私人偏好')
    fireEvent.click(screen.getByRole('button', { name: '删除已确认记忆' }))
    await screen.findByText('尚无已确认记忆。')
    expect(screen.queryByLabelText('待审核回复（可修改）')).toBeNull()
  })

  it('freezes all learning entry points while retaining ordinary customer replies and saved data', async () => {
    const post = vi.fn(async () => ({ text: '企业发布原文', knowledge_grounded: true }))
    const runtime = makeRuntime(post)
    const workspace = assistantSessionFor(runtime, 'tenant_a', 'seat_a').customerReply
    const customer = workspace.get().customers[0]
    const confirmation = '2026-09-06T00:00:00.000Z'
    customer.reply.set({ ...customer.reply.get(), memoryNote: '已有私有记忆', memoryConfirmedAt: confirmation, memoryDraft: '未确认的旧编辑', memoryPending: true })
    updateCustomerReplyPreferences(workspace, { tone: 'warm', length: 'detailed', address: 'ni' })
    await startPage(runtime)
    expect(screen.queryByLabelText('此客户的参考记忆')).toBeNull()
    expect(screen.queryByLabelText('回复语气')).toBeNull()
    expect(screen.queryByLabelText('回复长度')).toBeNull()
    expect(screen.queryByLabelText('回复称呼')).toBeNull()
    expect(screen.queryByLabelText('需要补充或纠正的问题')).toBeNull()
    setContext('冻结期间仍可处理客户问题')
    expect((screen.getByRole('button', { name: '生成回复建议' }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '生成回复建议' }))
    await screen.findByLabelText('待审核回复（可修改）')
    const request = post.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(request[1]).toMatchObject({ customer_id: customer.id, reply_preferences: { tone: 'professional', length: 'balanced', address: 'nin' } })
    expect(request[1].workspace_revision).toBeGreaterThan(0)
    expect(JSON.stringify(request[1])).not.toContain('私有记忆')
    expect(JSON.stringify(request[1])).not.toContain('旧编辑')
    expect(customer.reply.get()).toMatchObject({ memoryNote: '已有私有记忆', memoryConfirmedAt: confirmation, memoryDraft: '未确认的旧编辑' })
  })

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
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2))
    expect(post.mock.calls[0][1]).toMatchObject({ mode: 'knowledge_answer', configuration_id: 'default' })
    expect(post.mock.calls[0][1].content).toContain('客户甲：甲订单')
    expect(post.mock.calls[0][1].content).not.toContain('客户乙')
    expect(post.mock.calls[1][1]).toMatchObject({ mode: 'knowledge_answer', configuration_id: 'fast' })
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
    await act(async () => {})
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
    fireEvent.click(screen.getByRole('button', { name: /客户回复建议/ }))
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
    await act(async () => {})
    expect((screen.getByLabelText('客户备注（仅用于区分工作区）') as HTMLInputElement).value).toBe('客户 42')
  })
})

describe('customer reply queue', () => {
  it.skip('blocks only the pending confirmation customer and rejects a late reply after a memory edit', async () => {
    const response = deferred()
    const post = vi.fn(() => response.promise)
    const runtime = makeRuntime(post)
    const value = createCustomerReplyWorkspace()
    await startWorkspace(value, runtime)
    const first = value.get().customers[0]
    updateCustomerReplyInput(first.reply, 'context', '客户甲问题')
    first.reply.set({ ...first.reply.get(), memoryNote: '已点确认仍待保存', memoryDraft: '已点确认仍待保存', memoryConfirmedAt: new Date().toISOString(), memoryPending: true })
    await generateCustomerReply(value, first.reply, runtime)
    expect(post).not.toHaveBeenCalled()
    addCustomerReply(value)
    const second = value.get().customers[1]
    updateCustomerReplyInput(second.reply, 'context', '客户乙问题')
    const generated = generateCustomerReply(value, second.reply, runtime)
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
    updateCustomerMemoryDraft(second.reply, '生成途中新增但未确认的记忆')
    response.resolve({ text: '基于旧上下文的答复', knowledge_grounded: true })
    await generated
    expect(second.reply.get().draft).toBe('')
    expect(second.reply.get().memoryDraft).toBe('生成途中新增但未确认的记忆')
  })

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
    await startWorkspace(workspace, runtime)
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
    await startWorkspace(workspace, runtime)

    for (let i = 1; i < 5; i += 1) {
      addCustomerReply(workspace)
    }

    const customers = workspace.get().customers

    const pending = customers.map(customer => {
      updateCustomerReplyInput(customer.reply, 'context', customer.label)

      return generateCustomerReply(workspace, customer.reply, runtime)
    })

    await waitFor(() => expect(post).toHaveBeenCalledTimes(3))
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
      .mockRejectedValueOnce(enterpriseClientErrorForStatus(429))
      .mockResolvedValue({ text: '恢复后的建议', knowledge_grounded: true })

    const runtime = makeRuntime(post)
    await startWorkspace(workspace, runtime)
    updateCustomerReplyInput(store, 'context', '客户的完整退款问题')
    await generateCustomerReply(workspace, store, runtime)
    expect(store.get().context).toBe('客户的完整退款问题')
    expect(store.get().error).toContain('当前并发已满')
    await generateCustomerReply(workspace, store, runtime)
    expect(store.get().draft).toBe('恢复后的建议')
    updateCustomerReplyInput(store, 'context', '文'.repeat(24_001))
    await generateCustomerReply(workspace, store, runtime)
    expect(post).toHaveBeenCalledTimes(2)
    expect(store.get().error).toContain('24000')
    expect(store.get().context).toHaveLength(24_001)
  })

  it.skip('never submits edited or pending memory and sends only a saved customer reference', async () => {
    const post = vi.fn(async () => ({ text: '已发布原文', knowledge_grounded: true }))
    const runtime = makeRuntime(post)
    const workspace = createCustomerReplyWorkspace()
    await startWorkspace(workspace, runtime)
    const customer = workspace.get().customers[0]
    updateCustomerReplyInput(customer.reply, 'context', '当前客户的问题')
    updateCustomerMemoryDraft(customer.reply, '仅此客户的私有记忆')
    await generateCustomerReply(workspace, customer.reply, runtime)
    expect(post).not.toHaveBeenCalled()
    await confirmCustomerMemory(workspace, customer.reply)
    expect(customer.reply.get().memoryPending).toBe(false)
    await generateCustomerReply(workspace, customer.reply, runtime)
    expect(post).toHaveBeenCalledTimes(1)
    const request = post.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(request[1]).toMatchObject({ customer_id: customer.id, reply_preferences: { tone: 'professional', length: 'balanced', address: 'nin' } })
    expect(request[1].workspace_revision).toBeGreaterThan(0)
    expect(JSON.stringify(request[1])).not.toContain('私有记忆')
    expect(request[1]).not.toHaveProperty('memoryNote')
    expect(request[1]).not.toHaveProperty('knowledge_query')
  })
})
