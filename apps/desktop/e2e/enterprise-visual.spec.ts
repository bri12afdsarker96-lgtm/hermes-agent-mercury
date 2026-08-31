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
 *
 * REMEDIATION-02 edits (scope: harness-only):
 *   1. Deterministic viewport application: bounded retry (max 3) of setBounds
 *      and setContentSize, with an explicit throw on failure reporting
 *      target vs actual window.innerWidth/innerHeight. The screenshot is
 *      never taken when the inner size does not match the target.
 *   2. Update-notification suppression: the transient `Update ready`
 *      overlay can appear above the Enterprise route during cold-boot.
 *      We dismiss it via the existing Radix dialog close button (the same
 *      `aria-label="Close"` the dialog renders by default) and then assert
 *      that no open dialog with the `Update ready` title remains. No CSS
 *      hide, no DOM removal, no product source change.
 */

import { type ElectronApplication, type Page } from '@playwright/test'

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

// Default viewport set (all four enabled).
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
  height: number,
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
        await new Promise<void>((resolve) => setTimeout(resolve, 100))
      },
      { height, width },
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
      width: window.innerWidth,
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
        `Enterprise visual viewport resize failed: target=${width}x${height} actual_app=${actualApp.width}x${actualApp.height} actual_page=${actualPage.width}x${actualPage.height} after ${MAX_VIEWPORT_RESIZE_ATTEMPTS} attempts`,
      )
    }
  }
}

// Pre-screenshot cleanup: dismiss any transient Update-ready notification that
// might overlay the Enterprise route during cold-boot. Uses the existing Radix
// dialog close button (aria-label="Close"); no CSS hide, no DOM removal, no
// product source change. Bounded timeout keeps the test deterministic.
async function dismissTransientUpdateOverlay(page: Page): Promise<void> {
  const updateTitle = page.getByRole('dialog').filter({ hasText: 'Update ready' }).first()
  let visible = false
  try {
    visible = await updateTitle.isVisible({ timeout: 5_000 })
  } catch {
    visible = false
  }
  if (!visible) {
    return
  }
  // The Radix dialog primitive renders a default close button with
  // aria-label="Close". Click it instead of relying on Escape, because
  // Escape can race against the dialog open animation on cold boot.
  const closeButton = page.getByRole('button', { name: 'Close', exact: true }).first()
  await closeButton.click({ timeout: 5_000 })
  // Assert the update overlay is absent before any screenshot.
  await expect(updateTitle).not.toBeVisible({ timeout: 5_000 })
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

  // Suppress the transient `Update ready` overlay before any viewport proof
  // begins, so the four viewports share the same notification-free baseline.
  await dismissTransientUpdateOverlay(fixture.page)
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

    // Force the Electron window content size AND the Playwright page viewport
    // to the requested viewport with bounded retries. Throws on failure so
    // the test fails fast with target vs actual evidence instead of producing
    // a 1220x800 PNG at a 1280x720 name.
    await applyViewportOrThrow(app, page, width, height)

    // Renderer-side confirmation that the innerWidth/innerHeight match the
    // requested viewport. This catches window-state restoration races that
    // BrowserWindow.getContentSize does not always observe.
    await expect
      .poll(() => page.evaluate(() => ({ height: window.innerHeight, width: window.innerWidth })))
      .toEqual({ height, width })

    await page.evaluate(async () => {
      await document.fonts.ready
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      )
    })

    // Re-dismiss any notification that may have re-appeared (defence in depth;
    // bounded so the screenshot is never silently skipped if the overlay is
    // stuck on screen).
    await dismissTransientUpdateOverlay(page)

    await expect(page).toHaveScreenshot(`enterprise-operator-home-${width}x${height}.png`, {
      animations: 'disabled',
      caret: 'hide',
      timeout: 30_000,
    })
  })
}
