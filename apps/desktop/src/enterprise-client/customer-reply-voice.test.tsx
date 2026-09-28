import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createCustomerReplyWorkspace,
  type CustomerReplyWorkspaceStore,
  updateCustomerReplyInput
} from './customer-reply'
import { CustomerReplyWorkspace } from './customer-reply-panel'
import { stopCustomerDraftSync } from './customer-reply-persistence'
import type { EnterpriseClientRuntime } from './runtime'

const mic = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn(), cancel: vi.fn() }))
vi.mock('@/app/chat/composer/hooks/use-mic-recorder', () => ({
  useMicRecorder: () => ({ handle: mic, level: 0.5, recording: false })
}))

const workspaces: CustomerReplyWorkspaceStore[] = []

async function setup(transcribe: () => Promise<{ text: string }>) {
  const workspace = createCustomerReplyWorkspace()
  workspaces.push(workspace)

  const runtime = {
    disconnect: vi.fn(),
    get: vi.fn(async (path: string) =>
      path === '/api/customer-reply-workspace'
        ? { revision: 0, workspace: null, updated_at: null }
        : { available: true, max_seconds: 120 }
    ),
    post: vi.fn(async (path: string, body: { expected_revision: number; workspace: unknown }) =>
      path === '/api/tenant-voice-transcribe'
        ? transcribe()
        : { revision: body.expected_revision + 1, workspace: body.workspace, updated_at: 1 }
    )
  } as unknown as EnterpriseClientRuntime

  render(<CustomerReplyWorkspace ready runtime={runtime} workspace={workspace} />)
  await screen.findByText('草稿将在修改后自动保存')
  await waitFor(() =>
    expect((screen.getByRole('button', { name: '语音输入' }) as HTMLButtonElement).disabled).toBe(false)
  )

  return { workspace, runtime }
}

beforeEach(() => {
  vi.clearAllMocks()
  mic.start.mockResolvedValue(undefined)
  mic.stop.mockResolvedValue({
    audio: new Blob(['audio'], { type: 'audio/webm' }),
    durationMs: 2000,
    heardSpeech: true
  })
})
afterEach(() => {
  workspaces.forEach(stopCustomerDraftSync)
  workspaces.length = 0
})

describe('customer voice context', () => {
  it('discards a late transcript on customer switch and prevents generation while recording', async () => {
    let resolve!: (result: { text: string }) => void

    const transcribe = vi.fn(
      () =>
        new Promise<{ text: string }>(done => {
          resolve = done
        })
    )

    const { workspace } = await setup(transcribe)
    fireEvent.change(screen.getByLabelText('客户会话上下文'), { target: { value: '客户甲原有上下文' } })
    const original = workspace.get().customers[0]
    fireEvent.click(screen.getByRole('button', { name: '语音输入' }))
    await screen.findByRole('button', { name: '结束录音并识别' })
    expect((screen.getByRole('button', { name: '生成回复建议' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '结束录音并识别' }))
    await waitFor(() => expect(transcribe).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: '新增客户' }))
    await act(async () => resolve({ text: '只属于客户甲的语音' }))
    expect((screen.getByLabelText('客户会话上下文') as HTMLTextAreaElement).value).toBe('')
    expect(original.reply.get().context).toBe('客户甲原有上下文')
    expect(mic.cancel).toHaveBeenCalled()
  })

  it('appends editable text only to the active customer and invalidates its old suggestion', async () => {
    const { workspace } = await setup(async () => ({ text: '补充询问退货条件' }))
    const reply = workspace.get().customers[0].reply
    act(() => {
      updateCustomerReplyInput(reply, 'context', '当前客户的原问题')
      reply.set({ ...reply.get(), draft: '旧建议', knowledgeGrounded: true })
    })
    fireEvent.click(screen.getByRole('button', { name: '语音输入' }))
    fireEvent.click(await screen.findByRole('button', { name: '结束录音并识别' }))
    await waitFor(() => expect(reply.get().context).toBe('当前客户的原问题\n补充询问退货条件'))
    expect(reply.get().draft).toBe('')
    expect(reply.get().knowledgeGrounded).toBeNull()
    expect(screen.queryByRole('button', { name: '复制当前客户回复' })).toBeNull()
  })
})
