/**
 * Alerts & Exceptions page — ViewModel derivation.
 *
 * Pure functions only: no transport, no query hooks, no React JSX.
 * The view receives an `AlertsViewModel` and renders.
 *
 * Two derivations matter for this page:
 *
 *   1. level → StatusTone mapping (crit → 'bad', warn → 'warn').
 *      The server's level enum is two values; the design's StatusTone
 *      is four. The mapping must never silently drop alerts, so unknown
 *      levels default to 'warn' (visible) rather than 'muted' (hidden).
 *
 *   2. "empty" judgement for QueryBody's empty state. The page is
 *      genuinely empty only when BOTH alerts and errors are absent —
 *      either alone should render, since a single source error is
 *      useful to the operator.
 *
 * Wave 1 / Step 5 of W5-B0 Controller/View Contract Freeze.
 */

import type { StatusTone } from '@hermes/plugin-sdk'

import { type ConsolePage } from './catalog'
import { type CommonViewModelFields, deriveCommonViewModel } from './lib/view-model'
import type { MetricsAlertsResp } from './page-alerts.controller'

export interface AlertRow {
  code: string
  level: string
  message: string
  threshold: number
  tone: StatusTone
  value: number
}

export interface AlertErrorRow {
  detail: string
  source: string
}

export interface AlertsViewModel extends CommonViewModelFields {
  /** Flattened alerts ready to render, with derived tone. */
  alerts: readonly AlertRow[]
  /** Flattened per-source errors ready to render. */
  errors: readonly AlertErrorRow[]
  /** True when both alerts AND errors are absent — shows the empty state. */
  isEmpty: boolean
}

const LEVEL_TONE: Record<string, StatusTone> = { crit: 'bad', warn: 'warn' }

function deriveAlertRow(alert: MetricsAlertsResp['alerts'][number]): AlertRow {
  return {
    code: alert.code,
    level: alert.level,
    message: alert.message,
    threshold: alert.threshold,
    tone: LEVEL_TONE[alert.level] ?? 'warn',
    value: alert.value,
  }
}

function deriveErrorRow(source: string, detail: string): AlertErrorRow {
  return { detail, source }
}

export function deriveAlertsViewModel(args: {
  page: ConsolePage
  whoami: null | import('./types').Whoami
  data: MetricsAlertsResp | undefined
}): AlertsViewModel {
  const { page, whoami, data } = args
  const common = deriveCommonViewModel({ page, whoami })

  const alerts = (data?.alerts ?? []).map(deriveAlertRow)
  const errors = Object.entries(data?.errors ?? {}).map(([source, detail]) =>
    deriveErrorRow(source, detail),
  )
  const isEmpty = alerts.length === 0 && errors.length === 0

  return {
    ...common,
    alerts,
    errors,
    isEmpty,
  }
}