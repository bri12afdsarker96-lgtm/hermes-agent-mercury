import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { AssistantPage } from './assistant-page'
import type { EnterpriseClientRuntime } from './runtime'

describe('AssistantPage', () => {
  const pool = {
    configured: true,
    models: [{ configuration_id: 'default', is_default: true, model: 'test-model', provider: 'test' }]
  }

  function deferredReply() {
    let resolve!: (value: { text: string }) => void
    const promise = new Promise<{ text: string }>(done => { resolve = done })

    return { promise, resolve }
  }

  function runtimeFor(post = vi.fn(async () => ({ text: '已完成' }))) {
    return {
      disconnect: vi.fn(async () => undefined),
      get: vi.fn(async () => pool) as unknown as EnterpriseClientRuntime['get'],
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
    expect((screen.getByLabelText('客户会话上下文') as HTMLTextAreaElement).disabled).toBe(false)
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

    const get = vi.fn(async () => modelPool)
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
        mode: 'summarize'
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

    const get = vi.fn(async () => modelPool)
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
})
