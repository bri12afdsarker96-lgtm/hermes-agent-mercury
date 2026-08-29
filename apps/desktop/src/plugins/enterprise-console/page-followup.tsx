/**
 * Follow-up page — Glue layer.
 *
 * Composes:
 *   - controller (useFollowupList / conditionally-mounted detail+history)
 *   - view-model (deriveFollowupList / deriveFollowupPageViewModel /
 *     deriveFollowupDetail / deriveFollowupHistory)
 *   - view (FollowupView)
 *
 * Per W1-B1-REMEDIATION-01:
 *   - §P6: this glue owns the status filter state and exposes
 *     `onStatusChange(next)` to the view. The view calls it; the glue
 *     applies `setStatus(next); setSelectedId(null);`.
 *   - §P7: detail/history queries run ONLY when `selectedId !== null`.
 *     The conditional child component `FollowupSelectedDetailContainer`
 *     mounts the controller hooks for the selected id and unmounts
 *     them when nothing is selected. No empty-id request is fired.
 *   - §P8: that container lives in this glue file (not the view) so
 *     the view can stay free of transport.
 *   - §P10: this glue resolves `whoami` via `useValue($whoami)` (the
 *     established seam) and passes it to the page-VM derivation.
 *     `whoami: null` is NOT used.
 *   - §P15: this glue owns the `fmtIso` import (existing formatter).
 *
 * The conditional detail/history mounting means the rendered FollowupView
 * receives either the initial empty VM, or a fully-resolved VM object
 * after the container's effects push state up via setState.
 */

import { useValue } from '@hermes/plugin-sdk'
import { useEffect, useState } from 'react'

import { findPage } from './catalog'
import {
  FOLLOWUP_STATUSES,
  type FollowupStatus,
  useFollowupDetail,
  useFollowupHistory,
  useFollowupList,
} from './page-followup.controller'
import { FollowupView } from './page-followup.view'
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
 * Per W1-B1-REMEDIATION-01 §P8: conditional child component mounting
 * for the detail/history hooks. Only mounts when an id is selected.
 * The container itself is glue-local; the view does not see it.
 *
 * Pushes resolved VMs to parent state via useEffect → setState so the
 * view re-renders when the queries resolve.
 */
function FollowupSelectedDetailContainer({
  followupId,
  onDetail,
  onHistory,
}: {
  followupId: string
  onDetail: (vm: FollowupDetailViewModel) => void
  onHistory: (vm: FollowupHistoryViewModel) => void
}) {
  const detail = useFollowupDetail(followupId)
  const history = useFollowupHistory(followupId)

  useEffect(() => {
    onDetail(deriveFollowupDetail(detail.data?.followup ?? null, fmtIso))
  }, [detail.data, onDetail])

  useEffect(() => {
    onHistory(deriveFollowupHistory(history.data?.history ?? []))
  }, [history.data, onHistory])

  return null
}

export function FollowupPage() {
  const [status, setStatus] = useState<'' | FollowupStatus>('')
  const [selectedId, setSelectedId] = useState<null | string>(null)
  const [detailVm, setDetailVm] = useState<FollowupDetailViewModel>({ detail: null })

  const [historyVm, setHistoryVm] = useState<FollowupHistoryViewModel>({
    events: [],
    isEmpty: true,
  })

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
    <>
      {selectedId ? (
        <FollowupSelectedDetailContainer
          followupId={selectedId}
          onDetail={setDetailVm}
          onHistory={setHistoryVm}
        />
      ) : null}
      <FollowupView
        detail={detailVm}
        history={historyVm}
        isReady={!list.isPending}
        list={vm.list}
        listError={list.error ?? null}
        listPending={list.isPending}
        onClearSelection={handleClearSelection}
        onSelect={handleSelect}
        onStatusChange={handleStatusChange}
        selectedId={selectedId}
        status={status}
        statusOptions={FOLLOWUP_STATUSES}
        title="Business follow-up"
      />
    </>
  )
}