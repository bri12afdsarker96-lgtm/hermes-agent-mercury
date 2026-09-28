import { act, fireEvent, render as renderView, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { I18nProvider } from '@/i18n/context'
import { describe, expect, it, vi } from 'vitest'

import { AssistantPage } from './assistant-page'
import type { EnterpriseClientRuntime } from './runtime'

function render(ui: ReactNode) {
  return renderView(ui, { wrapper: ({ children }) => <I18nProvider initialLocale="zh" configClient={null}>{children}</I18nProvider> })
}

describe('AssistantPage', () => {
  const pool = {
    configured: true,
    models: [{ configuration_id: 'default', is_default: true, model: 'test-model', provider: 'test' }]
  }
  const personaPool = {
    personas: [{ description: '企业统一对话规范', is_default: true, name: '企业客服顾问', persona_id: 'persona_default_1234' }]
  }

  function deferredReply() {
    let resolve!: (value: { text: string }) => void
    const promise = new Promise<{ text: string }>(done => { resolve = done })

    return { promise, resolve }
  }

  function runtimeFor(post = vi.fn(async () => ({ text: '已完成' }))) {
    return {
      disconnect: vi.fn(async () => undefined),
      get: vi.fn(async (path: string) => path === '/api/customer-reply-workspace'
        ? { revision: 0, workspace: null, updated_at: null }
        : path === '/api/tenant-ai-personas' ? personaPool : pool) as unknown as EnterpriseClientRuntime['get'],
      post: post as unknown as NonNullable<EnterpriseClientRuntime['post']>
    }
  }

  it('does not show a previous account response after identity changes during a request', async () => {
    const reply = deferredReply()
    const post = vi.fn(() => reply.promise)
    const runtime = runtimeFor(post)
    const view = render(<AssistantPage principalId="first-account" runtime={runtime} />)
    await screen.findByText('企业默认 · test · test-model')
    fireEvent.click(screen.getByRole('button', { name: /企业对话/ }))
    fireEvent.change(screen.getByLabelText('输入内容'), { target: { value: '第一家企业的业务问题' } })
    fireEvent.click(screen.getByRole('button', { name: '提交处理' }))
    await waitFor(() => expect(post).toHaveBeenCalled())

    view.rerender(<AssistantPage principalId="second-account" runtime={runtime} />)
    await act(async () => { reply.resolve({ text: '第一家企业的保密答案' }) })

    expect(screen.queryByText('第一家企业的保密答案')).toBeNull()
    expect(screen.queryByText('第一家企业的业务问题')).toBeNull()
    expect((screen.getByLabelText('输入内容') as HTMLTextAreaElement).disabled).toBe(false)
  })

  it('starts with an empty transcript for a new authenticated session using the same principal id', async () => {
    const view = render(<AssistantPage principalId="same-account" runtime={runtimeFor()} />)
    await screen.findByText('企业默认 · test · test-model')
    fireEvent.click(screen.getByRole('button', { name: /企业对话/ }))
    fireEvent.change(screen.getByLabelText('输入内容'), { target: { value: '上次登录的私密内容' } })
    fireEvent.click(screen.getByRole('button', { name: '提交处理' }))
    await screen.findByText('已完成')

    view.rerender(<AssistantPage principalId="same-account" runtime={runtimeFor()} />)
    await screen.findByText('企业默认 · test · test-model')

    expect(screen.queryByText('上次登录的私密内容')).toBeNull()
    expect(screen.queryByText('已完成')).toBeNull()
  })

  it('uses a server-owned tenant model pool instead of the generic Hermes runtime', async () => {
    const modelPool = {
      configured: true,
      default_model_id: 'model_default',
      models: [
        { configuration_id: 'model_default', is_default: true, model: 'deepseek-chat', provider: 'deepseek' },
        { configuration_id: 'model_fast', is_default: false, model: 'gpt-4.1-mini', provider: 'openai' }
      ]
    }

    const reply = {
      configuration_id: 'model_default', knowledge_grounded: false,
      model: 'deepseek-chat', provider: 'deepseek', text: '已完成文本摘要。'
    }

    const get = vi.fn(async (path: string) => path === '/api/tenant-ai-personas' ? personaPool : modelPool)
    const post = vi.fn(async () => reply)

    const runtime: EnterpriseClientRuntime = {
      disconnect: vi.fn(async () => undefined),
      get: get as unknown as EnterpriseClientRuntime['get'],
      post: post as unknown as NonNullable<EnterpriseClientRuntime['post']>
    }

    render(<AssistantPage principalId="operator_a" runtime={runtime} />)

    expect(await screen.findByText('企业默认 · deepseek · deepseek-chat')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /文本摘要/ }))
    fireEvent.change(screen.getByLabelText('输入内容'), { target: { value: '会议记录需要整理' } })
    fireEvent.click(screen.getByRole('button', { name: '提交处理' }))

    await waitFor(() => {
      expect(post).toHaveBeenCalledWith('/api/tenant-ai-assist', {
        configuration_id: undefined,
        content: '会议记录需要整理',
        mode: 'summarize',
        persona_id: 'persona_default_1234'
      })
    })
    expect(await screen.findByText('已完成文本摘要。')).toBeTruthy()
  })

  it('only reads an explicitly selected local text file and keeps it out of visible transcript', async () => {
    const modelPool = {
      configured: true,
      default_model_id: 'model_default',
      models: [{ configuration_id: 'model_default', is_default: true, model: 'deepseek-chat', provider: 'deepseek' }]
    }

    const reply = {
      configuration_id: 'model_default', knowledge_grounded: false,
      model: 'deepseek-chat', provider: 'deepseek', text: '文件已处理。'
    }

    const get = vi.fn(async (path: string) => path === '/api/tenant-ai-personas' ? personaPool : modelPool)
    const post = vi.fn(async () => reply)

    const runtime: EnterpriseClientRuntime = {
      disconnect: vi.fn(async () => undefined),
      get: get as unknown as EnterpriseClientRuntime['get'],
      post: post as unknown as NonNullable<EnterpriseClientRuntime['post']>
    }

    render(<AssistantPage principalId="operator_b" runtime={runtime} />)
    await screen.findByText('企业默认 · deepseek · deepseek-chat')
    fireEvent.click(screen.getByRole('button', { name: /企业对话/ }))
    const input = screen.getByLabelText('选择本地文本文件') as HTMLInputElement
    const file = new File(['敏感工作文本'], 'notes.txt', { type: 'text/plain' })
    fireEvent.change(input, { target: { files: [file] } })
    expect(await screen.findByText('已选择：notes.txt')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '提交处理' }))

    await waitFor(() => {
      expect(post).toHaveBeenCalledWith('/api/tenant-ai-assist', expect.objectContaining({
        content: expect.stringContaining('敏感工作文本'),
        mode: 'summarize'
      }))
    })
    expect(screen.queryByText('敏感工作文本')).toBeNull()
    expect(await screen.findByText(/处理所选本地文本/)).toBeTruthy()
  })

  it('uses only a server-returned persona id in the AI request', async () => {
    const get = vi.fn(async (path: string) => path === '/api/tenant-ai-personas'
      ? { personas: [
        { description: '默认处理规范', is_default: true, name: '企业客服顾问', persona_id: 'persona_default_1234' },
        { description: '售后', is_default: false, name: '售后顾问', persona_id: 'persona_support_1234' }
      ] }
      : pool)
    const post = vi.fn(async () => ({ text: '已完成' }))
    const runtime: EnterpriseClientRuntime = {
      disconnect: vi.fn(async () => undefined),
      get: get as unknown as EnterpriseClientRuntime['get'],
      post: post as unknown as NonNullable<EnterpriseClientRuntime['post']>
    }

    render(<AssistantPage principalId="operator_persona" runtime={runtime} />)
    await screen.findByText('企业默认 · test · test-model')
    fireEvent.change(screen.getByLabelText('当前人设'), { target: { value: 'persona_support_1234' } })
    fireEvent.click(screen.getByRole('button', { name: /企业对话/ }))
    fireEvent.change(screen.getByLabelText('输入内容'), { target: { value: '售后怎么处理' } })
    fireEvent.click(screen.getByRole('button', { name: '提交处理' }))

    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/tenant-ai-assist', expect.objectContaining({
      persona_id: 'persona_support_1234'
    })))
  })

  it('keeps the composer available when an administrator has not created a persona', async () => {
    const get = vi.fn(async (path: string) => path === '/api/tenant-ai-personas' ? { personas: [] } : pool)
    const post = vi.fn(async () => ({ text: '已完成' }))
    const runtime: EnterpriseClientRuntime = {
      disconnect: vi.fn(async () => undefined),
      get: get as unknown as EnterpriseClientRuntime['get'],
      post: post as unknown as NonNullable<EnterpriseClientRuntime['post']>
    }

    render(<AssistantPage principalId="operator_no_persona" runtime={runtime} />)
    await screen.findByText('企业默认 · test · test-model')
    fireEvent.click(screen.getByRole('button', { name: /企业对话/ }))

    expect((screen.getByLabelText('输入内容') as HTMLTextAreaElement).disabled).toBe(false)
    fireEvent.change(screen.getByLabelText('输入内容'), { target: { value: '未配置人设时也能提问吗？' } })
    fireEvent.click(screen.getByRole('button', { name: '提交处理' }))
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/tenant-ai-assist', expect.objectContaining({
      persona_id: undefined
    })))
  })

  it('provides new and renamed chat records in the separated enterprise workspace', async () => {
    render(<AssistantPage principalId="operator_history" runtime={runtimeFor()} separatedNavigation />)
    await screen.findByText('企业默认 · test-model')

    fireEvent.change(screen.getByLabelText('输入内容'), { target: { value: '如何核对退款？' } })
    fireEvent.click(screen.getByRole('button', { name: '提交处理' }))
    expect((await screen.findAllByText('如何核对退款？')).length).toBeGreaterThan(1)

    fireEvent.click(screen.getByRole('button', { name: '＋ 新建对话' }))
    expect(await screen.findByText('尚未开始')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: /打开.*操作/ })[0]!)
    fireEvent.click(screen.getByRole('menuitem', { name: '重命名' }))
    fireEvent.change(screen.getByLabelText('对话名称'), { target: { value: '退款核查规则' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByText('退款核查规则')).toBeTruthy()
  })

  it('shows the completed tenant-knowledge tool step as metadata without copying it into the answer', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const post = vi.fn(async () => ({
      agent_trace: [{
        best_similarity: 0.913,
        candidate_count: 18,
        result_count: 2,
        similarity_threshold: 0.822,
        status: 'completed',
        tool: 'enterprise_knowledge.search'
      }],
      knowledge_grounded: true,
      text: '根据企业已发布的售后流程，退款需要先核验订单。'
    }))

    render(<AssistantPage principalId="operator_agent" runtime={runtimeFor(post)} />)
    await screen.findByText('企业默认 · test · test-model')
    fireEvent.click(screen.getByRole('button', { name: /企业对话/ }))
    fireEvent.change(screen.getByLabelText('输入内容'), { target: { value: '退款流程是什么？' } })
    fireEvent.click(screen.getByRole('button', { name: '提交处理' }))

    expect(await screen.findByText(/质量筛选后命中 2 条资料 · 阈值 ≥ 0.822 · 最高相似度 0.913 · 已比较 18 条已授权候选。/)).toBeTruthy()
    expect(await screen.findByText('根据企业已发布的售后流程，退款需要先核验订单。')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Markdown/ })).toBeNull()
    fireEvent.click(within(screen.getByRole('region', { name: '回答建议' })).getByRole('button', { name: '点击复制' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('根据企业已发布的售后流程，退款需要先核验订单。'))
    expect(writeText).not.toHaveBeenCalledWith(expect.stringContaining('企业知识检索'))
  })

  it('renders the current server answer contract, including its summary and safe reply alternatives', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const post = vi.fn(async () => ({
      answer_text: '请先核验订单号和包装照片，再确认后续处理方案。',
      customer_reply_options: [
        { kind: 'current_reply', text: '您好，已收到反馈，正在核验订单。' },
        { kind: 'follow_up', text: '核验完成后会第一时间向您说明处理结果。' },
        { kind: 'alternative_reply', text: '如方便，请补充订单号和异常照片。' }
      ],
      knowledge_grounded: true,
      reasoning_summary: '已结合当前问题和企业知识梳理核验顺序。',
      retrieval_meta: {
        best_similarity: 0.913,
        candidate_count: 18,
        matched_count: 2,
        similarity_threshold: 0.822,
        status: 'hit'
      },
      text: '旧兼容文本，不应优先显示。'
    }))

    render(<AssistantPage principalId="operator_structured" runtime={runtimeFor(post)} />)
    await screen.findByText('企业默认 · test · test-model')
    fireEvent.click(screen.getByRole('button', { name: /企业对话/ }))
    fireEvent.change(screen.getByLabelText('输入内容'), { target: { value: '海鲜有异味怎么办？' } })
    fireEvent.click(screen.getByRole('button', { name: '提交处理' }))

    expect(await screen.findByRole('region', { name: '企业知识检索（本次）' })).toBeTruthy()
    expect(await screen.findByText(/质量筛选后命中 2 条资料 · 阈值 ≥ 0.822 · 最高相似度 0.913 · 已比较 18 条已授权候选。/)).toBeTruthy()
    expect((await screen.findByRole('region', { name: '本次处理摘要' })).textContent).toContain('已结合当前问题和企业知识梳理核验顺序。')
    expect(await screen.findByText('请先核验订单号和包装照片，再确认后续处理方案。')).toBeTruthy()
    expect(screen.queryByText('旧兼容文本，不应优先显示。')).toBeNull()
    expect(screen.getByText('当前回复话术')).toBeTruthy()
    expect(screen.getByText('继续跟进话术')).toBeTruthy()
    expect(screen.getByText('备选回答')).toBeTruthy()
    fireEvent.click(within(screen.getByRole('region', { name: '继续跟进话术' })).getByRole('button', { name: '点击复制' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('核验完成后会第一时间向您说明处理结果。'))
  })

  it('hides frozen voice input controls in enterprise chat and customer reply', async () => {
    render(<AssistantPage principalId="operator_voice_frozen" runtime={runtimeFor()} />)
    await screen.findByText('企业默认 · test · test-model')

    expect(screen.queryByRole('button', { name: '语音输入' })).toBeNull()
    expect(screen.queryByText('语音提问后自动朗读回答')).toBeNull()
    expect(screen.queryByLabelText('音色')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /客户回复建议/ }))
    expect(screen.queryByRole('button', { name: '语音输入' })).toBeNull()
  })
})
