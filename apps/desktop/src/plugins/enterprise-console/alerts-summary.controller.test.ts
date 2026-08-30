/**
 * Alerts Summary — Tests (Lane C · P1.5 Alerts Summary).
 *
 * P3-M4A · PHASE1-PARALLEL-ENGINEERING-01-CONTINUATION-01 · Lane C.
 *
 * Per CONTINUATION-01 §P6.6 verification contract:
 *   - new Alerts Summary tests
 *   - responsive checks
 *   - keyboard checks
 *   - a11y semantics
 *   - typecheck
 *   - lint
 *   - git diff --check
 *
 * Two test files:
 *   - alerts-summary.controller.test.ts: pure derivation tests (no React).
 *   - alerts-summary.view.test.tsx: render tests (React Testing Library).
 */

import { describe, expect, it } from 'vitest'

import {
  deriveAlertsSummary,
  type MetricsAlertsResp,
} from './alerts-summary.controller'
// Local mirror of AlertsSummaryDerivation (matches the controller's
// shape; the view and controller both export their own copy per Lane C
// leaf-vs-controller separation rule).

describe('alerts-summary.controller.deriveAlertsSummary', () => {
  it('returns ok=false for null input', () => {
    const r = deriveAlertsSummary(null)
    expect(r.ok).toBe(false)
    expect(r.criticalCount).toBe(0)
    expect(r.warningCount).toBe(0)
    expect(r.sourceErrorCount).toBe(0)
    expect(r.totalAlerts).toBe(0)
  })

  it('returns ok=false for undefined input', () => {
    const r = deriveAlertsSummary(undefined)
    expect(r.ok).toBe(false)
    expect(r.totalAlerts).toBe(0)
  })

  it('counts critical alerts', () => {
    const resp: MetricsAlertsResp = {
      alerts: [
        { code: 'a', level: 'crit', message: 'x', threshold: 1, value: 2 },
        { code: 'b', level: 'crit', message: 'y', threshold: 1, value: 2 },
      ],
      errors: {},
      generated_ts: 1700000000,
    }
    const r = deriveAlertsSummary(resp)
    expect(r.ok).toBe(true)
    expect(r.criticalCount).toBe(2)
    expect(r.warningCount).toBe(0)
    expect(r.totalAlerts).toBe(2)
  })

  it('counts warning alerts separately from critical', () => {
    const resp: MetricsAlertsResp = {
      alerts: [
        { code: 'a', level: 'crit', message: 'x', threshold: 1, value: 2 },
        { code: 'b', level: 'warn', message: 'y', threshold: 1, value: 2 },
        { code: 'c', level: 'warn', message: 'z', threshold: 1, value: 2 },
      ],
      errors: {},
      generated_ts: 1700000000,
    }
    const r = deriveAlertsSummary(resp)
    expect(r.criticalCount).toBe(1)
    expect(r.warningCount).toBe(2)
    expect(r.totalAlerts).toBe(3)
  })

  it('counts source errors from errors map keys', () => {
    const resp: MetricsAlertsResp = {
      alerts: [],
      errors: { source_a: 'timeout', source_b: 'unauthorized' },
      generated_ts: 1700000000,
    }
    const r = deriveAlertsSummary(resp)
    expect(r.sourceErrorCount).toBe(2)
    expect(r.totalAlerts).toBe(0)
  })

  it('handles missing alerts and errors fields', () => {
    const resp = {
      generated_ts: 1700000000,
    } as unknown as MetricsAlertsResp
    const r = deriveAlertsSummary(resp)
    expect(r.ok).toBe(true)
    expect(r.criticalCount).toBe(0)
    expect(r.warningCount).toBe(0)
    expect(r.sourceErrorCount).toBe(0)
  })

  it('preserves generated_ts', () => {
    const resp: MetricsAlertsResp = {
      alerts: [],
      errors: {},
      generated_ts: 1700000123,
    }
    const r = deriveAlertsSummary(resp)
    expect(r.generatedTs).toBe(1700000123)
  })

  it('does not fabricate counts when response shape is non-standard', () => {
    const resp = { foo: 'bar' } as unknown as MetricsAlertsResp
    const r = deriveAlertsSummary(resp)
    expect(r.ok).toBe(true)
    expect(r.totalAlerts).toBe(0)
  })
})
