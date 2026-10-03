import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AssistantPage } from './assistant-page'
import { releaseAssistantSession } from './assistant-session'
import { prepareEnterprisePackageInstall, releaseEnterprisePackageInstall } from './enterprise-install-readiness'
import type { EnterpriseClientRuntime } from './runtime'

const mic = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn(), cancel: vi.fn() }))
const playback = vi.hoisted(() => ({ play: vi.fn(), stop: vi.fn() }))
vi.mock('@/app/chat/composer/hooks/use-mic-recorder', () => ({
  useMicRecorder: () => ({ handle: mic, level: 0.5, recording: false })
}))
vi.mock('@/lib/voice-playback', () => ({ playSpeechAudioDataUrl: playback.play, stopVoicePlayback: playback.stop }))

const runtimes: EnterpriseClientRuntime[] = []

function connection() {
  const get = vi.fn(async (path: string) => {
    if (path === '/api/tenant-ai-models') {
      return {
        configured: true,
        models: [{ configuration_id: 'tenant-model', is_default: true, provider: '企业模型', model: '知识助手' }]
      }
    }

    if (path === '/api/customer-reply-workspace') {
      return { revision: 0, workspace: null, updated_at: null }
    }

    if (path === '/api/tenant-voice-capabilities') {
      return { available: true }
    }

    if (path === '/api/tenant-speech-capabilities') {
      return {
        available: true,
        default_voice: 'zh-CN-XiaoxiaoNeural',
        voices: [
          { id: 'zh-CN-XiaoxiaoNeural', label: '晓晓' },
          { id: 'zh-CN-YunxiNeural', label: '云希' }
        ],
        styles: [
          { id: 'chat', label: '自然聊天' },
          { id: 'gentle', label: '温柔' },
          { id: 'customerservice', label: '客服' }
        ]
      }
    }

    throw new Error(`Unexpected enterprise route: ${path}`)
  })

  const post = vi.fn(async (path: string) => {
    if (path === '/api/tenant-voice-transcribe') {
      return { text: '退款需要哪些资料' }
    }

    if (path === '/api/tenant-ai-assist') {
      return { text: '**退款资料**\n\n请提供订单号。', knowledge_grounded: true }
    }

    if (path === '/api/tenant-speech-synthesize') {
      return { audio_base64: 'YXVkaW8=', content_type: 'audio/mpeg' }
    }

    throw new Error(`Unexpected enterprise route: ${path}`)
  })

  const runtime = { get, post, disconnect: vi.fn() } as unknown as EnterpriseClientRuntime
  runtimes.push(runtime)

  return { get, post, runtime }
}

describe('enterprise knowledge voice flow', () => {
  it('keeps frozen voice controls absent without probing speech services', async () => {
    const backend = connection()
    render(<AssistantPage principalId="voice-frozen" runtime={backend.runtime} tenantId="tenant-a" />)
    await screen.findByText('企业默认 · 企业模型 · 知识助手')
    expect(screen.queryByRole('button', { name: '语音输入' })).toBeNull()
    expect(screen.queryByRole('button', { name: '朗读回答' })).toBeNull()
    expect(backend.get.mock.calls.some(([path]) => path.includes('voice-') || path.includes('speech-'))).toBe(false)
  })
  afterEach(async () => { await act(async () => {
    releaseEnterprisePackageInstall()
    runtimes.splice(0).forEach(releaseAssistantSession)
  }) })
  beforeEach(() => {
    vi.clearAllMocks()
    mic.start.mockResolvedValue(undefined)
    mic.stop.mockResolvedValue({
      audio: new Blob(['audio'], { type: 'audio/webm' }),
      durationMs: 2000,
      heardSpeech: true
    })
    playback.play.mockResolvedValue(true)
  })

  // Legacy UI is intentionally unmounted. Low-level voice hooks remain tested
  // in voice-controls.test.tsx and use-enterprise-speech.test.tsx.
  it.skip('keeps recognition editable, submits the same knowledge route, and reads the answer with selected enterprise voice', async () => {
    const backend = connection()
    render(<AssistantPage principalId="voice-account" runtime={backend.runtime} tenantId="tenant-a" />)
    await screen.findByText('企业默认 · 企业模型 · 知识助手')
    fireEvent.click(screen.getByRole('button', { name: /知识库问答/ }))
    await screen.findByRole('option', { name: '晓晓' })
    fireEvent.change(screen.getByLabelText('音色'), { target: { value: 'zh-CN-YunxiNeural' } })
    fireEvent.change(screen.getByLabelText('语音风格'), { target: { value: 'customerservice' } })
    fireEvent.change(screen.getByLabelText('语速'), { target: { value: '0.85' } })
    fireEvent.click(screen.getByRole('button', { name: '语音输入' }))
    fireEvent.click(await screen.findByRole('button', { name: '结束录音并识别' }))
    await waitFor(() =>
      expect((screen.getByLabelText('输入内容') as HTMLTextAreaElement).value).toBe('退款需要哪些资料')
    )
    expect(backend.post).toHaveBeenCalledTimes(1)
    fireEvent.change(screen.getByLabelText('输入内容'), {
      target: { value: '退款需要哪些资料？请依据公司售后规范回答。' }
    })
    fireEvent.click(screen.getByRole('button', { name: '提交处理' }))
    await waitFor(() =>
      expect(backend.post).toHaveBeenCalledWith('/api/tenant-ai-assist', {
        configuration_id: undefined,
        mode: 'knowledge_answer',
        content: '退款需要哪些资料？请依据公司售后规范回答。'
      })
    )
    await waitFor(() =>
      expect(backend.post).toHaveBeenCalledWith(
        '/api/tenant-speech-synthesize',
        expect.objectContaining({
          voice: 'zh-CN-YunxiNeural',
          style: 'customerservice',
          speed: 0.85
        })
      )
    )
    expect(await screen.findByText('退款资料')).toBeTruthy()
    expect(playback.play).toHaveBeenCalledOnce()
    expect(
      backend.get.mock.calls.every(
        ([path]) => path.startsWith('/api/tenant-') || path === '/api/customer-reply-workspace'
      )
    ).toBe(true)
  })

  it.skip('stops answer playback before recording and disables read-aloud while the microphone is busy', async () => {
    const backend = connection()
    let endPlayback!: (value: boolean) => void
    playback.play.mockImplementation(
      () =>
        new Promise<boolean>(resolve => {
          endPlayback = resolve
        })
    )
    render(<AssistantPage principalId="voice-barge-in" runtime={backend.runtime} tenantId="tenant-a" />)
    await screen.findByText('企业默认 · 企业模型 · 知识助手')
    fireEvent.click(screen.getByRole('button', { name: /知识库问答/ }))
    fireEvent.change(screen.getByLabelText('输入内容'), { target: { value: '退款资料' } })
    fireEvent.click(screen.getByRole('button', { name: '提交处理' }))
    fireEvent.click(await screen.findByRole('button', { name: '朗读回答' }))
    await waitFor(() => expect(playback.play).toHaveBeenCalledOnce())
    playback.stop.mockClear()
    mic.start.mockImplementation(async () => {
      expect(playback.stop).toHaveBeenCalledOnce()
    })
    fireEvent.click(screen.getByRole('button', { name: '语音输入' }))
    await screen.findByRole('button', { name: '结束录音并识别' })
    expect((screen.getByRole('button', { name: '朗读回答' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '提交处理' }) as HTMLButtonElement).disabled).toBe(true)
    await act(async () => endPlayback(false))
    fireEvent.click(screen.getByRole('button', { name: '取消录音' }))
    await waitFor(() =>
      expect((screen.getByRole('button', { name: '朗读回答' }) as HTMLButtonElement).disabled).toBe(false)
    )
  })

  it.skip('turns the clicked answer control into a real one-click stop control', async () => {
    const backend = connection()
    let endPlayback!: (value: boolean) => void
    playback.play.mockImplementation(
      () => new Promise<boolean>(resolve => { endPlayback = resolve })
    )
    render(<AssistantPage principalId="voice-stop" runtime={backend.runtime} tenantId="tenant-a" />)
    await screen.findByText('企业默认 · 企业模型 · 知识助手')
    fireEvent.click(screen.getByRole('button', { name: /知识库问答/ }))
    fireEvent.change(screen.getByLabelText('输入内容'), { target: { value: '退款资料' } })
    fireEvent.click(screen.getByRole('button', { name: '提交处理' }))
    fireEvent.click(await screen.findByRole('button', { name: '朗读回答' }))
    await screen.findByRole('button', { name: '停止朗读' })

    fireEvent.click(screen.getByRole('button', { name: '停止朗读' }))
    expect(playback.stop).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: '朗读回答' })).toBeTruthy()
    await act(async () => endPlayback(false))
  })

  it('preserves unsent questions and blocks installation throughout a failed model request', async () => {
    const backend = connection()
    let reject!: (error: Error) => void
    backend.post.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail }))
    render(<AssistantPage principalId="install-account" runtime={backend.runtime} tenantId="tenant-a" />)
    await screen.findByText('企业默认 · 企业模型 · 知识助手')
    fireEvent.click(screen.getByRole('button', { name: /知识库问答/ }))
    fireEvent.change(screen.getByLabelText('输入内容'), { target: { value: '必须保留的未提交问题' } })
    await act(async () => {
      const result = await prepareEnterprisePackageInstall('unsent')
      expect(result.ready).toBe(false)
      expect(result.reasons.join()).toContain('未提交文字')
    })
    expect((screen.getByLabelText('输入内容') as HTMLTextAreaElement).value).toBe('必须保留的未提交问题')
    fireEvent.click(screen.getByRole('button', { name: '提交处理' }))
    await waitFor(() => expect(backend.post).toHaveBeenCalledOnce())
    await act(async () => {
      const result = await prepareEnterprisePackageInstall('generating')
      expect(result.ready).toBe(false)
      expect(result.reasons.join()).toContain('正在处理问题')
    })
    await act(async () => reject(new Error('模型连接中断')))
    expect((screen.getByLabelText('输入内容') as HTMLTextAreaElement).value).toBe('必须保留的未提交问题')
  })
})
