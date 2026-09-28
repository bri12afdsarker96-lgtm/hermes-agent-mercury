/** Non-sensitive voice choices only. Customer text and session tokens never
 * belong in this store. Preferences stay on this device for the signed-in seat. */
export interface EnterpriseSpeechPreferences {
  engine: 'natural' | 'system'
  speed: number
  style: string
  voice: string
}

export const DEFAULT_SPEECH_PREFERENCES: EnterpriseSpeechPreferences = {
  engine: 'natural',
  speed: 1.05,
  style: 'chat',
  voice: ''
}

export function speechPreferenceKey(serverOrigin?: string, tenantId?: string, principalId?: string): string | null {
  if (!serverOrigin || !tenantId || !principalId) {
    return null
  }

  try {
    const url = new URL(serverOrigin)

    if (!['http:', 'https:'].includes(url.protocol)) {
      return null
    }

    return `hermes-enterprise-speech:v1:${JSON.stringify([url.origin, tenantId, principalId])}`
  } catch {
    return null
  }
}

export function readSpeechPreferences(key: string | null): EnterpriseSpeechPreferences {
  try {
    const raw = key ? localStorage.getItem(key) : null

    if (!raw || raw.length > 2048) {
      return { ...DEFAULT_SPEECH_PREFERENCES }
    }

    const value = JSON.parse(raw) as Partial<EnterpriseSpeechPreferences>

    return {
      engine: value.engine === 'system' ? 'system' : 'natural',
      speed: [0.85, 1, 1.05, 1.2].includes(value.speed ?? 0) ? value.speed! : 1.05,
      style: typeof value.style === 'string' && /^[\w-]{1,96}$/.test(value.style) ? value.style : 'chat',
      voice: typeof value.voice === 'string' && /^[\w-]{1,96}$/.test(value.voice) ? value.voice : ''
    }
  } catch {
    return { ...DEFAULT_SPEECH_PREFERENCES }
  }
}

export function saveSpeechPreferences(key: string | null, value: EnterpriseSpeechPreferences): void {
  if (!key) {
    return
  }

  try {
    // Explicit allowlist prevents future state additions from persisting text.
    localStorage.setItem(
      key,
      JSON.stringify({ engine: value.engine, speed: value.speed, style: value.style, voice: value.voice })
    )
  } catch {
    // A blocked/full preference store must not prevent voice interaction.
  }
}
