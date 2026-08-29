/**
 * Follow-up page — Glue layer.
 *
 * Composes:
 *   - controller (useFollowupList / useFollowupDetail / useFollowupHistory)
 *   - view-model (deriveFollowupPageViewModel + helpers)
 *   - view (FollowupView)
 *
 * This file owns presentation-state (status filter, selected row, and
 * the responsive compactDetail decision was moved to the view since
 * it depends on window.matchMedia). The controller owns server reads.
 * The view-model owns shape derivation. The view owns rendering.
 *
 * Visual output is identical to the pre-split page-followup.tsx. No
 * data-testid values change. No new mutation surface. The Sheet
 * (mobile responsive compact) is preserved.
 */

import { useState } from 'react'

import { findPage } from './catalog'
import {
  type FollowupStatus,
  useFollowupDetail,
  useFollowupHistory,
  useFollowupList,
} from './page-followup.controller'
import { FollowupView } from './page-followup.view'
import { deriveFollowupPageViewModel } from './page-followup.view-model'

export function FollowupPage() {
  const [status, setStatus] = useState<'' | FollowupStatus>('')
  const [selectedId, setSelectedId] = useState<null | string>(null)

  const list = useFollowupList(status)
  const detail = useFollowupDetail(selectedId ?? '')
  const history = useFollowupHistory(selectedId ?? '')

  const page = findPage('followup')

  if (!page) {
    throw new Error('followup page missing from catalog')
  }

  const vm = deriveFollowupPageViewModel({
    page,
    listRows: list.data?.followups ?? [],
    listPending: list.isPending,
    listError: list.error,
  })

  const handleSelect = (id: string) => {
    setSelectedId((prev) => (prev === id ? null : id))
  }

  const handleClearSelection = () => setSelectedId(null)

  return (
    <FollowupView
      detailData={detail.data}
      detailError={detail.error}
      detailPending={detail.isPending}
      historyData={history.data}
      historyError={history.error}
      historyPending={history.isPending}
      onClearSelection={handleClearSelection}
      onSelect={handleSelect}
      selectedId={selectedId}
      status={status}
      vm={vm}
    />
  )
}