import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { prepareEnterprisePackageInstall, releaseEnterprisePackageInstall } from './enterprise-install-readiness'
import type { EnterpriseClientRuntime } from './runtime'
import { VoiceControls } from './voice-controls'

const mic = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn(), cancel: vi.fn() }))
vi.mock('@/app/chat/composer/hooks/use-mic-recorder', () => ({
  useMicRecorder: () => ({ handle: mic, level: 0.5, recording: false })
}))

function deferred<T>() {
  let resolve!: (value: T) => void

  const promise = new Promise<T>(done => {
    resolve = done
  })

  return { promise, resolve }
}

function runtime(post = vi.fn(async () => ({ text: '退款资料' }))) {
  return {
    disconnect: vi.fn(),
    get: vi.fn(async () => ({ available: true, max_seconds: 120 })),
    post
  } as unknown as EnterpriseClientRuntime
}

describe('enterprise voice scope', () => {
  afterEach(async () => { await act(async () => releaseEnterprisePackageInstall()) })
  beforeEach(() => {
    vi.clearAllMocks()
    mic.start.mockResolvedValue(undefined)
    mic.stop.mockResolvedValue({
      audio: new Blob(['audio'], { type: 'audio/webm' }),
      durationMs: 2000,
      heardSpeech: true
    })
  })

  it('uses only the authenticated relay and delivers editable text', async () => {
    const post = vi.fn(async () => ({ text: '退款资料' }))
    const transcript = vi.fn()
    render(<VoiceControls onTranscript={transcript} runtime={runtime(post)} scope="tenant-a/customer-a" />)
    await waitFor(() =>
      expect((screen.getByRole('button', { name: '语音输入' }) as HTMLButtonElement).disabled).toBe(false)
    )
    fireEvent.click(screen.getByRole('button', { name: '语音输入' }))
    fireEvent.click(await screen.findByRole('button', { name: '结束录音并识别' }))
    await waitFor(() => expect(transcript).toHaveBeenCalledWith('退款资料'))
    expect(post).toHaveBeenCalledWith('/api/tenant-voice-transcribe', {
      audio_base64: btoa('audio'),
      mime_type: 'audio/webm'
    })
  })

  it('discards a late transcript after switching customer', async () => {
    const pending = deferred<{ text: string }>()
    const post = vi.fn(() => pending.promise)
    const transcript = vi.fn()
    const connection = runtime(post)
    const view = render(<VoiceControls onTranscript={transcript} runtime={connection} scope="customer-a" />)
    await waitFor(() =>
      expect((screen.getByRole('button', { name: '语音输入' }) as HTMLButtonElement).disabled).toBe(false)
    )
    fireEvent.click(screen.getByRole('button', { name: '语音输入' }))
    fireEvent.click(await screen.findByRole('button', { name: '结束录音并识别' }))
    await waitFor(() => expect(post).toHaveBeenCalledOnce())
    view.rerender(<VoiceControls onTranscript={transcript} runtime={connection} scope="customer-b" />)
    await act(async () => pending.resolve({ text: '客户A的隐私内容' }))
    expect(transcript).not.toHaveBeenCalled()
    expect(mic.cancel).toHaveBeenCalled()
  })

  it('releases a microphone whose permission prompt resolves after unmount', async () => {
    const pending = deferred<void>()
    mic.start.mockReturnValue(pending.promise)
    const view = render(<VoiceControls onTranscript={vi.fn()} runtime={runtime()} scope="customer-a" />)
    await waitFor(() =>
      expect((screen.getByRole('button', { name: '语音输入' }) as HTMLButtonElement).disabled).toBe(false)
    )
    fireEvent.click(screen.getByRole('button', { name: '语音输入' }))
    await waitFor(() => expect(mic.start).toHaveBeenCalledOnce())
    view.unmount()
    const count = mic.cancel.mock.calls.length
    await act(async () => pending.resolve())
    expect(mic.cancel.mock.calls.length).toBeGreaterThan(count)
  })

  it('recovers from denied microphone permission without making a request', async () => {
    mic.start.mockRejectedValue(new Error('未获得麦克风权限'))
    const post = vi.fn()
    render(<VoiceControls onTranscript={vi.fn()} runtime={runtime(post)} scope="customer-a" />)
    await waitFor(() =>
      expect((screen.getByRole('button', { name: '语音输入' }) as HTMLButtonElement).disabled).toBe(false)
    )
    fireEvent.click(screen.getByRole('button', { name: '语音输入' }))
    await screen.findByText('未获得麦克风权限')
    expect(post).not.toHaveBeenCalled()
    expect((screen.getByRole('button', { name: '语音输入' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('waits until playback has stopped before acquiring the microphone', async () => {
    const stopped = deferred<void>()
    render(
      <VoiceControls
        onBeforeStart={() => stopped.promise}
        onTranscript={vi.fn()}
        runtime={runtime()}
        scope="customer-a"
      />
    )
    await waitFor(() =>
      expect((screen.getByRole('button', { name: '语音输入' }) as HTMLButtonElement).disabled).toBe(false)
    )
    fireEvent.click(screen.getByRole('button', { name: '语音输入' }))
    expect(mic.start).not.toHaveBeenCalled()
    await act(async () => stopped.resolve())
    await screen.findByRole('button', { name: '结束录音并识别' })
    expect(mic.start).toHaveBeenCalledOnce()
  })

  it('does not acquire the microphone when cancelled while playback is stopping', async () => {
    const stopped = deferred<void>()
    render(
      <VoiceControls
        onBeforeStart={() => stopped.promise}
        onTranscript={vi.fn()}
        runtime={runtime()}
        scope="customer-a"
      />
    )
    await waitFor(() =>
      expect((screen.getByRole('button', { name: '语音输入' }) as HTMLButtonElement).disabled).toBe(false)
    )
    fireEvent.click(screen.getByRole('button', { name: '语音输入' }))
    fireEvent.click(screen.getByRole('button', { name: '取消录音' }))
    await act(async () => stopped.resolve())
    expect(mic.start).not.toHaveBeenCalled()
  })

  it('blocks installation in all three microphone phases without cancelling the user work', async () => {
    const permission = deferred<void>()
    const recognition = deferred<{ text: string }>()
    mic.start.mockReturnValue(permission.promise)
    const post = vi.fn(() => recognition.promise)
    const transcript = vi.fn()
    render(<VoiceControls onTranscript={transcript} runtime={runtime(post)} scope="install-voice" />)
    await waitFor(() => expect((screen.getByRole('button', { name: '语音输入' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: '语音输入' }))
    const beforeCancel = mic.cancel.mock.calls.length
    await act(async () => { expect((await prepareEnterprisePackageInstall('starting')).ready).toBe(false) })
    await act(async () => permission.resolve())
    await screen.findByRole('button', { name: '结束录音并识别' })
    await act(async () => { expect((await prepareEnterprisePackageInstall('recording')).ready).toBe(false) })
    fireEvent.click(screen.getByRole('button', { name: '结束录音并识别' }))
    await waitFor(() => expect(post).toHaveBeenCalledOnce())
    await act(async () => { expect((await prepareEnterprisePackageInstall('transcribing')).ready).toBe(false) })
    expect(mic.cancel.mock.calls.length).toBe(beforeCancel)
    await act(async () => recognition.resolve({ text: '安装被阻挡后仍保留识别结果' }))
    await waitFor(() => expect(transcript).toHaveBeenCalledWith('安装被阻挡后仍保留识别结果'))
    await act(async () => { expect((await prepareEnterprisePackageInstall('idle')).ready).toBe(true) })
    const starts = mic.start.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: '语音输入' }))
    expect(mic.start.mock.calls.length).toBe(starts)
  })
})
