import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { prepareEnterprisePackageInstall, releaseEnterprisePackageInstall } from './enterprise-install-readiness'
import { readSpeechPreferences, speechPreferenceKey } from './enterprise-speech-preferences'
import type { EnterpriseClientRuntime } from './runtime'
import { speechChunks, useEnterpriseSpeech } from './use-enterprise-speech'

const playback = vi.hoisted(() => ({ play: vi.fn(), stop: vi.fn() }))
vi.mock('@/lib/voice-playback', () => ({ playSpeechAudioDataUrl: playback.play, stopVoicePlayback: playback.stop }))

const capabilities = {
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

const audio = { audio_base64: 'YXVkaW8=', content_type: 'audio/mpeg' }

function deferred<T>() {
  let resolve!: (value: T) => void

  const promise = new Promise<T>(done => {
    resolve = done
  })

  return { promise, resolve }
}

function connection(local = false) {
  const get = vi.fn(async () => capabilities)
  const post = vi.fn(async () => audio)

  const speech = {
    status: vi.fn(async () => ({ available: local })),
    speak: vi.fn(async () => ({ ok: true })),
    stop: vi.fn(async () => ({ ok: true }))
  }

  const runtime = { get, post, speech, disconnect: vi.fn() } as unknown as EnterpriseClientRuntime

  return { get, post, runtime, speech }
}

describe('enterprise speech lifecycle', () => {
  afterEach(() => releaseEnterprisePackageInstall())
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    playback.play.mockResolvedValue(true)
  })

  it('uses enterprise voice choices and an authenticated relay for every style and speed', async () => {
    const backend = connection()
    const { result } = renderHook(() => useEnterpriseSpeech(backend.runtime, 'account-a:knowledge'))
    await waitFor(() => expect(result.current.available).toBe(true))
    expect(result.current.voice).toBe('zh-CN-XiaoxiaoNeural')

    for (const [voice, style, speed] of [
      ['zh-CN-XiaoxiaoNeural', 'chat', 1.05],
      ['zh-CN-YunxiNeural', 'gentle', 0.85],
      ['zh-CN-XiaoxiaoNeural', 'customerservice', 1.2]
    ] as const) {
      act(() => {
        result.current.setVoice(voice)
        result.current.setStyle(style)
        result.current.setSpeed(speed)
      })
      await act(async () => result.current.speak('**退款**需要提供订单号。'))
      expect(backend.post).toHaveBeenLastCalledWith('/api/tenant-speech-synthesize', {
        text: '退款需要提供订单号。',
        voice,
        style,
        speed
      })
    }

    expect(backend.get).toHaveBeenCalledWith('/api/tenant-speech-capabilities')
    expect(playback.play).toHaveBeenCalledWith(
      'data:audio/mpeg;base64,YXVkaW8=',
      expect.objectContaining({ source: 'read-aloud' })
    )
    expect(backend.speech.speak).not.toHaveBeenCalled()
  })

  it.each(['account-b:knowledge', 'account-a:chat'])(
    'discards late synthesis after switching to %s',
    async nextScope => {
      const backend = connection()
      const pending = deferred<typeof audio>()
      backend.post.mockReturnValue(pending.promise)

      const view = renderHook(({ scope }) => useEnterpriseSpeech(backend.runtime, scope), {
        initialProps: { scope: 'account-a:knowledge' }
      })

      await waitFor(() => expect(view.result.current.available).toBe(true))
      let speaking!: Promise<void>
      act(() => {
        speaking = view.result.current.speak('账号 A 的答案')
      })
      await waitFor(() => expect(backend.post).toHaveBeenCalledOnce())
      view.rerender({ scope: nextScope })
      await act(async () => {
        pending.resolve(audio)
        await speaking
      })
      expect(playback.play).not.toHaveBeenCalled()
      expect(view.result.current.speaking).toBe(false)
    }
  )

  it('does not play a stopped response or request the next chunk', async () => {
    const backend = connection()
    const pending = deferred<typeof audio>()
    backend.post.mockReturnValue(pending.promise)
    const { result } = renderHook(() => useEnterpriseSpeech(backend.runtime, 'account-a:knowledge'))
    await waitFor(() => expect(result.current.available).toBe(true))
    let speaking!: Promise<void>
    act(() => {
      speaking = result.current.speak('这是企业知识回答。'.repeat(80))
    })
    await waitFor(() => expect(backend.post).toHaveBeenCalledOnce())
    await act(async () => result.current.stop())
    await act(async () => {
      pending.resolve(audio)
      await speaking
    })
    expect(playback.play).not.toHaveBeenCalled()
    expect(backend.post).toHaveBeenCalledOnce()
  })

  it('limits wasted synthesis to one prefetched chunk when playback is interrupted', async () => {
    const backend = connection()
    playback.play.mockResolvedValue(false)
    const { result } = renderHook(() => useEnterpriseSpeech(backend.runtime, 'account-a:knowledge'))
    await waitFor(() => expect(result.current.available).toBe(true))
    await act(async () => result.current.speak('企业回答。'.repeat(100)))
    expect(backend.post).toHaveBeenCalledTimes(2)
    expect(playback.play).toHaveBeenCalledOnce()
    expect(result.current.speaking).toBe(false)
  })

  it('clearly reports cloud failure and uses local speech only when it is available', async () => {
    const backend = connection(true)
    backend.post.mockRejectedValue(new Error('503'))
    const { result } = renderHook(() => useEnterpriseSpeech(backend.runtime, 'account-a:knowledge'))
    await waitFor(() => expect(result.current.localAvailable).toBe(true))
    await act(async () => result.current.speak('退款资料。'))
    expect(backend.speech.speak).toHaveBeenCalledWith(expect.any(String), '退款资料。')
    expect(result.current.error).toBe('自然语音暂不可用，本次改用系统中文朗读。')
    expect(playback.play).not.toHaveBeenCalled()
  })

  it('keeps text available when cloud fails and no local voice exists', async () => {
    const backend = connection()
    backend.post.mockRejectedValue(new Error('503'))
    const { result } = renderHook(() => useEnterpriseSpeech(backend.runtime, 'account-a:knowledge'))
    await waitFor(() => expect(result.current.available).toBe(true))
    await act(async () => result.current.speak('退款资料。'))
    expect(result.current.error).toBe('自然语音暂不可用，回答文字已保留，请稍后重试。')
    expect(backend.speech.speak).not.toHaveBeenCalled()
  })

  it('waits for an in-flight native stop before allowing a second stop to release the mic', async () => {
    const backend = connection(true)
    const nativeSpeaking = deferred<{ ok: boolean }>()
    const nativeStopped = deferred<{ ok: boolean }>()
    backend.speech.speak.mockReturnValue(nativeSpeaking.promise)
    backend.speech.stop.mockReturnValue(nativeStopped.promise)
    const { result } = renderHook(() => useEnterpriseSpeech(backend.runtime, 'account-a:knowledge'))
    await waitFor(() => expect(result.current.localAvailable).toBe(true))
    act(() => result.current.setEngine('system'))
    let speaking!: Promise<void>
    act(() => {
      speaking = result.current.speak('第一段。'.repeat(100))
    })
    await waitFor(() => expect(backend.speech.speak).toHaveBeenCalledOnce())
    let released = false
    act(() => {
      void result.current.stop()
      void result.current.stop().then(() => {
        released = true
      })
    })
    expect(released).toBe(false)
    await act(async () => {
      nativeStopped.resolve({ ok: true })
      nativeSpeaking.resolve({ ok: false })
      await speaking
    })
    expect(released).toBe(true)
    expect(backend.speech.stop).toHaveBeenCalledOnce()
    expect(backend.speech.speak).toHaveBeenCalledOnce()
  })

  it('preserves voice selection across modes and sanitizes bounded chunks', async () => {
    const backend = connection()

    const view = renderHook(({ scope }) => useEnterpriseSpeech(backend.runtime, scope), {
      initialProps: { scope: 'knowledge' }
    })

    await waitFor(() => expect(view.result.current.available).toBe(true))
    act(() => view.result.current.setVoice('zh-CN-YunxiNeural'))
    view.rerender({ scope: 'chat' })
    await waitFor(() => expect(view.result.current.available).toBe(true))
    expect(view.result.current.voice).toBe('zh-CN-YunxiNeural')
    const chunks = speechChunks('**说明**。\n```js\nsecret();\n```\n' + '退款手续。'.repeat(100))
    expect(chunks.every(chunk => chunk.length <= 220)).toBe(true)
    expect(chunks.join('')).not.toContain('secret')
    expect(chunks.join('')).toContain('代码内容请查看屏幕。')
  })

  it('restores seat choices after remount and does not overwrite another account while switching', async () => {
    const backend = connection()
    const keyA = speechPreferenceKey('https://enterprise.example', 'tenant-a', 'seat-a')
    const keyB = speechPreferenceKey('https://enterprise.example', 'tenant-a', 'seat-b')

    const view = renderHook(({ key }) => useEnterpriseSpeech(backend.runtime, 'knowledge', key), {
      initialProps: { key: keyA }
    })

    await waitFor(() => expect(view.result.current.available).toBe(true))
    act(() => {
      view.result.current.setVoice('zh-CN-YunxiNeural')
      view.result.current.setStyle('gentle')
      view.result.current.setSpeed(0.85)
      view.result.current.setEngine('system')
    })
    await waitFor(() => expect(readSpeechPreferences(keyA).voice).toBe('zh-CN-YunxiNeural'))
    view.rerender({ key: keyB })
    await waitFor(() => expect(view.result.current.style).toBe('chat'))
    expect(readSpeechPreferences(keyB).voice).not.toBe('zh-CN-YunxiNeural')
    view.unmount()
    const restored = renderHook(() => useEnterpriseSpeech(backend.runtime, 'knowledge', keyA))
    await waitFor(() => expect(restored.result.current.available).toBe(false))
    expect(restored.result.current.voice).toBe('zh-CN-YunxiNeural')
    expect(restored.result.current.style).toBe('gentle')
    expect(restored.result.current.speed).toBe(0.85)
    expect(restored.result.current.engine).toBe('system')
  })

  it('fences late speech synthesis and new playback while an installation is prepared', async () => {
    const backend = connection()
    const pending = deferred<typeof audio>()
    backend.post.mockReturnValue(pending.promise)
    const { result } = renderHook(() => useEnterpriseSpeech(backend.runtime, 'install-speech'))
    await waitFor(() => expect(result.current.available).toBe(true))
    let speaking!: Promise<void>
    act(() => { speaking = result.current.speak('安装前仍在合成的回答') })
    await waitFor(() => expect(backend.post).toHaveBeenCalledOnce())
    await act(async () => { expect((await prepareEnterprisePackageInstall('speech-stop')).ready).toBe(true) })
    await act(async () => { pending.resolve(audio); await speaking; await result.current.speak('不应新建播放') })
    expect(playback.play).not.toHaveBeenCalled()
    expect(backend.post).toHaveBeenCalledOnce()
    expect(result.current.speaking).toBe(false)
  })
})
