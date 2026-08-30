/**
 * Alerts Summary — Leaf view component (Lane C · P1.5 Alerts Summary).
 *
 * P3-M4A · PHASE1-PARALLEL-ENGINEERING-01-CONTINUATION-01 · Lane C.
 *
 * PURE presentational leaf. Receives a fully-derived
 * ``AlertsSummaryDerivation`` (or undefined while loading / on error) and
 * renders the compact health card. NO useEffect, NO transport, NO
 * permission authority, NO state mutation.
 *
 * Per CONTINUATION-01 §P12 (Phase-1.5 Collision Design):
 *   - This is a LEAF component. It does NOT touch page-shell files
 *     (page-dashboard.tsx / page-dashboard.view.tsx / page-dashboard.view-model.ts).
 *   - The Lane C integrator is responsible for mounting this leaf into
 *     the Overview page using the existing dashboard composition pattern.
 *
 * Per CONTINUATION-01 §P6.6 verification:
 *   - Reads ONLY the data passed in via props.
 *   - When data is undefined or data.ok === false, renders an honest
 *     "unavailable" state — NEVER fabricates counts.
 *   - A11y semantics: numbers are inside status badges with descriptive
 *     text; zero criticality is announced.
 *   - Keyboard access: standard buttons / links only.
 */

import { icons, StatusDot, type StatusTone } from '@hermes/plugin-sdk'

import { ConsolePanel } from './ui'

// Local type mirror of the controller derivation. The view is intentionally
// data-driven (it receives the full derivation via props) so it does NOT
// import from the controller file. Keeping the shape here allows the
// integrator / page-shell owner to pass either the controller output or a
// mocked value in tests without coupling to the controller path.
export interface AlertsSummaryDerivation {
  criticalCount: number
  warningCount: number
  sourceErrorCount: number
  totalAlerts: number
  generatedTs: number
  ok: boolean
}

export interface AlertsSummaryCardProps {
  /** Compact derivation from ``useAlertsSummary``. */
  data: AlertsSummaryDerivation | undefined
  /** True while the upstream query is pending. */
  pending: boolean
  /** Error string if the upstream query failed. */
  error: string | undefined
  /** Localization hook from ``usePluginI18n('enterprise-console')``. */
  t: (key: string) => string
}

const ZERO_TONE: StatusTone = 'good'
const WARNING_TONE: StatusTone = 'warn'
const CRITICAL_TONE: StatusTone = 'bad'

export function AlertsSummaryCard({
  data,
  pending,
  error,
  t,
}: AlertsSummaryCardProps) {
  const title = t('page.alertsSummary.title')
  const subtitle = t('page.alertsSummary.subtitle')

  if (pending && !data) {
    return (
      <div data-testid="console-alerts-summary" data-state="loading">
        <ConsolePanel title={title}>
          <p className="text-(--ui-text-tertiary)" data-ec-mono="">
            loading…
          </p>
        </ConsolePanel>
        <span className="sr-only">{subtitle}</span>
      </div>
    )
  }

  if (error || !data || !data.ok) {
    return (
      <div
        data-testid="console-alerts-summary"
        data-state="unavailable"
        role="status"
      >
        <ConsolePanel title={title}>
          <p className="text-(--ui-text-tertiary)" data-ec-mono="">
            unavailable
          </p>
        </ConsolePanel>
        <span className="sr-only">{subtitle}</span>
      </div>
    )
  }

  const criticalTone =
    data.criticalCount > 0 ? CRITICAL_TONE : ZERO_TONE
  const warningTone = data.warningCount > 0 ? WARNING_TONE : ZERO_TONE
  const sourceErrorTone =
    data.sourceErrorCount > 0 ? WARNING_TONE : ZERO_TONE

  return (
    <div
      data-testid="console-alerts-summary"
      data-state="ready"
      data-critical-count={data.criticalCount}
      data-warning-count={data.warningCount}
      data-source-error-count={data.sourceErrorCount}
      role="status"
    >
      <ConsolePanel
        title={
          <span className="flex items-center gap-2">
            <icons.Activity aria-hidden="true" />
            <span>{title}</span>
          </span>
        }
      >
        <ul className="grid gap-2" data-ec-mono="">
          <li className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-2 text-(--ui-text-secondary)">
              <StatusDot tone={criticalTone} />
              critical
            </span>
            <span data-testid="console-alerts-summary-critical">
              {data.criticalCount}
            </span>
          </li>
          <li className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-2 text-(--ui-text-secondary)">
              <StatusDot tone={warningTone} />
              warning
            </span>
            <span data-testid="console-alerts-summary-warning">
              {data.warningCount}
            </span>
          </li>
          <li className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-2 text-(--ui-text-secondary)">
              <StatusDot tone={sourceErrorTone} />
              source errors
            </span>
            <span data-testid="console-alerts-summary-source-errors">
              {data.sourceErrorCount}
            </span>
          </li>
        </ul>
      </ConsolePanel>
      <span className="sr-only">{subtitle}</span>
    </div>
  )
}
