/**
 * Alerts & Exceptions page — Glue layer.
 *
 * Composes the controller (query), view-model (derivation), and view
 * (rendering). This is the only place that wires the three together.
 *
 * Wave 1 / Step 5 of W5-B0 Controller/View Contract Freeze. See
 * .hermes/plans/2026-08-29_wave1-contract-freeze.md §3.
 */

import { findPage } from './catalog'
import { QueryBody } from './page-kit'
import { useWhoami } from './session'
import { useAlertsData } from './page-alerts.controller'
import { deriveAlertsViewModel } from './page-alerts.view-model'
import { AlertsView } from './page-alerts.view'

export function AlertsPage() {
  const who = useWhoami()
  const query = useAlertsData()
  const page = findPage('alerts')!

  return (
    <QueryBody emptyText="no active alerts" isEmpty={vm => vm.isEmpty} query={query}>
      {data => <AlertsView vm={deriveAlertsViewModel({ page, whoami: who, data })} />}
    </QueryBody>
  )
}