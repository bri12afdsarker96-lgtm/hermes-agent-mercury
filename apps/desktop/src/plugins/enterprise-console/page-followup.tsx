/**
 * Follow-up page — Glue layer.
 *
 * Composes:
 *   - controller (useFollowupList / conditionally-mounted detail+history)
 *   - view-model (deriveFollowupList / deriveFollowupPageViewModel /
 *     deriveFollowupDetail / deriveFollowupHistory)
 *   - view (FollowupView / FollowupSelectedDetailPanel)
 *
 * Per W1-B1-REMEDIATION-01:
 *   - §P6: status filter state is owned here; the view calls
 *     `onStatusChange(next)` and the glue applies
 *     `setStatus(next); setSelectedId(null);`.
 *   - §P7: detail/history queries run ONLY when `selectedId !== null`.
 *   - §P8: the conditional child component
 *     `FollowupSelectedDetailContainer` lives in this glue file (not
 *     the view) so the view can stay free of transport.
 *   - §P10: whoami is resolved via `useValue($whoami)` (the
 *     established seam) and passed to the page-VM derivation.
 *   - §P15: this glue owns the `fmtIso` import (existing formatter).
 *
 * Per W1-B1-REMEDIATION-02:
 *   - §P6 + §P7: the selected-detail container returns the
 *     `FollowupSelectedDetailPanel` directly — no useEffect relay,
 *     no parent-cached VM state. Selection identity === render
 *     identity via `key={selectedId}`. A switch from f1 → f2 tears
 *     down the f1 container (and its React Query subscriptions)
 *     immediately; there is no stale VM to leak across selections.
 *   - §P8: the detail/history panel uses `QueryBody` for loading /
 *     error / not_implemented / empty / ready semantics — matches
 *     the pre-split page exactly.
 */

import { useValue } from '@hermes/plugin-sdk'
import { useState } from 'react'

import { findPage } from './catalog'
import {
  FOLLOWUP_STATUSES,
  type FollowupStatus,
  useFollowupDetail,
  useFollowupHistory,
  useFollowupList,
} from './page-followup.controller'
import {
  FollowupSelectedDetailPanel,
  FollowupView,
} from './page-followup.view'
import {
  deriveFollowupDetail,
  deriveFollowupHistory,
  deriveFollowupPageViewModel,
} from './page-followup.view-model'
import type {
  FollowupDetailViewModel,
  FollowupHistoryViewModel,
} from './page-followup.view-model'
import { fmtIso } from './page-kit'
import { $whoami } from './session'

/**
 * Per W1-B1-REMEDIATION-02 §P6 + §P7:
 * Container binds detail/history to the selected id via
 * `key={selectedId}` (mounted by `FollowupPage`). On any selection
 * change, React tears down the old container (and its React Query
 * subscriptions) and mounts a fresh one for the new id. The container
 * consumes the controller hooks synchronously on each render and
 * passes pre-derived VMs to the presentational panel — there is no
 * useEffect relay and no parent-cached VM state. The render identity
 * === selection identity === query identity.
 *
 * The returned panel is the same component the view file exposes
 * (also consumed by the inline-desktop detail path) so the
 * presentational markup is centralised in the view file.
 */
function FollowupSelectedDetailContainer({
  followupId,
}: {
  followupId: string
}) {
  const detail = useFollowupDetail(followupId)
  const history = useFollowupHistory(followupId)

  const detailVm: FollowupDetailViewModel = {
    detail: detail.data
      ? deriveFollowupDetail(detail.data.followup, fmtIso).detail
      : null,
  }

  // The view-model's history derivation is pure (no isPending / no
  // error) so the container passes loading + error to the panel via
  // props in addition to the VM events. The panel merges them with
  // QueryBody to drive the loading / error / not_implemented / empty
  // / ready semantics.
  const baseHistory = deriveFollowupHistory(history.data?.history ?? [])
  const historyVm: FollowupHistoryViewModel = baseHistory

  return (
    <FollowupSelectedDetailPanel
      detail={detailVm}
      detailError={detail.error ?? null}
      detailIsPending={detail.isPending}
      history={historyVm}
      historyError={history.error ?? null}
      historyIsPending={history.isPending}
    />
  )
}

export function FollowupPage() {
  const [status, setStatus] = useState<'' | FollowupStatus>('')
  const [selectedId, setSelectedId] = useState<null | string>(null)

  const list = useFollowupList(status)
  const whoami = useValue($whoami)

  const page = findPage('followup')

  if (!page) {
    throw new Error('followup page missing from catalog')
  }

  const vm = deriveFollowupPageViewModel({
    page,
    whoami,
    listRows: list.data?.followups ?? [],
    fmtIso,
  })

  const handleSelect = (id: string) => {
    setSelectedId((prev) => (prev === id ? null : id))
  }

  const handleClearSelection = () => setSelectedId(null)

  const handleStatusChange = (next: '' | FollowupStatus) => {
    setStatus(next)
    setSelectedId(null)
  }

  return (
    <FollowupView
      isReady={!list.isPending}
      list={vm.list}
      listError={list.error ?? null}
      listPending={list.isPending}
      onClearSelection={handleClearSelection}
      onSelect={handleSelect}
      onStatusChange={handleStatusChange}
      rightPane={
        selectedId ? (
          <FollowupSelectedDetailContainer
            followupId={selectedId}
            key={selectedId}
          />
        ) : null
      }
      selectedId={selectedId}
      status={status}
      statusOptions={FOLLOWUP_STATUSES}
      title="Business follow-up"
    />
  )
}