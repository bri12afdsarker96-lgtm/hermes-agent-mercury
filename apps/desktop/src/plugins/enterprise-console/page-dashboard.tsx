/**
 * Dashboard / Service Health — Glue layer.
 *
 * Composes 2 queries + view-model + view. The view never imports
 * usePluginI18n directly — the glue supplies the translation function
 * as a callback prop.
 *
 * Wave 1 / Step 13 of W5-B0 Controller/View Contract Freeze.
 */

import { usePluginI18n } from '@hermes/plugin-sdk'

import { findPage } from './catalog'
import { useHealthData, useMetrics24hData, workspaceCopy } from './page-dashboard.controller'
import { deriveDashboardViewModel } from './page-dashboard.view-model'
import { DashboardView } from './page-dashboard.view'
import { useWhoami } from './session'

export function DashboardPage() {
  const who = useWhoami()
  const t = usePluginI18n('enterprise-console')
  const page = findPage('dashboard')!
  const copy = workspaceCopy(who)
  const healthQuery = useHealthData()
  const metricsQuery = useMetrics24hData()

  return (
    <DashboardView
      t={t as (key: string) => string}
      vm={deriveDashboardViewModel({
        copy,
        health: { data: healthQuery.data, error: healthQuery.error, isPending: healthQuery.isPending },
        metrics: { data: metricsQuery.data, error: metricsQuery.error, isPending: metricsQuery.isPending },
        page,
        whoami: who,
      })}
    />
  )
}