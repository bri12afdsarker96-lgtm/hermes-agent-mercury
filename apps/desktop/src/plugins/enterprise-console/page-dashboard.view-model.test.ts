/**
 * Tests for `page-dashboard.view-model.ts` (W1-B1 Dashboard split).
 *
 * Pure-function tests: no React, no transport, no mocks. We pass
 * fabricated server answers (Health, Metrics, Whoami, ConsolePage) and
 * assert the composed view-model shape.
 *
 * What this suite proves:
 *   1. The view-model faithfully mirrors server truth — no fabricated
 *      KPI fields, no invented roles.
 *   2. The shared VM delegation (`deriveCommonViewModel`) is preserved.
 *   3. The capability chip status only reflects server runtime
 *      capability, not page.status.
 *   4. Null whoami produces a coherent VM with `liveCapabilityCount = 0`,
 *      `hasNoCapabilities = true`, and `whoami = null`. No fake session.
 *   5. workspaceCopy resolves role-declared titles for the 3 known roles
 *      and falls back to "Workspace" for unknown / missing.
 */

import { describe, expect, it } from 'vitest'

import { type ConsolePage, findPage } from './catalog'
import {
  countSourceErrors,
  dashboardPage,
  deriveAlertsSummary,
  deriveDashboardViewModel,
  workspaceCopy,
} from './page-dashboard.view-model'
import type { Health, MetricAlert, Metrics, Whoami } from './types'

const baseHealth: Health = {
  auth_mode: 'native_bearer',
  ok: true,
}

const baseMetrics: Metrics = {
  alerts: [],
  errors: {},
}

/**
 * Test-only cast helper. The frozen `types.ts::Metrics.errors` is
 * declared as `Record<string, number>` (stale — it predates the
 * real server contract). REMEDIATION-01 §8 forbids touching
 * `types.ts` from C, so we accept the loose type at the test
 * boundary and cast the real nullable-string runtime shape down to
 * what the page-dashboard view-model accepts.
 *
 * In production code, `deriveAlertsSummary` and `countSourceErrors`
 * normalize the shape themselves; here we only need to satisfy the
 * frozen Metrics type for the `metrics` input.
 */
function asMetrics(value: {
  alerts: ReadonlyArray<MetricAlert>
  errors: unknown
}): Metrics {
  return value as unknown as Metrics
}

const operatorWhoami: Whoami = {
  capability_revision: 1,
  data_scope: { mode: 'tenant', scopes: ['tenant:acme'] },
  effective_permissions: ['*'],
  name: 'Lin Qiao',
  principal_id: 'principal-1',
  product_capabilities: {
    metrics: { enabled: true, status: 'LIVE' },
    knowledge_rag: { enabled: true, status: 'DEV' },
    audit_export: { enabled: false, status: 'CONTRACT' },
  },
  role: 'operator',
  tenant_id: 'tenant-acme',
}

describe('deriveDashboardViewModel', () => {
  const page = dashboardPage()

  it('exposes dashboard page-status fields', () => {
    const vm = deriveDashboardViewModel({
      page,
      whoami: operatorWhoami,
      health: baseHealth,
      healthPending: false,
      healthError: null,
      metrics: baseMetrics,
      metricsPending: false,
      metricsError: null,
    })

    expect(vm.pageStatus).toBe('ready')
    expect(vm.isReady).toBe(true)
    expect(vm.isPartial).toBe(false)
    expect(vm.isBlocked).toBe(false)
    expect(vm.isReadyDev).toBe(false)
  })

  it('workspace title and purpose follow whoami.role', () => {
    const vm = deriveDashboardViewModel({
      page,
      whoami: operatorWhoami,
      health: baseHealth,
      healthPending: false,
      healthError: null,
      metrics: baseMetrics,
      metricsPending: false,
      metricsError: null,
    })

    expect(vm.workspace.title).toBe('Operator Home')
    expect(vm.workspace.purpose).toContain('authenticated operational workspace')
  })

  it('liveCapabilityCount counts only LIVE + enabled', () => {
    const vm = deriveDashboardViewModel({
      page,
      whoami: operatorWhoami,
      health: baseHealth,
      healthPending: false,
      healthError: null,
      metrics: baseMetrics,
      metricsPending: false,
      metricsError: null,
    })

    // operatorWhoami has metrics(LIVE+enabled), knowledge_rag(DEV), audit_export(CONTRACT, disabled)
    expect(vm.liveCapabilityCount).toBe(1)
  })

  it('capability chip status is server-only (never page.status fallback)', () => {
    const vmWithName = deriveDashboardViewModel({
      page,
      whoami: operatorWhoami,
      health: baseHealth,
      healthPending: false,
      healthError: null,
      metrics: baseMetrics,
      metricsPending: false,
      metricsError: null,
      capabilityName: 'metrics',
    })

    expect(vmWithName.capabilityStatus).toBe('LIVE')

    const vmNoMatch = deriveDashboardViewModel({
      page,
      whoami: operatorWhoami,
      health: baseHealth,
      healthPending: false,
      healthError: null,
      metrics: baseMetrics,
      metricsPending: false,
      metricsError: null,
      capabilityName: 'unknown_capability',
    })

    // Server has no entry for `unknown_capability` → null (no page.status fallback)
    expect(vmNoMatch.capabilityStatus).toBe(null)
  })

  it('null whoami → liveCapabilityCount = 0, hasNoCapabilities = true', () => {
    const vm = deriveDashboardViewModel({
      page,
      whoami: null,
      health: baseHealth,
      healthPending: false,
      healthError: null,
      metrics: baseMetrics,
      metricsPending: false,
      metricsError: null,
    })

    expect(vm.liveCapabilityCount).toBe(0)
    expect(vm.hasNoCapabilities).toBe(true)
    expect(vm.whoami).toBe(null)
    expect(vm.capabilityEntries).toEqual([])
    // workspaceCopy(null) returns the default branch
    expect(vm.workspace.title).toBe('Workspace')
  })

  it('activeAlerts mirrors server metrics.alerts without fabrication', () => {
    const metricsWithAlerts: Metrics = {
      alerts: [
        { code: 'QUEUE_LATENCY', level: 'warn', message: 'queue latency above threshold' },
      ],
      errors: {},
    }

    const vm = deriveDashboardViewModel({
      page,
      whoami: operatorWhoami,
      health: baseHealth,
      healthPending: false,
      healthError: null,
      metrics: metricsWithAlerts,
      metricsPending: false,
      metricsError: null,
    })

    expect(vm.activeAlerts).toHaveLength(1)
    expect(vm.activeAlerts[0]).toEqual({
      code: 'QUEUE_LATENCY',
      level: 'warn',
      message: 'queue latency above threshold',
    })
  })

  it('healthError / metricsError surface as message strings (no fabrication)', () => {
    const vm = deriveDashboardViewModel({
      page,
      whoami: operatorWhoami,
      health: null,
      healthPending: false,
      healthError: new Error('boom health'),
      metrics: null,
      metricsPending: false,
      metricsError: new Error('boom metrics'),
    })

    expect(vm.healthError).toBe('boom health')
    expect(vm.metricsError).toBe('boom metrics')
  })

  it('non-Error thrown values do not crash the VM', () => {
    const vm = deriveDashboardViewModel({
      page,
      whoami: operatorWhoami,
      health: null,
      healthPending: false,
      healthError: 'string error',
      metrics: null,
      metricsPending: false,
      metricsError: 42,
    })

    expect(vm.healthError).toBe(null) // non-Error → null, no fabricated string
    expect(vm.metricsError).toBe(null)
  })

  it('respects the catalog permission gate via deriveCommonViewModel', () => {
    const usagePage = findPage('usage') as ConsolePage // partial / different

    const vm = deriveDashboardViewModel({
      page: usagePage,
      whoami: operatorWhoami,
      health: baseHealth,
      healthPending: false,
      healthError: null,
      metrics: baseMetrics,
      metricsPending: false,
      metricsError: null,
    })

    expect(vm.isPartial).toBe(true)
    expect(vm.readOnlyReason).not.toBe(null)
  })
})

describe('workspaceCopy (view-model helper)', () => {
  it('operator → Operator Home', () => {
    expect(workspaceCopy(operatorWhoami).title).toBe('Operator Home')
  })

  it('supervisor → Supervisor Workspace', () => {
    expect(workspaceCopy({ ...operatorWhoami, role: 'supervisor' }).title).toBe('Supervisor Workspace')
  })

  it('tenant_admin / super_admin → Tenant Admin Overview', () => {
    expect(workspaceCopy({ ...operatorWhoami, role: 'tenant_admin' }).title).toBe('Tenant Admin Overview')
    expect(workspaceCopy({ ...operatorWhoami, role: 'super_admin' }).title).toBe('Tenant Admin Overview')
  })

  it('unknown / null → Workspace', () => {
    expect(workspaceCopy({ ...operatorWhoami, role: 'intern' }).title).toBe('Workspace')
    expect(workspaceCopy(null).title).toBe('Workspace')
  })
})

/**
 * Phase-1.5 Alerts Summary — pure derivation tests (REMEDIATION-01).
 *
 * CORE TRUTH GUARDS (from TOTAL-CONTROL §15–§23):
 *   - "NO DATA != ZERO ALERTS"
 *   - "ERROR MAP KEYS != ACTUAL SOURCE ERRORS"
 *
 * Coverage:
 *   - state precedence per §12 (permission > loading > error >
 *     null-payload > source-errors > available-alerts > available-empty)
 *   - countSourceErrors honors the real server runtime shape
 *     `{ audit: string|null, inbox: string|null, kbgaps: string|null }`
 *     (REMEDIATION-01 §6, §15, §16)
 *   - alert level derivation narrows to exactly `'crit'` / `'warn'`
 *     (REMEDIATION-01 §14)
 *   - raw alerts with zero recognized crit/warn still yield
 *     `available-alerts`, never `available-empty` (§14)
 *   - the previous "metrics=null → available-empty" contract is
 *     REMOVED (REMEDIATION-01 §9)
 */
describe('countSourceErrors (REMEDIATION-01 §7, §15, §16)', () => {
  it('healthy server runtime shape: null entries are NOT errors', () => {
    // The actual contract: a healthy server returns three keys with
    // `null` values, NOT three source errors.
    expect(countSourceErrors({ audit: null, inbox: null, kbgaps: null })).toBe(0)
  })

  it('absent / empty errors map → 0', () => {
    expect(countSourceErrors({})).toBe(0)
    expect(countSourceErrors(undefined)).toBe(0)
  })

  it('non-null error string on one source → 1', () => {
    expect(countSourceErrors({ audit: 'missing', inbox: null, kbgaps: null })).toBe(1)
  })

  it('non-null error strings on two sources → 2', () => {
    expect(
      countSourceErrors({
        audit: 'bad_lines=4',
        inbox: 'busy',
        kbgaps: null,
      })
    ).toBe(2)
  })

  it('empty-string value is NOT an error (defensive)', () => {
    expect(countSourceErrors({ audit: '', inbox: null, kbgaps: null })).toBe(0)
  })

  it('non-object input → 0', () => {
    expect(countSourceErrors(null)).toBe(0)
    expect(countSourceErrors('not-an-object')).toBe(0)
    expect(countSourceErrors(42)).toBe(0)
  })

  it('malformed (non-null non-string) value is treated as degraded', () => {
    // Legacy / stale server payload may still emit numbers under
    // `errors` per the frozen `Record<string, number>` type. Surface
    // those as a single degraded signal rather than silently healthy.
    expect(countSourceErrors({ audit: 17, inbox: null, kbgaps: null })).toBe(1)
  })
})

describe('deriveAlertsSummary — state precedence (REMEDIATION-01 §12)', () => {
  it('!canRead → permission-unavailable, all counts=null', () => {
    const s = deriveAlertsSummary({
      canRead: false,
      metrics: { alerts: [{ code: 'A', level: 'crit', message: 'x' }], errors: {} },
      metricsError: null,
      metricsPending: false,
    })

    expect(s.state).toBe('permission-unavailable')
    expect(s.critical).toBeNull()
    expect(s.warning).toBeNull()
    expect(s.sourceErrors).toBeNull()
    expect(s.rawAlertCount).toBeNull()
    expect(s.unclassifiedAlertCount).toBeNull()
  })

  it('pending=true → loading, all counts=null', () => {
    const s = deriveAlertsSummary({
      canRead: true,
      metrics: null,
      metricsError: null,
      metricsPending: true,
    })

    expect(s.state).toBe('loading')
    expect(s.critical).toBeNull()
    expect(s.warning).toBeNull()
    expect(s.sourceErrors).toBeNull()
  })

  it('metricsError → server-unavailable, all counts=null', () => {
    const s = deriveAlertsSummary({
      canRead: true,
      metrics: null,
      metricsError: 'boom metrics',
      metricsPending: false,
    })

    expect(s.state).toBe('server-unavailable')
    expect(s.critical).toBeNull()
    expect(s.warning).toBeNull()
    expect(s.sourceErrors).toBeNull()
  })

  it('metrics=null with no pending and no error → server-unavailable, NOT available-empty', () => {
    // REMEDIATION-01 §9 BLOCKER — previously this became available-empty,
    // which fabricated a zero answer for a question the server never
    // answered. It MUST be server-unavailable now.
    const s = deriveAlertsSummary({
      canRead: true,
      metrics: null,
      metricsError: null,
      metricsPending: false,
    })

    expect(s.state).toBe('server-unavailable')
    expect(s.state).not.toBe('available-empty')
    expect(s.critical).toBeNull()
    expect(s.warning).toBeNull()
    expect(s.sourceErrors).toBeNull()
  })

  it('healthy real payload: errors all null → available-empty with 0/0/0', () => {
    // REMEDIATION-01 §18 — the ACTUAL empty payload is the one that
    // carries three null-valued source entries.
    const s = deriveAlertsSummary({
      canRead: true,
      metrics: asMetrics({ alerts: [], errors: { audit: null, inbox: null, kbgaps: null } }),
      metricsError: null,
      metricsPending: false,
    })

    expect(s.state).toBe('available-empty')
    expect(s.critical).toBe(0)
    expect(s.warning).toBe(0)
    expect(s.sourceErrors).toBe(0)
    expect(s.rawAlertCount).toBe(0)
    expect(s.unclassifiedAlertCount).toBe(0)
  })

  it('alerts-only (crit+warn) → available-alerts with separated counts', () => {
    // REMEDIATION-01 §19 — 2 crit + 1 warn, source data clean.
    const s = deriveAlertsSummary({
      canRead: true,
      metrics: {
        alerts: [
          { code: 'A', level: 'crit', message: 'a' },
          { code: 'B', level: 'crit', message: 'b' },
          { code: 'C', level: 'warn', message: 'c' },
        ],
        errors: { audit: null, inbox: null, kbgaps: null } as unknown as Record<string, number>,
      },
      metricsError: null,
      metricsPending: false,
    })

    expect(s.state).toBe('available-alerts')
    expect(s.critical).toBe(2)
    expect(s.warning).toBe(1)
    expect(s.sourceErrors).toBe(0)
    expect(s.rawAlertCount).toBe(3)
    expect(s.unclassifiedAlertCount).toBe(0)
  })

  it('mixed degraded payload → source-errors with counts retained', () => {
    // REMEDIATION-01 §20 — alerts (2 crit + 1 warn) + 2 source
    // errors. Counts may still render but state must be degraded.
    const s = deriveAlertsSummary({
      canRead: true,
      metrics: {
        alerts: [
          { code: 'A', level: 'crit', message: 'a' },
          { code: 'B', level: 'crit', message: 'b' },
          { code: 'C', level: 'warn', message: 'c' },
        ],
        errors: { audit: 'missing', inbox: null, kbgaps: 'error: unavailable' } as unknown as Record<string, number>,
      },
      metricsError: null,
      metricsPending: false,
    })

    expect(s.state).toBe('source-errors')
    expect(s.critical).toBe(2)
    expect(s.warning).toBe(1)
    expect(s.sourceErrors).toBe(2)
    expect(s.rawAlertCount).toBe(3)
  })

  it('unknown / missing alert levels do NOT inflate Critical or Warning', () => {
    // REMEDIATION-01 §14 — info / debug / missing levels stay out of
    // Critical/Warning but contribute to unclassifiedAlertCount.
    const s = deriveAlertsSummary({
      canRead: true,
      metrics: {
        alerts: [
          { code: 'A', level: 'info', message: 'a' },
          { code: 'B', level: 'debug', message: 'b' },
          { code: 'C', message: 'c' }, // level undefined
          { code: 'D', level: 'warn', message: 'd' },
        ],
        errors: { audit: null, inbox: null, kbgaps: null } as unknown as Record<string, number>,
      },
      metricsError: null,
      metricsPending: false,
    })

    expect(s.critical).toBe(0)
    expect(s.warning).toBe(1)
    expect(s.unclassifiedAlertCount).toBe(3)
    expect(s.rawAlertCount).toBe(4)
  })

  it('raw alerts exist but 0 recognized crit/warn → available-alerts, NOT available-empty', () => {
    // REMEDIATION-01 §14 — an alert the server gave us with an
    // unknown level is STILL an alert; we must NOT present the
    // surface as `available-empty`.
    const s = deriveAlertsSummary({
      canRead: true,
      metrics: {
        alerts: [
          { code: 'A', level: 'info', message: 'a' },
          { code: 'B', level: 'debug', message: 'b' },
        ],
        errors: { audit: null, inbox: null, kbgaps: null } as unknown as Record<string, number>,
      },
      metricsError: null,
      metricsPending: false,
    })

    expect(s.state).toBe('available-alerts')
    expect(s.state).not.toBe('available-empty')
    expect(s.critical).toBe(0)
    expect(s.warning).toBe(0)
    expect(s.rawAlertCount).toBe(2)
    expect(s.unclassifiedAlertCount).toBe(2)
  })

  it('server-unavailable beats available-empty when both conditions are present', () => {
    // Defense-in-depth against future controller refactors that might
    // leak an empty metrics object alongside an error. The error wins.
    const s = deriveAlertsSummary({
      canRead: true,
      metrics: asMetrics({ alerts: [], errors: { audit: null, inbox: null, kbgaps: null } }),
      metricsError: 'transport exploded',
      metricsPending: false,
    })

    expect(s.state).toBe('server-unavailable')
    expect(s.critical).toBeNull()
  })

  it('permission-unavailable beats loading when both conditions are present', () => {
    // A viewer who lacks `metrics.view` should never see the loading
    // shimmer; the gate is upstream of the query.
    const s = deriveAlertsSummary({
      canRead: false,
      metrics: null,
      metricsError: null,
      metricsPending: true,
    })

    expect(s.state).toBe('permission-unavailable')
  })
})

/**
 * Integration: `deriveDashboardViewModel` must surface `alertsSummary`
 * with the SAME state machine `deriveAlertsSummary` produces for the
 * same controller inputs. The view-model does NOT maintain a parallel
 * permission engine — it delegates to the shared layer.
 */
describe('deriveDashboardViewModel — alertsSummary wiring (REMEDIATION-01)', () => {
  const page = dashboardPage()

  it('happy empty server payload → state=available-empty with 0/0/0', () => {
    const vm = deriveDashboardViewModel({
      page,
      whoami: operatorWhoami,
      health: baseHealth,
      healthError: null,
      healthPending: false,
      metrics: asMetrics({ alerts: [], errors: { audit: null, inbox: null, kbgaps: null } }),
      metricsError: null,
      metricsPending: false,
    })

    expect(vm.alertsSummary.state).toBe('available-empty')
    expect(vm.alertsSummary.critical).toBe(0)
    expect(vm.alertsSummary.warning).toBe(0)
    expect(vm.alertsSummary.sourceErrors).toBe(0)
  })

  it('crit + warn + degraded source errors → state=source-errors with counts retained', () => {
    const vm = deriveDashboardViewModel({
      page,
      whoami: operatorWhoami,
      health: baseHealth,
      healthError: null,
      healthPending: false,
      metrics: {
        alerts: [
          { code: 'A', level: 'crit', message: 'a' },
          { code: 'B', level: 'warn', message: 'b' },
        ],
        errors: { audit: 'missing', inbox: null, kbgaps: null } as unknown as Record<string, number>,
      },
      metricsError: null,
      metricsPending: false,
    })

    expect(vm.alertsSummary.state).toBe('source-errors')
    expect(vm.alertsSummary.critical).toBe(1)
    expect(vm.alertsSummary.warning).toBe(1)
    expect(vm.alertsSummary.sourceErrors).toBe(1)
  })

  it('metrics error → state=server-unavailable, all counts=null', () => {
    const vm = deriveDashboardViewModel({
      page,
      whoami: operatorWhoami,
      health: baseHealth,
      healthError: null,
      healthPending: false,
      metrics: null,
      metricsError: new Error('boom'),
      metricsPending: false,
    })

    expect(vm.alertsSummary.state).toBe('server-unavailable')
    expect(vm.alertsSummary.critical).toBeNull()
    expect(vm.alertsSummary.warning).toBeNull()
    expect(vm.alertsSummary.sourceErrors).toBeNull()
  })
})