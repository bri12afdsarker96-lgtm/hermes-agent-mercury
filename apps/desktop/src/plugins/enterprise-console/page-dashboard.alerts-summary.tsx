/**
 * Alerts Summary — Phase-1.5 compact tile group embedded in the Dashboard
 * Overview. PURE PRESENTATION: receives a fully-derived
 * `AlertsSummary` from the view-model and renders three KPI tiles
 * (Critical / Warning / Source Errors) plus an explicit, honest state.
 *
 * State machine (REMEDIATION-01):
 *   - `loading`               — three tiles loading + central Loader
 *   - `permission-unavailable` — em-dash tiles + "permission required" note
 *   - `server-unavailable`    — em-dash tiles + "metrics unavailable" note
 *   - `available-empty`       — tile=0 + "no alerts · no source errors" empty
 *   - `available-alerts`      — real counts, no empty-state decoration
 *   - `source-errors`         — real counts + explicit "SOURCE DATA DEGRADED"
 *                               marker so the operator never mistakes a
 *                               partially-degraded payload for healthy
 *
 * This file does NOT:
 *   - import transport, fetch-transport, page-kit, session,
 *     capabilities, useQuery, useTransport, or window.hermesDesktop
 *     (per the W1-A ESLint boundary rule in `apps/desktop/eslint.config.mjs`)
 *   - recompute counts; it only reads `summary`
 *   - fabricate "healthy" / "zero alerts" / "no errors" copy when the
 *     server has not given an honest answer
 *   - mistake raw alert keys for actual error conditions (server
 *     `errors` keys can be present with `null` value — those are not
 *     errors; the view-model already filtered that)
 *
 * It DOES reuse the existing UI primitives (`KpiCard`, `ConsolePanel`,
 * `EmptyState`, `Loader`) and the i18n hook from `@hermes/plugin-sdk`.
 * No new CSS, no new accent, no new shared component.
 */

import { EmptyState, icons, Loader, usePluginI18n } from '@hermes/plugin-sdk'

import type { AlertsSummary, AlertsSummaryState } from './page-dashboard.view-model'
import { ConsolePanel, KpiCard } from './ui'

/**
 * Honest copy for the right-hand trailing slot of the panel title.
 * Returns `null` when the panel title itself is the truthful signal
 * (`available-empty` / `available-alerts` need no trailer — the title
 * carries the state via the inline state chip).
 */
function stateTrailerCopy(state: AlertsSummaryState, t: (key: string) => string): null | string {
  switch (state) {
    case 'loading':
      return null // Loader covers this — no extra text needed

    case 'available-empty':

    case 'available-alerts':
      return null

    case 'server-unavailable':
      return t('status.error')

    case 'permission-unavailable':
      return t('status.permissionRequired')

    case 'source-errors':
      // §13 — degraded state must be visible, NOT labeled as healthy.
      return 'SOURCE DATA DEGRADED'

    case 'data-degraded':
      // Defensive state we never intentionally produce today, but the
      // view-model reserves it for shapes that cannot fit any honest
      // bucket above. Surface it loudly either way.
      return 'SOURCE DATA DEGRADED'
  }
}

/**
 * Empty-state copy for `available-empty`. We DO say "no alerts · no
 * source errors" here because that is the truthful verdict for an
 * ANSWERED empty payload — it is NOT the fabricated "healthy" claim
 * (which we reserve for the server's own `Health.ok` verdict and
 * which lives on the dedicated Health card, not here).
 */
function emptyCopy(t: (key: string) => string): string {
  // Re-use the existing i18n key the dashboard's Active Alerts panel
  // uses for its empty case, so the operator sees consistent wording.
  const raw = t('dashboard.alerts.empty')

  return raw === 'dashboard.alerts.empty' ? 'no alerts · no source errors' : raw
}

/**
 * Compact one-line summary of counts we render under the tiles when
 * `state === 'available-alerts'` but ALL of `critical` / `warning` /
 * `sourceErrors` are zero — i.e. the server handed us alerts but
 * none classify as crit/warn (everything is `info` / `debug` /
 * missing). We expose the unclassified count honestly instead of
 * presenting a "0 / 0 / 0" panel that lies about the payload.
 */
function unclassifiedNoteCopy(summary: AlertsSummary): null | string {
  if (summary.state !== 'available-alerts' && summary.state !== 'source-errors') {
    return null
  }

  if (
    summary.unclassifiedAlertCount === null ||
    summary.unclassifiedAlertCount === undefined ||
    summary.unclassifiedAlertCount <= 0
  ) {
    return null
  }

  if ((summary.critical ?? 0) > 0 || (summary.warning ?? 0) > 0) {
    return null
  }

  return `${summary.unclassifiedAlertCount} unclassified alert${
    summary.unclassifiedAlertCount === 1 ? '' : 's'
  } (level not crit/warn)`
}

export interface AlertsSummaryViewProps {
  /** Pre-derived by `deriveDashboardViewModel` (page-dashboard.view-model.ts). */
  summary: AlertsSummary
}

/**
 * The Phase-1.5 Dashboard Overview tile group.
 *
 * Pure presentational leaf — no controller / transport / authority
 * surface lives here. See `page-dashboard.view.tsx` for the only
 * call site.
 */
export function AlertsSummaryView({ summary }: AlertsSummaryViewProps) {
  const t = usePluginI18n('enterprise-console')
  const trailer = stateTrailerCopy(summary.state, t)
  const unclassifiedNote = unclassifiedNoteCopy(summary)

  // Only render the empty-state when the server has actually given us
  // a payload that says "nothing to report". `loading` /
  // `server-unavailable` / `permission-unavailable` / `data-degraded`
  // all keep the panel neutral (em-dashes / loader).
  const showEmpty = summary.state === 'available-empty'

  // Tile figures only render real numbers when the server answered.
  // When the answer is missing (loading / unavailable / permission /
  // data-degraded) we pass `null` and KpiCard renders the em-dash —
  // the honest "no number to give" symbol, NEVER a fabricated zero.
  const tileLoading = summary.state === 'loading'

  return (
    <ConsolePanel
      action={
        trailer === null ? undefined : (
          <span data-testid="console-alerts-summary-trailer">{trailer}</span>
        )
      }
      divided
      title="Alerts Summary"
    >
      <div
        className="flex flex-col gap-3"
        data-state={summary.state}
        data-testid="console-alerts-summary"
      >
        {showEmpty ? <EmptyState className="min-h-16" title={emptyCopy(t)} /> : null}

        <div className="grid gap-(--ec-gutter) sm:grid-cols-3">
          <div data-testid="console-alerts-summary-critical">
            <KpiCard
              accent="takeover"
              icon={icons.AlertTriangle}
              label="Critical"
              loading={tileLoading}
              value={summary.critical}
            />
          </div>
          <div data-testid="console-alerts-summary-warning">
            <KpiCard
              accent="knowledge"
              icon={icons.Bell}
              label="Warning"
              loading={tileLoading}
              value={summary.warning}
            />
          </div>
          <div data-testid="console-alerts-summary-source-errors">
            <KpiCard
              accent="followup"
              icon={icons.Bug}
              label="Source Errors"
              loading={tileLoading}
              value={summary.sourceErrors}
            />
          </div>
        </div>

        {tileLoading ? <Loader /> : null}

        {summary.state === 'server-unavailable' || summary.state === 'permission-unavailable' ? (
          <p className="text-(--ui-text-tertiary)" data-testid="console-alerts-summary-note">
            {/* Honest non-fabricated note: when the answer is unknown,
                we say so without inventing a number. The three KPI
                tiles above already render the em-dash for null
                values via KpiCard's null handling. */}
            {summary.state === 'server-unavailable'
              ? 'metrics query unavailable — counts withheld'
              : 'permission required — counts withheld'}
          </p>
        ) : null}

        {summary.state === 'source-errors' ? (
          <p
            className="text-(--ui-text-tertiary)"
            data-testid="console-alerts-summary-degraded-note"
          >
            {/* §13 — explicit, non-ignorable degraded-state marker.
                Counts above are real but only as honest as the
                partially-collected server payload. */}
            counts reflect a partially-collected payload — at least one
            source reported a degraded condition
          </p>
        ) : null}

        {unclassifiedNote !== null ? (
          <p
            className="text-(--ui-text-tertiary)"
            data-testid="console-alerts-summary-unclassified-note"
          >
            {/* Honest disclosure of unread alert rows that did not
                classify as crit/warn. We never inflate Critical or
                Warning with these, but we never silently hide them
                either. */}
            {unclassifiedNote}
          </p>
        ) : null}
      </div>
    </ConsolePanel>
  )
}
