import { beforeEach, describe, expect, it } from 'vitest'

import {
  DEFAULT_SPEECH_PREFERENCES,
  readSpeechPreferences,
  saveSpeechPreferences,
  speechPreferenceKey
} from './enterprise-speech-preferences'

describe('seat speech preferences', () => {
  beforeEach(() => localStorage.clear())

  it('isolates server, tenant and seat while surviving a reload of the preference reader', () => {
    const key = speechPreferenceKey('https://company.example/api', 'tenant-a', 'seat-a')
    const preference = { engine: 'system' as const, speed: 0.85, style: 'gentle', voice: 'zh-CN-YunxiNeural' }
    saveSpeechPreferences(key, {
      ...preference,
      customerText: 'must never persist',
      sessionToken: 'must never persist'
    } as typeof preference)
    expect(readSpeechPreferences(key)).toEqual(preference)
    expect(localStorage.getItem(key!)).not.toContain('must never persist')
    expect(readSpeechPreferences(speechPreferenceKey('https://other.example', 'tenant-a', 'seat-a'))).toEqual(
      DEFAULT_SPEECH_PREFERENCES
    )
    expect(readSpeechPreferences(speechPreferenceKey('https://company.example', 'tenant-b', 'seat-a'))).toEqual(
      DEFAULT_SPEECH_PREFERENCES
    )
    expect(readSpeechPreferences(speechPreferenceKey('https://company.example', 'tenant-a', 'seat-b'))).toEqual(
      DEFAULT_SPEECH_PREFERENCES
    )
    expect(key).toBe(speechPreferenceKey('https://company.example/another', 'tenant-a', 'seat-a'))
  })

  it('never writes an unscoped preference and safely recovers malformed values', () => {
    expect(speechPreferenceKey(undefined, 'tenant-a', 'seat-a')).toBeNull()
    expect(speechPreferenceKey('https://company.example', undefined, 'seat-a')).toBeNull()
    saveSpeechPreferences(null, DEFAULT_SPEECH_PREFERENCES)
    expect(localStorage.length).toBe(0)
    const key = speechPreferenceKey('https://company.example', 'tenant-a', 'seat-a')!
    localStorage.setItem(key, '{invalid')
    expect(readSpeechPreferences(key)).toEqual(DEFAULT_SPEECH_PREFERENCES)
    localStorage.setItem(
      key,
      JSON.stringify({ speed: 900, style: '<script>', voice: 'https://vendor.example/audio', engine: 'external' })
    )
    expect(readSpeechPreferences(key)).toEqual(DEFAULT_SPEECH_PREFERENCES)
  })
})
