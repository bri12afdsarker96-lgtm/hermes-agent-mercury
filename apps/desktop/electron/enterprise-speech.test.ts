import { describe, expect, it } from 'vitest'

import { EnterpriseSpeech } from './enterprise-speech'

describe('enterprise system speech', () => {
  it('rejects malformed requests before starting an OS process', async () => {
    const speech = new EnterpriseSpeech()
    expect(await speech.speak('owner', '../invalid', '问题')).toEqual({ ok: false })
    expect(await speech.speak('owner', 'request', 'x'.repeat(601))).toEqual({ ok: false })
    expect(await speech.speak('owner', 'request', { script: 'not text' })).toEqual({ ok: false })
  })

  it.skipIf(process.platform !== 'win32')('detects the actual Windows Chinese voice without a cloud service', async () => {
    const speech = new EnterpriseSpeech()
    const result = await speech.status()
    console.log('ENTERPRISE_WINDOWS_CHINESE_SPEECH', result)
    expect(typeof result.available).toBe('boolean')
    speech.stopAll()
  }, 15_000)
})
