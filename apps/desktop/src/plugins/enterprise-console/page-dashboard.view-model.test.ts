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
  dashboardPage,
  deriveDashboardViewModel,
  workspaceCopy,
} from './page-dashboard.view-model'
import type { Health, Metrics, Whoami } from './types'

const baseHealth: Health = {
  auth_mode: 'native_bearer',
  ok: true,
}

const baseMetrics: Metrics = {
  alerts: [],
  errors: {},
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
 * V0 productization truth-surface tests (P1-VIS-V0).
 *
 * These tests lock the four-state truth derivations in place so the
 * view can render without ever confusing:
 *   - LOADING with ZERO
 *   - ERROR with DOWN
 *   - fabricated KPI with honest empty
 *   - missing session with anonymous session
 *
 * Every assertion maps to one P5 invariant from the directive.
 */

describe('deriveDashboardViewModel · V0 four-state truth surface', () => {
  const page = dashboardPage()

  describe('healthState (LOADING / ERROR / HEALTHY / DOWN)', () => {
    it('pending → loading (NOT down)', () => {
      const vm = deriveDashboardViewModel({
        page,
        whoami: operatorWhoami,
        health: null,
        healthPending: true,
        healthError: null,
        metrics: null,
        metricsPending: false,
        metricsError: null,
      })
      expect(vm.healthState).toBe('loading')
    })

    it('error → error (NEVER down)', () => {
      const vm = deriveDashboardViewModel({
        page,
        whoami: operatorWhoami,
        health: null,
        healthPending: false,
        healthError: new Error('request failed'),
        metrics: null,
        metricsPending: false,
        metricsError: null,
      })
      expect(vm.healthState).toBe('error')
    })

    it('health.ok === true → healthy', () => {
      const vm = deriveDashboardViewModel({
        page,
        whoami: operatorWhoami,
        health: baseHealth,
        healthPending: false,
        healthError: null,
        metrics: null,
        metricsPending: false,
        metricsError: null,
      })
      expect(vm.healthState).toBe('healthy')
    })

    it('health.ok === false → down', () => {
      const vm = deriveDashboardViewModel({
        page,
        whoami: operatorWhoami,
        health: { ...baseHealth, ok: false },
        healthPending: false,
        healthError: null,
        metrics: null,
        metricsPending: false,
        metricsError: null,
      })
      expect(vm.healthState).toBe('down')
    })

    it('answered but health === null → error (NOT down)', () => {
      const vm = deriveDashboardViewModel({
        page,
        whoami: operatorWhoami,
        health: null,
        healthPending: false,
        healthError: null,
        metrics: null,
        metricsPending: false,
        metricsError: null,
      })
      expect(vm.healthState).toBe('error')
    })
  })

  describe('metricsState (LOADING / ERROR / IDLE / LOADED)', () => {
    it('pending → loading (NOT loaded-empty)', () => {
      const vm = deriveDashboardViewModel({
        page,
        whoami: operatorWhoami,
        health: baseHealth,
        healthPending: false,
        healthError: null,
        metrics: null,
        metricsPending: true,
        metricsError: null,
      })
      expect(vm.metricsState).toBe('loading')
    })

    it('error → error', () => {
      const vm = deriveDashboardViewModel({
        page,
        whoami: operatorWhoami,
        health: baseHealth,
        healthPending: false,
        healthError: null,
        metrics: null,
        metricsPending: false,
        metricsError: new Error('boom'),
      })
      expect(vm.metricsState).toBe('error')
    })

    it('answered but metrics.alerts key absent → idle (no fabricated empty)', () => {
      const vm = deriveDashboardViewModel({
        page,
        whoami: operatorWhoami,
        health: baseHealth,
        healthPending: false,
        healthError: null,
        // `alerts` key explicitly absent
        metrics: { errors: {} } as Metrics,
        metricsPending: false,
        metricsError: null,
      })
      expect(vm.metricsState).toBe('idle')
    })

    it('answered with alerts: [] → loaded (honest empty)', () => {
      const vm = deriveDashboardViewModel({
        page,
        whoami: operatorWhoami,
        health: baseHealth,
        healthPending: false,
        healthError: null,
        metrics: { alerts: [], errors: {} },
        metricsPending: false,
        metricsError: null,
      })
      expect(vm.metricsState).toBe('loaded')
    })

    it('answered with non-empty alerts → loaded', () => {
      const vm = deriveDashboardViewModel({
        page,
        whoami: operatorWhoami,
        health: baseHealth,
        healthPending: false,
        healthError: null,
        metrics: {
          alerts: [{ code: 'C1', level: 'warn', message: 'msg' }],
          errors: {},
        },
        metricsPending: false,
        metricsError: null,
      })
      expect(vm.metricsState).toBe('loaded')
    })
  })

  describe('identityState', () => {
    it('whoami present → authenticated', () => {
      const vm = deriveDashboardViewModel({
        page,
        whoami: operatorWhoami,
        health: baseHealth,
        healthPending: false,
        healthError: null,
        metrics: null,
        metricsPending: false,
        metricsError: null,
      })
      expect(vm.identityState).toBe('authenticated')
    })

    it('whoami null → missing (NEVER "anonymous")', () => {
      const vm = deriveDashboardViewModel({
        page,
        whoami: null,
        health: baseHealth,
        healthPending: false,
        healthError: null,
        metrics: null,
        metricsPending: false,
        metricsError: null,
      })
      expect(vm.identityState).toBe('missing')
    })
  })

  describe('alertsCount / isAlertsListEmpty / activeAlerts', () => {
    it('alertsCount mirrors activeAlerts.length, never invents a number', () => {
      const vm1 = deriveDashboardViewModel({
        page,
        whoami: operatorWhoami,
        health: baseHealth,
        healthPending: false,
        healthError: null,
        metrics: { alerts: [], errors: {} },
        metricsPending: false,
        metricsError: null,
      })
      expect(vm1.alertsCount).toBe(0)
      expect(vm1.isAlertsListEmpty).toBe(true)
      expect(vm1.activeAlerts).toHaveLength(0)

      const vm2 = deriveDashboardViewModel({
        page,
        whoami: operatorWhoami,
        health: baseHealth,
        healthPending: false,
        healthError: null,
        metrics: {
          alerts: [
            { code: 'A', level: 'warn', message: '1' },
            { code: 'B', level: 'error', message: '2' },
          ],
          errors: {},
        },
        metricsPending: false,
        metricsError: null,
      })
      expect(vm2.alertsCount).toBe(2)
      expect(vm2.isAlertsListEmpty).toBe(false)
    })

    it('metrics payload without alerts key → activeAlerts = [] BUT NOT via fabrication', () => {
      const vm = deriveDashboardViewModel({
        page,
        whoami: operatorWhoami,
        health: baseHealth,
        healthPending: false,
        healthError: null,
        metrics: { errors: {} } as Metrics,
        metricsPending: false,
        metricsError: null,
      })
      expect(vm.alertsCount).toBe(0)
      expect(vm.activeAlerts).toEqual([])
      // the `idle` metrics state proves we distinguished "answer has no
      // alerts key" from "answer says zero alerts"
      expect(vm.metricsState).toBe('idle')
    })
  })

  describe('authModeDisplay', () => {
    it('auth_mode present → rendered string', () => {
      const vm = deriveDashboardViewModel({
        page,
        whoami: operatorWhoami,
        health: { ...baseHealth, auth_mode: 'onecard' },
        healthPending: false,
        healthError: null,
        metrics: null,
        metricsPending: false,
        metricsError: null,
      })
      expect(vm.authModeDisplay).toBe('onecard')
    })

    it('auth_mode absent → em dash (matches KpiCard null fallback)', () => {
      const vm = deriveDashboardViewModel({
        page,
        whoami: operatorWhoami,
        health: null,
        healthPending: false,
        healthError: null,
        metrics: null,
        metricsPending: false,
        metricsError: null,
      })
      expect(vm.authModeDisplay).toBe('—')
    })
  })
})