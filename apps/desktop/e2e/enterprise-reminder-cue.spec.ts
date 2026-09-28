import path from 'node:path'
import { _electron, test, expect, type ElectronApplication } from '@playwright/test'
import { buildAppEnv, createSandbox } from './fixtures'
import pkg from '../package.json' with { type: 'json' }

test('built client decodes and plays the bundled reminder cue offline', async () => {
  test.setTimeout(60_000)
  const sandbox = createSandbox('reminder-cue')
  const env = buildAppEnv(sandbox, {HERMES_DESKTOP_BOOT_FAKE:'1'})
  delete env.ELECTRON_RUN_AS_NODE
  delete env.HERMES_DESKTOP_DEV_SERVER
  let app: ElectronApplication | undefined
  try {
    app = await _electron.launch({executablePath:path.resolve('release',pkg.version,'win-unpacked','HermesEnterpriseAssistant.exe'), args:['--disable-gpu','--no-sandbox'], env})
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    const result = await page.evaluate(async () => {
      // Discover the actual emitted asset; no mocked decoder/playback.
      const sources = Array.from(document.querySelectorAll<HTMLScriptElement>('script[src]')).map(s => s.src)
      const source = await (await fetch(sources.find(s => s.includes('/assets/index-'))!)).text()
      const file = source.match(/reminder-cue-[\w-]+\.mp3/)?.[0]
      if (!file) {throw new Error('Bundled reminder cue missing')}
      const audio = new Audio(new URL(`assets/${file}`, location.href).href)
      await audio.play()
      await new Promise<void>((resolve,reject) => {
        audio.onended = () => resolve()
        audio.onerror = () => reject(new Error('Audio decode failed'))
      })
      return {duration:audio.duration, ended:audio.ended}
    })
    expect(result.ended).toBe(true)
    expect(result.duration).toBeGreaterThan(1)
    expect(result.duration).toBeLessThan(12)
  } finally {await app?.close()}
})
