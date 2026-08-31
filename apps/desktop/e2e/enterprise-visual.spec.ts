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
 * REMEDIATION-03 edits (scope: harness-only):
 *   1. Lifecycle cap: per-test timeout 60_000 ms (was the implicit 300_000 ms
 *      global); CI retries 0 (set in this file's test.describe.configure).
 *   2. Request initial fixture window size 1280x720 (was the prior 1220x800
 *      fixture seed). The dedicated visual harness owns its initial Electron
 *      window size so the per-test resize no longer fights a different
 *      Electron-side state.json.
 *   3. Opt out of the generic `installErrorBannerGuard` afterEach (the spec
 *      owns its own bounded role=alert assertion).
 *   4. Fix the Update-ready dismiss locator against the observed natural
 *      DOM (`role="status"` containing "Update ready"; dismiss button
 *      accessible name "Dismiss notification"). Do not use `role="dialog"`.
 *   5. Print deterministic viewport+log markers before screenshot so the
 *      natural job log itself proves dimensions and screenshot success.
 *
 * No product source / test.ts / playwright.config.ts / fixtures beyond the
 * two `MockBackendOptions`-threaded additions / workflow touched.
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

// Spec-owned Update-ready dismissal. Targets the observed natural DOM:
// the Update ready notification is rendered as `role="status"` (NOT
// `role="dialog"`), the Notifications region is `role="region"` with
// `aria-label="Notifications"`, and the dismiss button's accessible name
// is the i18n string "Dismiss notification". No CSS hide, no DOM removal.
async function dismissTransientUpdateOverlay(page: Page): Promise<void> {
  const updateStatus = page
    .getByRole('status')
    .filter({ hasText: 'Update ready' })
    .first()
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
  const dismissButton = page
    .getByRole('button', { name: 'Dismiss notification', exact: true })
    .first()
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
      const t = await alerts.nth(i).innerText().catch(() => '')
      if (t) texts.push(t.trim())
    }
    throw new Error(
      `Enterprise visual evidence detected [role="alert"] count=${count}\n` +
        texts.map(t => `  • ${t}`).join('\n'),
    )
  }
}

let fixture: MockBackendFixture | null = null

// Per-test timeout cap (60s). PR29 implicit 300s global produced
// ~300s spacing per failed viewport; REM-03 caps this at 60s per test so
// any lifecycle stall fails fast instead of consuming the 15-min job
// budget. CI retries disabled for this spec.
test.setTimeout(60_000)

test.beforeAll(async () => {
  test.setTimeout(180_000)
  fixture = await setupMockBackend({
    beforeFirstWindow: installEnterpriseEvidenceServer,
    // REM-03: do not pass `headless: true` so the renderer runs in a real
    // Xvfb-backed Chromium compositor instead of headless mode; the prior
    // headless flag interacted badly with the fixture window-state seed.
    initialWindowSize: { width: 1280, height: 720 },
    // REM-03: opt out of the generic installErrorBannerGuard; this spec
    // runs its own bounded role=alert assertion via assertNoErrorAlert.
    installErrorGuard: false,
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
test.describe.configure({ mode: 'serial' })

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

    // Spec-owned role=alert check replaces the generic fixture-installed
    // afterEach guard for this spec only. Do not suppress real errors.
    await assertNoErrorAlert(page)

    // Authoritative natural-log viewport marker: prove dimensions BEFORE
    // screenshot so the GitHub job log itself proves the readiness state.
    const readyActualApp = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      const [w, h] = win ? win.getContentSize() : [0, 0]
      return { height: h, width: w }
    })
    const readyActualPage = await page.evaluate(() => ({
      height: window.innerHeight,
      width: window.innerWidth,
    }))
    // eslint-disable-next-line no-console
    console.log(
      `VISUAL_VIEWPORT_READY target=${width}x${height} electron=${readyActualApp.width}x${readyActualApp.height} renderer=${readyActualPage.width}x${readyActualPage.height}`,
    )

    await expect(page).toHaveScreenshot(`enterprise-operator-home-${width}x${height}.png`, {
      animations: 'disabled',
      caret: 'hide',
      timeout: 30_000,
    })

    // eslint-disable-next-line no-console
    console.log(`VISUAL_VIEWPORT_SCREENSHOT_PASS target=${width}x${height}`)
  })
}
