import { useStore } from '@nanostores/react'
import { atom } from 'nanostores'
import { useCallback, useEffect, useRef, useState } from 'react'

import { useMicRecorder } from '@/app/chat/composer/hooks/use-mic-recorder'
import { Button } from '@/components/ui/button'

import { $enterprisePackageInstallFrozen, registerEnterpriseInstallActivity } from './enterprise-install-readiness'
import type { EnterpriseClientRuntime } from './runtime'

// Product decision: keep the implementation for a later re-enable, but do
// not mount a recorder or request microphone capabilities in either client UI.
export const VOICE_INPUT_FROZEN = true

interface VoiceCapabilities {
  available: boolean
  max_bytes?: number
  max_seconds?: number
  reason?: string
}

interface VoiceControlsProps {
  disabled?: boolean
  onBusyChange?: (busy: boolean) => void
  onBeforeStart?: () => void | Promise<void>
  onTranscript: (text: string) => void
  runtime: EnterpriseClientRuntime | null
  scope: string
}

const MIC_COPY = {
  microphoneAccessDenied: '麦克风权限未开启，请在 Windows 隐私设置中允许此应用使用麦克风。',
  microphoneConstraintsUnsupported: '当前麦克风不支持录音要求，请尝试其他设备。',
  microphoneInUse: '麦克风被其他程序占用，请释放后重试。',
  microphonePermissionDenied: '未获得麦克风权限，请允许录音后重试。',
  microphoneStartFailed: '无法开始录音，请检查麦克风。',
  microphoneUnsupported: '当前设备不支持录音，可以继续输入文字。',
  noMicrophone: '没有检测到麦克风，请连接设备后重试。'
}

function toBase64(audio: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1] ?? '')
    reader.onerror = () => reject(new Error('无法读取录音，请重新录制。'))
    reader.readAsDataURL(audio)
  })
}

/** The caller keys this component by account/customer/mode. Pending permission
 * prompts and transcription results are invalidated on every scope change. */
export function VoiceControls({
  disabled,
  onBeforeStart,
  onBusyChange,
  onTranscript,
  runtime,
  scope
}: VoiceControlsProps) {
  const mic = useMicRecorder(MIC_COPY)
  const micRef = useRef(mic.handle)
  micRef.current = mic.handle
  const version = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const callback = useRef(onTranscript)
  const [capability, setCapability] = useState<VoiceCapabilities | null>(null)
  const [$phase] = useState(() => atom<'idle' | 'starting' | 'recording' | 'transcribing'>('idle'))
  const phase = useStore($phase)
  const frozen = useStore($enterprisePackageInstallFrozen)
  const setPhase = useCallback((phase: 'idle' | 'starting' | 'recording' | 'transcribing') => $phase.set(phase), [$phase])
  const [error, setError] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const startedAt = useRef(0)

  useEffect(() => {
    const activity = registerEnterpriseInstallActivity({ blocker: () => $phase.get() === 'idle' ? null : '语音输入正在开启、录音或识别，请结束或取消本次录音后更新。' })
    const unsubscribe = $phase.listen(activity.changed)

    return () => { unsubscribe(); activity.dispose() }
  }, [$phase])

  useEffect(() => {
    let active = true
    setCapability(null)
    void runtime
      ?.get<VoiceCapabilities>('/api/tenant-voice-capabilities')
      .then(result => {
        if (active) {
          setCapability(result)
        }
      })
      .catch(() => {
        if (active) {
          setCapability({ available: false, reason: '语音服务暂不可用，可继续输入文字。' })
        }
      })

    return () => {
      active = false
      // Invalidate every pending callback, including requests started after this effect mounted.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      ++version.current
      micRef.current.cancel()

      if (timer.current) {
        clearTimeout(timer.current)
      }
    }
  }, [runtime, scope])

  useEffect(() => {
    onBusyChange?.(phase !== 'idle')

    return () => onBusyChange?.(false)
  }, [onBusyChange, phase])

  useEffect(() => {
    if (phase !== 'recording') {
      return
    }

    const tick = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)), 1000)

    return () => clearInterval(tick)
  }, [phase])

  const cancel = () => {
    ++version.current

    if (timer.current) {
      clearTimeout(timer.current)
    }

    micRef.current.cancel()
    setPhase('idle')
    setError('')
  }

  const finish = async (requestVersion: number) => {
    if (version.current !== requestVersion) {
      return
    }

    if (timer.current) {
      clearTimeout(timer.current)
    }

    setPhase('transcribing')

    try {
      const recording = await micRef.current.stop()

      if (version.current !== requestVersion) {
        return
      }

      if (!recording || recording.durationMs < 250 || recording.audio.size === 0) {
        throw new Error('录音太短，请重新录音。')
      }

      if (recording.audio.size > (capability?.max_bytes ?? 6 * 1024 * 1024)) {
        throw new Error('录音超过大小限制，请缩短后重试。')
      }

      const audio_base64 = await toBase64(recording.audio)

      if (version.current !== requestVersion || !runtime?.post) {
        return
      }

      const result = await runtime.post<{ text: string }>('/api/tenant-voice-transcribe', {
        audio_base64,
        mime_type: recording.audio.type || 'audio/webm'
      })

      if (version.current !== requestVersion) {
        return
      }

      if (!result.text?.trim()) {
        throw new Error('没有识别到清晰语音，请靠近麦克风重试。')
      }

      callback.current(result.text.trim())
    } catch (reason) {
      if (version.current === requestVersion) {
        setError(reason instanceof Error ? reason.message : '识别失败，请重试。')
      }
    } finally {
      if (version.current === requestVersion) {
        setPhase('idle')
      }
    }
  }

  const start = async () => {
    if ($enterprisePackageInstallFrozen.get() || phase !== 'idle' || !capability?.available || disabled) {
      return
    }

    const requestVersion = ++version.current
    callback.current = onTranscript
    setError('')
    setPhase('starting')

    try {
      await onBeforeStart?.()

      if (version.current !== requestVersion) {
        return
      }

      await micRef.current.start()

      // A permission dialog can outlive navigation or logout. Release the
      // stream it eventually returns, even though the old view is now gone.
      if (version.current !== requestVersion) {
        micRef.current.cancel()

        return
      }

      startedAt.current = Date.now()
      setElapsed(0)
      setPhase('recording')
      timer.current = setTimeout(() => void finish(requestVersion), (capability.max_seconds ?? 120) * 1000)
    } catch (reason) {
      if (version.current === requestVersion) {
        setError(reason instanceof Error ? reason.message : '无法开始录音。')
        setPhase('idle')
      }
    }
  }

  return (
    <div className="hesc-voice-controls">
      <div className="hesc-voice-actions">
        <Button
        disabled={frozen ||
            (phase === 'idle' && (disabled || !capability?.available)) ||
            phase === 'starting' ||
            phase === 'transcribing'
          }
          onClick={() => void (phase === 'recording' ? finish(version.current) : start())}
          type="button"
          variant="secondary"
        >
          {phase === 'recording'
            ? '结束录音并识别'
            : phase === 'starting'
              ? '正在开启麦克风'
              : phase === 'transcribing'
                ? '正在识别'
                : '语音输入'}
        </Button>
        {phase !== 'idle' ? (
          <Button onClick={cancel} type="button" variant="ghost">
            取消录音
          </Button>
        ) : null}
        {phase === 'recording' ? (
          <>
            <meter aria-label="麦克风音量" className="hesc-voice-meter" max={1} min={0} value={mic.level} />
            <span>
              {elapsed} 秒 / {capability?.max_seconds ?? 120} 秒
            </span>
          </>
        ) : null}
      </div>
      <span aria-live="polite" className="hesc-voice-status">
        {error ||
          (phase === 'recording'
            ? '正在录音，结束后可检查识别文字。'
            : phase === 'transcribing'
              ? '正在企业服务器识别，切换工作区将丢弃本次结果。'
              : capability?.available
                ? '点击开始录音；识别后可编辑，再提交问题。'
                : (capability?.reason ?? '正在检查语音服务…'))}
      </span>
    </div>
  )
}
