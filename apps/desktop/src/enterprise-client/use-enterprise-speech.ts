import { useCallback, useEffect, useRef, useState } from 'react'

import { sanitizeTextForSpeech } from '@/lib/speech-text'
import { playSpeechAudioDataUrl, stopVoicePlayback } from '@/lib/voice-playback'

import { $enterprisePackageInstallFrozen, registerEnterpriseInstallActivity } from './enterprise-install-readiness'
import {
  type EnterpriseSpeechPreferences,
  readSpeechPreferences,
  saveSpeechPreferences
} from './enterprise-speech-preferences'
import type { EnterpriseClientRuntime } from './runtime'

interface SpeechChoice {
  id: string
  label: string
  gender?: 'female' | 'male'
}
interface SpeechCapabilities {
  available: boolean
  default_voice?: string
  voices?: SpeechChoice[]
  styles?: SpeechChoice[]
}

export function speechChunks(text: string): string[] {
  let plain = sanitizeTextForSpeech(text.replace(/```[\s\S]*?```/g, '代码内容请查看屏幕。'))
  const chunks: string[] = []

  while (plain) {
    const maxLength = chunks.length === 0 ? 80 : 220
    const segment = plain.slice(0, maxLength)

    const boundary = Math.max(
      segment.lastIndexOf('。'),
      segment.lastIndexOf('！'),
      segment.lastIndexOf('？'),
      segment.lastIndexOf('；')
    )

    const length = plain.length > maxLength && boundary > 20 ? boundary + 1 : segment.length
    chunks.push(plain.slice(0, length))
    plain = plain.slice(length)
  }

  return chunks
}

/** Natural voice uses the enterprise-authorized relay. Windows local speech
 * remains an explicit fallback; no key or configurable URL enters renderer. */
export function useEnterpriseSpeech(
  runtime: EnterpriseClientRuntime | null,
  scope: string,
  preferenceKey: string | null = null
) {
  const [localAvailable, setLocalAvailable] = useState(false)
  const [cloud, setCloud] = useState<SpeechCapabilities>({ available: false })

  const [preference, setPreference] = useState(() => ({
    key: preferenceKey,
    value: readSpeechPreferences(preferenceKey)
  }))

  const { voice, style, speed, engine } = preference.value

  const setVoice = useCallback(
    (voice: string) => setPreference(current => ({ ...current, value: { ...current.value, voice } })),
    []
  )

  const setStyle = useCallback(
    (style: string) => setPreference(current => ({ ...current, value: { ...current.value, style } })),
    []
  )

  const setSpeed = useCallback(
    (speed: number) => setPreference(current => ({ ...current, value: { ...current.value, speed } })),
    []
  )

  const setEngine = useCallback(
    (engine: EnterpriseSpeechPreferences['engine']) =>
      setPreference(current => ({ ...current, value: { ...current.value, engine } })),
    []
  )

  const [speaking, setSpeaking] = useState(false)
  const [error, setError] = useState('')
  const native = useRef(false)
  const nativePlayback = useRef(false)
  const cancelBrowserPlayback = useRef<(() => void) | null>(null)
  const browserVoice = useRef<SpeechSynthesisVoice | null>(null)
  const activeId = useRef<string | null>(null)
  const pendingStop = useRef(Promise.resolve())

  useEffect(() => {
    setPreference(current =>
      current.key === preferenceKey ? current : { key: preferenceKey, value: readSpeechPreferences(preferenceKey) }
    )
  }, [preferenceKey])
  useEffect(() => {
    if (preference.key === preferenceKey) {
      saveSpeechPreferences(preferenceKey, preference.value)
    }
  }, [preference, preferenceKey])

  const stop = useCallback(() => {
    const id = activeId.current
    activeId.current = null
    const wasNative = nativePlayback.current
    nativePlayback.current = false

    if (id) {
      stopVoicePlayback()
      window.speechSynthesis?.cancel()
      cancelBrowserPlayback.current?.()
    }

    setSpeaking(false)

    if (id && wasNative && runtime?.speech) {
      pendingStop.current = runtime.speech
        .stop(id)
        .then(() => {})
        .catch(() => {})
    }

    return pendingStop.current
  }, [runtime])

  useEffect(() => {
    const activity = registerEnterpriseInstallActivity({ blocker: () => null, stopPlayback: stop })

    return () => activity.dispose()
  }, [stop])

  // Reset engine capabilities for the new scope; no reactive state is mirrored into a ref.
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    let active = true
    setLocalAvailable(false)
    setCloud({ available: false })
    native.current = false

    const inspectVoices = () => {
      if (!active || native.current) {
        return
      }

      browserVoice.current =
        window.speechSynthesis?.getVoices().find(voice => voice.localService && /^zh\b/i.test(voice.lang)) ?? null
      setLocalAvailable(Boolean(browserVoice.current))
    }

    inspectVoices()
    window.speechSynthesis?.addEventListener('voiceschanged', inspectVoices)
    void runtime?.speech
      ?.status()
      .then(result => {
        if (active && result.available) {
          native.current = true
          setLocalAvailable(true)
        }
      })
      .catch(() => {})
    void runtime
      ?.get<SpeechCapabilities>('/api/tenant-speech-capabilities')
      .then(result => {
        if (active) {
          setCloud(result)

          if (result.available) {
            setPreference(current => ({
              ...current,
              value: {
                ...current.value,
                voice: result.voices?.some(voice => voice.id === current.value.voice)
                  ? current.value.voice
                  : (result.default_voice ?? result.voices?.[0]?.id ?? ''),
                style: result.styles?.some(style => style.id === current.value.style)
                  ? current.value.style
                  : (result.styles?.[0]?.id ?? 'chat')
              }
            }))
          }
        }
      })
      .catch(() => {})

    return () => {
      active = false
      window.speechSynthesis?.removeEventListener('voiceschanged', inspectVoices)
      void stop()
    }
  }, [runtime, scope, stop])

  const natural = engine === 'natural' && cloud.available
  const available = natural || localAvailable

  const speak = useCallback(
    async (text: string) => {
      if ($enterprisePackageInstallFrozen.get()) {return}
      const stopped = stop()
      setError('')

      if (!available) {
        setError('当前系统没有可用的中文朗读语音。')

        return
      }

      const id = crypto.randomUUID()
      activeId.current = id
      setSpeaking(true)

      try {
        await stopped
        let useNatural = natural
        const chunks = speechChunks(text)
        const synthesize = async (chunk: string) => {
          try {
            const result = await runtime?.post?.<{ audio_base64: string; content_type: string }>(
              '/api/tenant-speech-synthesize', { text: chunk, voice, speed, style })
            return result?.content_type === 'audio/mpeg' ? result : null
          } catch { return null }
        }
        let nextAudio: ReturnType<typeof synthesize> | null = null
        for (const [index, chunk] of chunks.entries()) {
          if (activeId.current !== id) {
            break
          }

          if (useNatural) {
            try {
              const result = await (nextAudio ?? synthesize(chunk))
              nextAudio = null

              if (activeId.current !== id) {
                break
              }

              if (!result || result.content_type !== 'audio/mpeg') {
                throw new Error('无法播放自然语音')
              }

              // Only one chunk ahead: hide synthesis latency during playback,
              // without synthesizing the entire answer after cancellation.
              if (chunks[index + 1]) {nextAudio = synthesize(chunks[index + 1])}

              const played = await playSpeechAudioDataUrl(`data:audio/mpeg;base64,${result.audio_base64}`, {
                source: 'read-aloud',
                messageId: id
              })

              if (!played) {
                break
              }

              continue
            } catch {
              if (activeId.current !== id) {
                break
              }

              if (!localAvailable) {
                throw new Error('自然语音暂不可用，回答文字已保留，请稍后重试。')
              }

              useNatural = false
              setError('自然语音暂不可用，本次改用系统中文朗读。')
            }
          }

          if (native.current) {
            nativePlayback.current = true
            const result = await runtime?.speech?.speak(id, chunk)

            if (activeId.current === id) {
              nativePlayback.current = false
            }

            if (!result?.ok && activeId.current === id) {
              throw new Error('朗读未能完成，请检查系统音频设备。')
            }
          } else {
            await new Promise<void>((resolve, reject) => {
              const utterance = new SpeechSynthesisUtterance(chunk)

              const finish = (error?: Error) => {
                utterance.onend = null
                utterance.onerror = null

                if (cancelBrowserPlayback.current === cancelled) {
                  cancelBrowserPlayback.current = null
                }

                if (error) {
                  reject(error)
                } else {
                  resolve()
                }
              }

              const cancelled = () => finish()
              cancelBrowserPlayback.current = cancelled
              utterance.voice = browserVoice.current
              utterance.lang = 'zh-CN'
              utterance.onend = () => finish()
              utterance.onerror = () =>
                finish(activeId.current === id ? new Error('朗读未能完成，请重试。') : undefined)
              window.speechSynthesis.speak(utterance)
            })
          }
        }
      } catch (reason) {
        if (activeId.current === id) {
          setError(reason instanceof Error ? reason.message : '朗读失败。')
        }
      } finally {
        if (activeId.current === id) {
          activeId.current = null
          setSpeaking(false)
        }
      }
    },
    [available, localAvailable, natural, runtime, speed, stop, style, voice]
  )

  return {
    available,
    cloudAvailable: cloud.available,
    engine,
    error,
    localAvailable,
    setEngine,
    setSpeed,
    setStyle,
    setVoice,
    speak,
    speaking,
    speed,
    stop,
    style,
    styles: cloud.styles ?? [],
    voice,
    voices: cloud.voices ?? []
  }
}
