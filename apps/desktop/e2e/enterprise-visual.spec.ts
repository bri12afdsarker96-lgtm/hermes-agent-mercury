/**
 * Enterprise Console visual evidence.
 *
 * This stays inside the real Electron shell and exercises the production
 * preload → IPC transport → session FSM → eligibility → plugin route chain.
 * Only the remote Enterprise server is deterministic: the test process owns
 * the IPC replies, exactly like the existing mock inference server owns its
 * provider replies. No bearer, renderer login, second shell, or production
 * authority is introduced.
 *
 * Unlike the legacy soft visual helper, these assertions are hard gates:
 * a missing baseline or a pixel diff fails the test. Refresh intentionally via
 * `npx playwright test e2e/enterprise-visual.spec.ts --update-snapshots`.
 * The Linux baselines were committed only after the first hard missing-baseline
 * run produced all four actuals and those exact actuals were manually reviewed.
 */

import { type ElectronApplication } from '@playwright/test'

import { type MockBackendFixture, setupMockBackend } from './fixtures'
import { expect, test } from './test'

const ENTERPRISE_SESSION_ID = 'enterprise-visual-session'

const ENTERPRISE_RESPONSES = {
  '/api/health': { auth_mode: 'native_bearer', ok: true },
  '/api/metrics?window=24h': {
    alerts: [
      {
        code: 'QUEUE_LATENCY',
        level: 'warning',
        message: 'Queue latency above the review threshold',
        threshold: 120,
        value: 148,
      },
    ],
  },
  '/api/whoami': {
    capability_revision: 42,
    data_scope: { mode: 'tenant', scopes: ['tenant:acme-logistics'] },
    effective_permissions: ['*'],
    name: 'Lin Qiao',
    principal_id: 'principal-operator-042',
    product_capabilities: {
      audit_export: { enabled: false, status: 'CONTRACT' },
      enterprise_chat: { enabled: true, status: 'LIVE' },
      knowledge_rag: { enabled: true, status: 'LIVE' },
      wecom_delivery: { enabled: false, status: 'DEV' },
    },
    role: 'operator',
    tenant_id: 'tenant-acme-logistics',
  },
} as const

const EVIDENCE_VIEWPORTS = [
  { height: 720, width: 1280 },
  { height: 900, width: 1440 },
  { height: 941, width: 1672 },
  { height: 1080, width: 1920 },
] as const

async function installEnterpriseEvidenceServer(app: ElectronApplication): Promise<void> {
  await app.evaluate(
    ({ ipcMain }, fixture) => {
      for (const channel of [
        'hermes:enterprise:auto-connect',
        'hermes:enterprise:disconnect',
        'hermes:enterprise:request',
        'hermes:enterprise:upload',
      ]) {
        ipcMain.removeHandler(channel)
      }

      ipcMain.handle('hermes:enterprise:auto-connect', () => ({
        baseUrl: 'http://127.0.0.1:49152',
        ok: true,
        sessionId: fixture.sessionId,
      }))
      ipcMain.handle('hermes:enterprise:disconnect', () => ({ ok: true }))
      ipcMain.handle(
        'hermes:enterprise:request',
        (_event: unknown, request: { path?: string; sessionId?: string }) => {
          if (request?.sessionId !== fixture.sessionId) {
            return { code: 'network', kind: 'error', message: 'not connected', status: 0 }
          }

          const data = fixture.responses[request?.path as keyof typeof fixture.responses]

          return data === undefined
            ? { code: 'http', kind: 'error', message: 'fixture endpoint not defined', status: 404 }
            : { data, kind: 'ok' }
        },
      )
      ipcMain.handle('hermes:enterprise:upload', () => ({
        code: 'http',
        kind: 'error',
        message: 'uploads are outside visual evidence',
        status: 405,
      }))
    },
    { responses: ENTERPRISE_RESPONSES, sessionId: ENTERPRISE_SESSION_ID },
  )
}

async function setContentViewport(
  app: ElectronApplication,
  width: number,
  height: number,
): Promise<void> {
  // Use setBounds rather than setContentSize: on cold CI runners the
  // restored main-window size (DEFAULT_WIDTH=1220 / DEFAULT_HEIGHT=800
  // from window-state.ts) ignores setContentSize when the window is
  // already at its minimum, leaving the renderer at the default 1220×800
  // instead of the requested viewport. setBounds forces the OS-level
  // window resize; the renderer then reports innerWidth/Height matching
  // the requested viewport, which the spec's `expect.poll` will then
  // match. The trailing wait gives the renderer one paint frame to
  // relayout before the screenshot.
  await app.evaluate(
    ({ BrowserWindow }, size) => {
      const win = BrowserWindow.getAllWindows()[0]

      if (!win) {
        throw new Error('Enterprise visual evidence window is unavailable')
      }

      win.unmaximize()
      win.setMinimumSize(640, 480)
      win.setBounds({ x: 0, y: 0, width: size.width, height: size.height })
    },
    { height, width },
  )
  // Give the renderer one paint frame after the OS-level resize.
  await new Promise(resolve => setTimeout(resolve, 250))
}

let fixture: MockBackendFixture | null = null

test.beforeAll(async () => {
  test.setTimeout(180_000)
  fixture = await setupMockBackend({
    beforeFirstWindow: installEnterpriseEvidenceServer,
    headless: true,
  })

  // This evidence route is not the chat composer. Generic waitForAppReady waits
  // for gateway-backed chat readiness and can time out after the Enterprise
  // navigation is already usable. Gate on the exact real shell → Enterprise
  // route → dashboard seam that this test actually exercises.
  const enterpriseNav = fixture.page.getByRole('button', { name: 'Enterprise', exact: true })
  await expect(enterpriseNav).toBeVisible({ timeout: 15_000 })
  await enterpriseNav.click()
  await expect(fixture.page.getByTestId('console-page-dashboard')).toBeVisible({ timeout: 15_000 })
})

test.afterAll(async () => {
  await fixture?.cleanup()
  fixture = null
})

// One test per evidence viewport. Originally these were a single
// serialised test that ran all four viewports inside one test body, which
// exceeded any single-test timeout on cold CI runners (each viewport
// costs ~1 minute of real wall-clock — 4 viewports serialised ≈ 4
// minutes, well past even 5-minute test timeouts). Splitting into four
// independent tests means each one fits comfortably under the default
// 90_000ms test timeout, and a single-viewport regression points at
// the exact viewport that broke without a binary search through a
// shared test body.
//
// The four baselines already exist (commit 8d39946903 / 2c07f6762
// from W5 foundation work) and Playwright locates them by
// `<test-title>-<snapshot-name>-<platform>.png`. Because every test
// uses the same snapshot name (`enterprise-operator-home-${w}x${h}.png`),
// each test gets a UNIQUE title so the four baselines are matched
// 1:1 against the four tests.
for (const { height, width } of EVIDENCE_VIEWPORTS) {
  test(`operator home has hard visual baseline at ${width}x${height}`, async () => {
    const { app, page } = fixture!

    await setContentViewport(app, width, height)
    await expect
      .poll(() => page.evaluate(() => ({ height: window.innerHeight, width: window.innerWidth })))
      .toEqual({ height, width })
    await page.evaluate(async () => {
      await document.fonts.ready
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      )
    })

    await expect(page).toHaveScreenshot(`enterprise-operator-home-${width}x${height}.png`, {
      animations: 'disabled',
      caret: 'hide',
      timeout: 30_000,
    })
  })
}
