/**
 * Tests for `page-dashboard.controller.ts` (W1-B1-REMEDIATION-01 §P22).
 *
 * Pure tests against the controller's exported query-key + refetch
 * constants. Proves the dashboard reads `/api/health` and
 * `/api/metrics?window=24h` with the **EXACT** pre-split React Query
 * identity.
 *
 * Pre-split (the reference truth per TOTAL-CONTROL review):
 *   - health key:  ['enterprise-console', 'health']
 *   - metrics key: ['enterprise-console', 'metrics', '24h']
 *   - health  refetch interval: 30_000 ms
 *   - metrics refetch interval: 60_000 ms
 *
 * If any of these constants drift, observers / cache invalidation /
 * functional parity may break.
 */

import { describe, expect, it } from 'vitest'

import {
  DASHBOARD_HEALTH_QUERY_KEY,
  DASHBOARD_HEALTH_REFETCH_MS,
  DASHBOARD_METRICS_QUERY_KEY,
  DASHBOARD_METRICS_REFETCH_MS,
} from './page-dashboard.controller'

describe('Dashboard controller query-key parity (W1-B1-REMEDIATION-01 §P22)', () => {
  it('exact health query key is the pre-split identity', () => {
    expect([...DASHBOARD_HEALTH_QUERY_KEY]).toEqual([
      'enterprise-console',
      'health',
    ])
  })

  it('exact metrics query key is the pre-split identity', () => {
    expect([...DASHBOARD_METRICS_QUERY_KEY]).toEqual([
      'enterprise-console',
      'metrics',
      '24h',
    ])
  })

  it('exposes the refetch intervals as explicit ms constants', () => {
    expect(DASHBOARD_HEALTH_REFETCH_MS).toBe(30_000)
    expect(DASHBOARD_METRICS_REFETCH_MS).toBe(60_000)
  })

  it('query-key shape is exactly 2 / 3 elements (no extra segment)', () => {
    expect(DASHBOARD_HEALTH_QUERY_KEY).toHaveLength(2)
    expect(DASHBOARD_METRICS_QUERY_KEY).toHaveLength(3)
  })
})