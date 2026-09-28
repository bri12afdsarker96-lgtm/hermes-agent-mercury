/**
 * Real Electron visual evidence for the Enterprise root. The production
 * renderer → preload → IPC path is used with deterministic server responses.
 * Fixtures establish layout and interaction evidence, not production login,
 * model quality, permission enforcement, or real customer delivery.
 *
 * Screenshots are explicit review artifacts, not automatically accepted pixel
 * baselines. Each test closes its own Electron context before returning so
 * trace finalization cannot retain a live window. Tests have bounded timeouts
 * and assert the actual Electron and renderer viewport dimensions.
 */

import { readFileSync } from 'node:fs'

import { type ElectronApplication, type Page } from '@playwright/test'
import type { DownloadItem } from 'electron'

import { type MockBackendFixture, setupMockBackend } from './fixtures'
import { expect, test } from './test'

const ENTERPRISE_SESSION_ID = 'enterprise-visual-session'

const NATURAL_VOICE_CAPABILITIES = {
  available: true,
  default_voice: 'zh-CN-XiaoxiaoNeural',
  voices: [
    { id: 'zh-CN-XiaoxiaoNeural', label: '晓晓', gender: 'female' },
    { id: 'zh-CN-XiaoyiNeural', label: '晓伊', gender: 'female' },
    { id: 'zh-CN-XiaochenNeural', label: '晓辰', gender: 'female' },
    { id: 'zh-CN-YunxiNeural', label: '云希', gender: 'male' },
    { id: 'zh-CN-YunjianNeural', label: '云健', gender: 'male' },
    { id: 'zh-CN-YunyangNeural', label: '云扬', gender: 'male' }
  ],
  styles: [
    { id: 'chat', label: '自然聊天' },
    { id: 'gentle', label: '温柔' },
    { id: 'customerservice', label: '客服' }
  ]
}

interface VoiceEvidenceCall {
  path?: string
  bytes?: number
  content?: unknown
  mode?: unknown
  text?: unknown
  voice?: unknown
  style?: unknown
  speed?: unknown
}

const ENTERPRISE_RESPONSES = {
  '/api/health': { auth_mode: 'native_bearer', ok: true },
  '/api/metrics?window=24h': {
    alerts: [
      {
        code: 'QUEUE_LATENCY',
        level: 'warning',
        message: 'Queue latency above the review threshold',
        threshold: 120,
        value: 148
      }
    ]
  },
  '/api/tenant-ai-models': {
    configured: true,
    models: [{ configuration_id: 'visual-model', is_default: true, model: '视觉测试模型', provider: '本地测试' }]
  },
  '/api/customer-reply-workspace': { revision: 0, workspace: null, updated_at: null },
  '/api/tenant-voice-capabilities': { available: false, reason: '视觉测试未启用录音服务' },
  '/api/whoami': {
    capability_revision: 42,
    data_scope: { mode: 'tenant', scopes: ['tenant:acme-logistics'] },
    desktop_surfaces: {
      schema_version: 1,
      surfaces: {
        knowledge: { available: true },
        workflows: { available: true }
      }
    },
    effective_permissions: ['*'],
    name: '测试坐席',
    principal_id: 'principal-operator-042',
    product_capabilities: {
      audit_export: { enabled: false, status: 'CONTRACT' },
      enterprise_chat: { enabled: true, status: 'LIVE' },
      knowledge_rag: { enabled: true, status: 'LIVE' },
      wecom_delivery: { enabled: false, status: 'DEV' }
    },
    role: 'operator',
    tenant_id: 'tenant-acme-logistics'
  }
} as const

// Default viewport set (all four enabled).
const EVIDENCE_VIEWPORTS = [
  { height: 720, width: 1280 },
  { height: 900, width: 1440 },
  { height: 941, width: 1672 },
  { height: 1080, width: 1920 }
] as const

async function installEnterpriseEvidenceServer(app: ElectronApplication, voiceAudioBase64?: string): Promise<void> {
  await app.evaluate(
    ({ ipcMain }, fixture) => {
      for (const channel of [
        'hermes:enterprise:auto-connect',
        'hermes:enterprise:disconnect',
        'hermes:enterprise:request',
        'hermes:enterprise:upload'
      ]) {
        ipcMain.removeHandler(channel)
      }

      ipcMain.handle('hermes:enterprise:auto-connect', () => ({
        baseUrl: 'http://127.0.0.1:49152',
        ok: true,
        sessionId: fixture.sessionId
      }))
      ipcMain.handle('hermes:enterprise:disconnect', () => ({ ok: true }))

      let draftWorkspace: { revision: number; workspace: unknown; updated_at: number | null } = {
        revision: 0,
        workspace: null,
        updated_at: null
      }

      const voiceCalls: VoiceEvidenceCall[] = []

      ;(globalThis as unknown as { enterpriseVoiceEvidence: VoiceEvidenceCall[] }).enterpriseVoiceEvidence = voiceCalls
      ipcMain.handle(
        'hermes:enterprise:request',
        (
          _event: unknown,
          request: { path?: string; sessionId?: string; method?: string; body?: Record<string, unknown> }
        ) => {
          if (request?.sessionId !== fixture.sessionId) {
            return { code: 'network', kind: 'error', message: 'not connected', status: 0 }
          }

          if (request.path === '/api/customer-reply-workspace') {
            if (request.method === 'POST') {
              if (!request.body || request.body.expected_revision !== draftWorkspace.revision) {
                return { code: 'http', kind: 'error', message: 'fixture revision conflict', status: 409 }
              }

              draftWorkspace = {
                revision: draftWorkspace.revision + 1,
                workspace: request.body.workspace,
                updated_at: 1
              }
            }

            return { data: draftWorkspace, kind: 'ok' }
          }

          if (fixture.voiceAudioBase64) {
            if (request.path === '/api/tenant-voice-capabilities') {
              return { kind: 'ok', data: { available: true, max_seconds: 120 } }
            }

            if (request.path === '/api/tenant-speech-capabilities') {
              return { kind: 'ok', data: fixture.speechCapabilities }
            }

            if (request.path === '/api/tenant-voice-transcribe') {
              const bytes =
                typeof request.body?.audio_base64 === 'string'
                  ? Buffer.from(request.body.audio_base64, 'base64').byteLength
                  : 0

              voiceCalls.push({ path: request.path, bytes })

              if (!bytes) {
                return { kind: 'error', code: 'http', status: 400, message: 'empty recording' }
              }

              return { kind: 'ok', data: { text: '退款需要准备哪些资料' } }
            }

            if (request.path === '/api/tenant-ai-assist') {
              voiceCalls.push({ path: request.path, content: request.body?.content, mode: request.body?.mode })

              return {
                kind: 'ok',
                data: {
                  text: '### 退款资料\n\n请准备以下资料：\n\n- **订单号**与购买凭证\n- 客户的退款原因\n\n依据企业售后知识库，核实资料后由坐席确认回复。',
                  knowledge_grounded: true
                }
              }
            }

            if (request.path === '/api/tenant-speech-synthesize') {
              voiceCalls.push({
                path: request.path,
                text: request.body?.text,
                voice: request.body?.voice,
                style: request.body?.style,
                speed: request.body?.speed
              })

              return { kind: 'ok', data: { audio_base64: fixture.voiceAudioBase64, content_type: 'audio/mpeg' } }
            }
          }

          const data = fixture.responses[request?.path as keyof typeof fixture.responses]

          return data === undefined
            ? { code: 'http', kind: 'error', message: 'fixture endpoint not defined', status: 404 }
            : { data, kind: 'ok' }
        }
      )
      ipcMain.handle('hermes:enterprise:upload', () => ({
        code: 'http',
        kind: 'error',
        message: 'uploads are outside visual evidence',
        status: 405
      }))
    },
    {
      responses: ENTERPRISE_RESPONSES,
      sessionId: ENTERPRISE_SESSION_ID,
      speechCapabilities: NATURAL_VOICE_CAPABILITIES,
      voiceAudioBase64
    }
  )
}

// Bounded viewport application. Forces both the Electron BrowserWindow content
// size AND the Playwright page viewport to match the requested width/height,
// with a small bounded retry (max 3 attempts). On failure, throws with
// explicit target vs actual evidence so the failing viewport is reported
// instead of being silently screenshot at a wrong size.
const MAX_VIEWPORT_RESIZE_ATTEMPTS = 3

async function applyViewportOrThrow(
  app: ElectronApplication,
  page: Page,
  width: number,
  height: number
): Promise<void> {
  for (let attempt = 1; attempt <= MAX_VIEWPORT_RESIZE_ATTEMPTS; attempt++) {
    // First set the Playwright page viewport (renderer-side, controls
    // page-level viewport that toHaveScreenshot reads).
    await page.setViewportSize({ height, width })

    // Then drive the Electron BrowserWindow content size to match.
    await app.evaluate(
      async ({ BrowserWindow }, size) => {
        const win = BrowserWindow.getAllWindows()[0]

        if (!win) {
          throw new Error('Enterprise visual evidence window is unavailable')
        }

        win.unmaximize()
        win.setMinimumSize(640, 480)
        // setBounds first (forces OS-level resize).
        win.setBounds({ x: 0, y: 0, width: size.width, height: size.height })
        // Confirm and fall back to setContentSize if needed.
        const after = win.getContentSize()

        if (after[0] !== size.width || after[1] !== size.height) {
          win.setContentSize(size.width, size.height, false)
        }

        // Give the renderer one paint frame to relayout. The Main process does
        // not have requestAnimationFrame, so use a small setTimeout.
        await new Promise<void>(resolve => setTimeout(resolve, 100))
      },
      { height, width }
    )

    // Re-set Playwright viewport AFTER Electron resize in case the resize
    // pushed the page viewport back to its default.
    await page.setViewportSize({ height, width })

    const actualApp = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      const [w, h] = win ? win.getContentSize() : [0, 0]

      return { height: h, width: w }
    })

    const actualPage = await page.evaluate(() => ({
      height: window.innerHeight,
      width: window.innerWidth
    }))

    // Both Electron content size AND renderer inner size must match the target.
    // A mismatch means window-state restoration is fighting the resize.
    if (
      actualApp.width === width &&
      actualApp.height === height &&
      actualPage.width === width &&
      actualPage.height === height
    ) {
      return
    }

    if (attempt === MAX_VIEWPORT_RESIZE_ATTEMPTS) {
      throw new Error(
        `Enterprise visual viewport resize failed: target=${width}x${height} actual_app=${actualApp.width}x${actualApp.height} actual_page=${actualPage.width}x${actualPage.height} after ${MAX_VIEWPORT_RESIZE_ATTEMPTS} attempts`
      )
    }
  }
}

// Spec-owned Update-ready dismissal. Targets the observed natural DOM:
// the Update ready notification is rendered as `role="status"` (NOT
// `role="dialog"`), the Notifications region is `role="region"` with
// `aria-label="Notifications"`, and the dismiss button's accessible name
// is the i18n string "Dismiss notification". No CSS hide, no DOM removal.
async function dismissTransientUpdateOverlay(page: Page): Promise<void> {
  const updateStatus = page.getByRole('status').filter({ hasText: 'Update ready' }).first()

  let visible = false

  try {
    visible = await updateStatus.isVisible({ timeout: 5_000 })
  } catch {
    visible = false
  }

  if (!visible) {
    return
  }

  // Observed natural DOM: the dismiss button has accessible name
  // "Dismiss notification" (i18n string). Click it and assert the
  // status is gone before screenshot.
  const dismissButton = page.getByRole('button', { name: 'Dismiss notification', exact: true }).first()

  await dismissButton.click({ timeout: 5_000 })
  await expect(updateStatus).not.toBeVisible({ timeout: 5_000 })
}

// Spec-owned bounded error-alert check. Replaces the generic
// installErrorBannerGuard afterEach for this spec; same semantics on
// error-kind notifications (which use role="alert"), but scoped to this
// suite and visible to the test report.
async function assertNoErrorAlert(page: Page): Promise<void> {
  const alerts = page.locator('[role="alert"]:visible')
  const count = await alerts.count()

  if (count > 0) {
    const texts: string[] = []

    for (let i = 0; i < count; i++) {
      const t = await alerts
        .nth(i)
        .innerText()
        .catch(() => '')

      if (t) {
        texts.push(t.trim())
      }
    }

    throw new Error(
      `Enterprise visual evidence detected [role="alert"] count=${count}\n` + texts.map(t => `  • ${t}`).join('\n')
    )
  }
}

// ─── Spec-local fixture ownership (REMEDIATION-04) ─────────────────────
// Each viewport test owns its Electron lifecycle end-to-end: create the
// fixture, navigate to the Enterprise dashboard, dismiss the transient
// overlay, prove + screenshot the viewport, then close the app BEFORE the
// test body returns. The finally-block cleanup is the fix for the ~300s
// post-screenshot stall: closing the Electron app closes its BrowserContext,
// which fix-electron-tracing.ts removes from electronContexts on close, so
// Playwright's didFinishTest no longer tries to finalise tracing on a live
// Electron context.
const VISUAL_TEST_TIMEOUT_MS = 120_000

async function setupEnterpriseVisualFixture(voiceAudioBase64?: string): Promise<MockBackendFixture> {
  const fixture = await setupMockBackend({
    // REM-03: do not pass `headless: true` so the renderer runs in a real
    // Xvfb-backed Chromium compositor instead of headless mode; the prior
    // headless flag interacted badly with the fixture window-state seed.
    initialWindowSize: { width: 1280, height: 720 },
    // REM-03: opt out of the generic installErrorBannerGuard; this spec
    // runs its own bounded role=alert assertion via assertNoErrorAlert.
    installErrorGuard: false,
    fakeMedia: Boolean(voiceAudioBase64)
  })

  // Electron's production handler registration completes while the first
  // BrowserWindow is being constructed. Installing our contract mock before
  // that point lets the production registration overwrite it, which makes the
  // renderer correctly fail closed but prevents this fixture from proving the
  // owned role UI. Replace the handler only after the window exists, then
  // reload so EnterpriseClientApp reconnects through the normal preload IPC
  // bridge. This remains renderer → preload → ipcMain evidence; no browser
  // fetch or renderer credential is introduced.
  await installEnterpriseEvidenceServer(fixture.app, voiceAudioBase64)
  await fixture.page.reload()

  // The owned EnterpriseClientApp is the product root. Do not navigate through
  // a generic Hermes sidebar button: that was the old visual authority.
  await expect(fixture.page.getByTestId('enterprise-client-root')).toBeVisible({ timeout: 15_000 })
  await expect(fixture.page.getByTestId('enterprise-client-workbench')).toBeVisible({ timeout: 15_000 })

  // Suppress the transient `Update ready` overlay before the viewport proof
  // begins, so the screenshot captures a notification-free baseline.
  await dismissTransientUpdateOverlay(fixture.page)

  return fixture
}

async function cleanupEnterpriseVisualFixture(fixture: MockBackendFixture | null, label: string): Promise<void> {
  if (!fixture) {
    return
  }

  // Authoritative natural-log marker: prove the Electron app (and its
  // BrowserContext) closes BEFORE the test body returns.

  console.log(`VISUAL_VIEWPORT_CLEANUP_START target=${label}`)
  await fixture.cleanup()

  console.log(`VISUAL_VIEWPORT_CLEANUP_DONE target=${label}`)
}

// Spec-local retries=0 (global CI retries stay 1) and a bounded per-test
// timeout. The global 300_000ms timeout is what previously masked the ~300s
// post-screenshot stall as a per-test timeout; REM-04 owns a 120s budget per
// test because each test now performs its own cold Electron launch + close.
test.describe.configure({ mode: 'serial', retries: 0, timeout: VISUAL_TEST_TIMEOUT_MS })

// One test per evidence viewport, each with its own fixture lifecycle. The
// four desktop targets remain active while the owned pixel baseline is under
// review, so a compact shell or a hidden Chinese navigation cannot slip in.
for (const { height, width } of EVIDENCE_VIEWPORTS) {
  test(`owned operator workbench has the Chinese product frame at ${width}x${height}`, async () => {
    let fixture: MockBackendFixture | null = null

    try {
      fixture = await setupEnterpriseVisualFixture()
      const { app, page } = fixture

      // Force the Electron window content size AND the Playwright page viewport
      // to the requested viewport with bounded retries. Throws on failure so
      // the test fails fast with target vs actual evidence instead of producing
      // a wrong-size PNG at a correct-size name.
      await applyViewportOrThrow(app, page, width, height)

      // Renderer-side confirmation that the innerWidth/innerHeight match the
      // requested viewport. This catches window-state restoration races that
      // BrowserWindow.getContentSize does not always observe.
      await expect
        .poll(() => page.evaluate(() => ({ height: window.innerHeight, width: window.innerWidth })))
        .toEqual({ height, width })

      await page.evaluate(async () => {
        await document.fonts.ready
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      })

      // Re-dismiss any notification that may have re-appeared before proving
      // the product frame.
      await dismissTransientUpdateOverlay(page)

      // Spec-owned role=alert check replaces the generic fixture-installed
      // afterEach guard for this spec only. Do not suppress real errors.
      await assertNoErrorAlert(page)

      // Authoritative natural-log viewport marker: prove dimensions and the
      // owned product frame before a reviewed pixel baseline exists.
      const readyActualApp = await app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0]
        const [w, h] = win ? win.getContentSize() : [0, 0]

        return { height: h, width: w }
      })

      const readyActualPage = await page.evaluate(() => ({
        height: window.innerHeight,
        width: window.innerWidth
      }))

      console.log(
        `VISUAL_VIEWPORT_READY target=${width}x${height} electron=${readyActualApp.width}x${readyActualApp.height} renderer=${readyActualPage.width}x${readyActualPage.height}`
      )

      const root = page.getByTestId('enterprise-client-root')
      await expect(root).toContainText('Hermes-企业助手')
      await expect(root).toContainText('企业工作台')
      await expect(root).toContainText('我的工作台')
      await expect(page.getByRole('navigation', { name: '企业客户端主导航' })).toContainText('工作台')
      await expect(page.getByRole('navigation', { name: '企业客户端主导航' })).toContainText('我的任务')
      await expect(page.getByRole('navigation', { name: '企业客户端主导航' })).toContainText('企业知识')
      await expect(page.getByRole('navigation', { name: '企业客户端主导航' })).toContainText('AI 助理')
      await expect(page.getByTestId('console-page-dashboard')).toHaveCount(0)
      await expect(page.getByText('Enterprise Console', { exact: true })).toHaveCount(0)

      // Actual rendered-window evidence. These identities and model labels are
      // visual fixtures only; they do not establish production authorization.
      await page.screenshot({ path: test.info().outputPath(`enterprise-workbench-${width}x${height}.png`) })
      await page.getByRole('button', { name: 'AI 助理', exact: true }).click()
      await expect(page.getByRole('heading', { name: '企业 AI 助理' })).toBeVisible()
      await expect(page.getByText('企业模型已就绪')).toBeVisible()
      await expect(page.getByRole('button', { name: '新增客户', exact: true })).toBeEnabled()
      await page.screenshot({ path: test.info().outputPath(`enterprise-assistant-${width}x${height}.png`) })

      if (width === 1280) {
        for (let customer = 1; customer < 100; customer++) {
          await page.getByRole('button', { name: '新增客户', exact: true }).click()
        }

        await expect(page.getByRole('group', { name: '正在处理的客户' }).getByRole('button')).toHaveCount(100)
        await page.getByLabel('搜索客户备注或编号').fill('客户 100')
        await expect(page.getByRole('group', { name: '正在处理的客户' }).getByRole('button')).toHaveCount(1)
        await page.screenshot({ path: test.info().outputPath('enterprise-customer-search-100.png') })
        await page.getByLabel('搜索客户备注或编号').fill('')
        await page.getByLabel('客户会话上下文').fill('第 100 位客户的独立上下文，刷新后应恢复。')
        await expect(page.getByText('草稿已保存到企业服务器', { exact: true })).toBeVisible()
        await page.reload()
        await page.getByRole('button', { name: 'AI 助理', exact: true }).click()
        await expect(page.getByText('已恢复服务器草稿', { exact: true })).toBeVisible()
        await expect(page.getByRole('group', { name: '正在处理的客户' }).getByRole('button')).toHaveCount(100)
        await expect(page.getByLabel('客户会话上下文')).toHaveValue('第 100 位客户的独立上下文，刷新后应恢复。')

        const voiceFacts = await page.evaluate(async () => {
          if (!('speechSynthesis' in window)) {
            return { available: false, voices: [] }
          }

          let voices = speechSynthesis.getVoices()

          if (!voices.length) {
            await new Promise<void>(resolve => {
              const timer = setTimeout(done, 2000)

              function done() {
                clearTimeout(timer)
                speechSynthesis.removeEventListener('voiceschanged', done)
                resolve()
              }

              speechSynthesis.addEventListener('voiceschanged', done)
            })
            voices = speechSynthesis.getVoices()
          }

          return {
            available: true,
            voices: voices
              .filter(voice => voice.localService && /^zh/i.test(voice.lang))
              .map(voice => ({ name: voice.name, lang: voice.lang }))
          }
        })

        console.log(`ENTERPRISE_LOCAL_SPEECH ${JSON.stringify(voiceFacts)}`)
      }

      console.log(`OWNED_ENTERPRISE_FRAME_READY target=${width}x${height}`)
    } finally {
      // Close the Electron app BEFORE the test body returns, even on failure.
      await cleanupEnterpriseVisualFixture(fixture, `${width}x${height}`)

      console.log(`VISUAL_VIEWPORT_TEST_COMPLETE target=${width}x${height}`)
    }
  })
}

test('enterprise voice uses real capture, editable knowledge questions and natural playback controls', async () => {
  const audioPath = process.env.ENTERPRISE_VOICE_EVIDENCE_AUDIO
  test.skip(
    !audioPath,
    'Provide a non-sensitive MP3 through ENTERPRISE_VOICE_EVIDENCE_AUDIO for decoded playback evidence.'
  )
  let fixture: MockBackendFixture | null = null

  try {
    fixture = await setupEnterpriseVisualFixture(readFileSync(audioPath!).toString('base64'))
    const { app, page } = fixture
    await applyViewportOrThrow(app, page, 1440, 900)
    await page.getByRole('button', { name: 'AI 助理', exact: true }).click()
    await page.getByRole('button', { name: /知识库问答/ }).click()
    await expect(page.getByLabel('音色').locator('option')).toHaveCount(6)
    await expect(page.getByLabel('音色').locator('option').filter({ hasText: '女声' })).toHaveCount(3)
    await expect(page.getByLabel('音色').locator('option').filter({ hasText: '男声' })).toHaveCount(3)
    await page.getByLabel('音色').selectOption('zh-CN-YunxiNeural')
    await page.getByLabel('语音风格').selectOption('customerservice')
    await page.getByLabel('语速').selectOption('0.85')
    await page.getByRole('button', { name: '语音输入', exact: true }).click()
    await expect(page.getByRole('button', { name: '结束录音并识别' })).toBeVisible()
    await expect(page.getByLabel('麦克风音量')).toBeVisible()
    await expect(page.getByRole('button', { name: '试听音色' })).toBeDisabled()
    // Wait for the displayed recorder timer, not a synthetic transcript injection.
    await expect(page.getByText('1 秒 / 120 秒', { exact: true })).toBeVisible({ timeout: 5000 })
    await page.screenshot({ path: test.info().outputPath('enterprise-voice-recording-1440x900.png') })
    await page.getByRole('button', { name: '结束录音并识别' }).click()
    await expect(page.getByLabel('输入内容')).toHaveValue('退款需要准备哪些资料')
    await page.getByLabel('输入内容').fill('退款需要准备哪些资料？请依据公司售后规范回答。')
    await page.getByRole('button', { name: '提交处理', exact: true }).click()
    await expect(page.getByRole('heading', { name: '退款资料' })).toBeVisible()
    await expect(page.getByRole('button', { name: '停止朗读' })).toBeVisible()
    await expect(page.getByRole('heading', { name: '企业 AI 助理', exact: true })).toBeInViewport()
    await expect(page.getByText('依据企业售后知识库，核实资料后由坐席确认回复。')).toBeInViewport()
    await page.screenshot({ path: test.info().outputPath('enterprise-voice-answer-1440x900.png') })
    await page.getByRole('button', { name: '停止朗读' }).click()
    await expect(page.getByRole('button', { name: '停止朗读' })).toHaveCount(0)

    const calls = await app.evaluate(
      () => (globalThis as unknown as { enterpriseVoiceEvidence: VoiceEvidenceCall[] }).enterpriseVoiceEvidence
    )

    expect(calls.find(call => call.path === '/api/tenant-voice-transcribe')?.bytes).toBeGreaterThan(0)
    expect(calls.find(call => call.path === '/api/tenant-ai-assist')).toMatchObject({
      content: '退款需要准备哪些资料？请依据公司售后规范回答。',
      mode: 'knowledge_question'
    })
    expect(calls.find(call => call.path === '/api/tenant-speech-synthesize')).toMatchObject({
      voice: 'zh-CN-YunxiNeural',
      style: 'customerservice',
      speed: 0.85
    })
    const exportedAnswer = test.info().outputPath('enterprise-answer-export.md')
    await app.evaluate(({ session }, savePath) => {
      session.defaultSession.once('will-download', (_event: unknown, item: DownloadItem) => {
        item.setSavePath(savePath)
        item.once('done', (_doneEvent: unknown, state: string) => {
          ;(globalThis as unknown as { enterpriseAnswerDownloadState: string }).enterpriseAnswerDownloadState = state
        })
      })
    }, exportedAnswer)
    await page.getByRole('button', { name: '保存为 Markdown', exact: true }).click()
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { enterpriseAnswerDownloadState?: string }).enterpriseAnswerDownloadState)).toBe('completed')
    const savedAnswer = readFileSync(exportedAnswer, 'utf8')
    expect(savedAnswer).toContain('### 退款资料')
    expect(savedAnswer).toContain('**订单号**')
    expect(savedAnswer).not.toContain('退款需要准备哪些资料？')
    await page.getByLabel('音色').selectOption('zh-CN-XiaoxiaoNeural')
    await page.getByLabel('语音风格').selectOption('gentle')
    await page.getByLabel('语速').selectOption('1.2')
    await page.getByRole('button', { name: '试听音色' }).click()
    await expect(page.getByRole('button', { name: '停止朗读' })).toBeVisible()
    await expect(page.getByRole('button', { name: '停止朗读' })).toHaveCount(0, { timeout: 20_000 })
    await expect(page.getByText(/自然语音暂不可用/)).toHaveCount(0)
    await page.reload()
    await page.getByRole('button', { name: 'AI 助理', exact: true }).click()
    await page.getByRole('button', { name: /知识库问答/ }).click()
    await expect(page.getByLabel('音色')).toHaveValue('zh-CN-XiaoxiaoNeural')
    await expect(page.getByLabel('语音风格')).toHaveValue('gentle')
    await expect(page.getByLabel('语速')).toHaveValue('1.2')
    await page.getByLabel('语音风格').selectOption('chat')
    await page.screenshot({ path: test.info().outputPath('enterprise-voice-preferences-1440x900.png') })
    await assertNoErrorAlert(page)
  } finally {
    await cleanupEnterpriseVisualFixture(fixture, 'voice')
  }
})

test('enterprise login has a readable native entry at desktop and narrow sizes', async () => {
  let fixture: MockBackendFixture | null = null

  try {
    fixture = await setupEnterpriseVisualFixture()
    await fixture.app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('hermes:enterprise:auto-connect')
      ipcMain.handle('hermes:enterprise:auto-connect', () => ({ ok: false }))
    })
    await fixture.page.reload()
    await expect(fixture.page.getByRole('heading', { name: '登录企业账号' })).toBeVisible()

    for (const size of [
      { width: 1440, height: 900 },
      { width: 800, height: 720 }
    ]) {
      await applyViewportOrThrow(fixture.app, fixture.page, size.width, size.height)
      await fixture.page.evaluate(() => document.fonts.ready)
      await expect(fixture.page.getByLabel('登录账号')).toBeVisible()
      await expect(fixture.page.getByLabel('登录密码')).toBeVisible()
      await fixture.page.screenshot({
        path: test.info().outputPath(`enterprise-login-${size.width}x${size.height}.png`)
      })
    }
  } finally {
    await cleanupEnterpriseVisualFixture(fixture, 'login')
  }
})
