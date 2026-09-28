import { afterEach, describe, expect, it, vi } from 'vitest'

import { $voicePlayback } from '@/store/voice-playback'

import { playSpeechAudioDataUrl, stopVoicePlayback } from './voice-playback'

const personal = vi.hoisted(() => ({ profile: vi.fn(), speak: vi.fn() }))
vi.mock('@/hermes', () => ({ getApiRequestProfile: personal.profile, speakText: personal.speak }))

class TestAudio extends EventTarget {
  static instances: TestAudio[] = []
  src: string
  pause = vi.fn()
  load = vi.fn()
  play = vi.fn(async () => undefined)
  constructor(src: string) {
    super()
    this.src = src
    TestAudio.instances.push(this)
  }
}

describe('enterprise prepared speech playback', () => {
  afterEach(() => {
    stopVoicePlayback()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
    TestAudio.instances = []
  })

  it('plays supplied audio without personal voice configuration, credentials, or synthesis', async () => {
    vi.stubGlobal('Audio', TestAudio)
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)

    const finished = playSpeechAudioDataUrl('data:audio/mpeg;base64,YXVkaW8=', {
      source: 'read-aloud',
      messageId: 'enterprise-1'
    })

    const audio = TestAudio.instances[0]
    expect(audio.src).toBe('data:audio/mpeg;base64,YXVkaW8=')
    expect($voicePlayback.get().status).toBe('speaking')
    audio.dispatchEvent(new Event('ended'))
    expect(await finished).toBe(true)
    expect($voicePlayback.get().status).toBe('idle')
    expect(personal.profile).not.toHaveBeenCalled()
    expect(personal.speak).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('stops immediately and resolves interrupted playback as false', async () => {
    vi.stubGlobal('Audio', TestAudio)
    const finished = playSpeechAudioDataUrl('data:audio/mpeg;base64,YXVkaW8=', { source: 'read-aloud' })
    const audio = TestAudio.instances[0]
    stopVoicePlayback()
    expect(audio.pause).toHaveBeenCalledOnce()
    expect(audio.src).toBe('')
    expect(await finished).toBe(false)
    expect($voicePlayback.get().status).toBe('idle')
  })

  it('rejects remote URLs instead of contacting a speech vendor directly', async () => {
    vi.stubGlobal('Audio', TestAudio)
    await expect(playSpeechAudioDataUrl('https://example.com/vendor.mp3', { source: 'read-aloud' })).rejects.toThrow(
      'Invalid speech audio'
    )
    expect(TestAudio.instances).toHaveLength(0)
  })
})
