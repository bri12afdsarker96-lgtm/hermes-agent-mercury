/**
 * Follow-up page (SC1) — Glue layer.
 *
 * Owns: status filter + selected id state. Composes: 3 queries + view
 * model + view. The responsive matchMedia hook lives here so the view
 * never reads window.matchMedia directly.
 *
 * Wave 1 / Step 14 of W5-B0 Controller/View Contract Freeze.
 */

import { useCallback, useEffect, useState } from 'react'

import { findPage } from './catalog'
import { fmtIso } from './page-kit'
import {
 type FollowupStatus,
 useFollowupDetail,
 useFollowupHistory,
 useFollowupList,
} from './page-followup.controller'
import { deriveFollowupViewModel } from './page-followup.view-model'
import { FollowupView } from './page-followup.view'
import { useWhoami } from './session'

const COMPACT_DETAIL_QUERY = '(max-width: 1439px)'

/** Resolve the responsive breakpoint — true when the viewport is ≤
 *  1439px wide and the detail should collapse into a bottom sheet. */
function useCompactDetail(): boolean {
  const [compact, setCompact] = useState(() => {
    return (
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia(COMPACT_DETAIL_QUERY).matches
    )
  })

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return
    }

    const query = window.matchMedia(COMPACT_DETAIL_QUERY)
    const update = () => setCompact(query.matches)

    update()
    query.addEventListener('change', update)

    return () => {
      query.removeEventListener('change', update)
    }
  }, [])

  return compact
}

export function FollowupPage() {
  const who = useWhoami()
  const page = findPage('followup')!

  const [status, setStatus] = useState<'' | FollowupStatus>('')
  const [selectedId, setSelectedId] = useState<null | string>(null)
  const compactDetail = useCompactDetail()

  const onStatusFilterChange = useCallback((value: '' | FollowupStatus) => {
    setStatus(value)
  }, [])

  const onSelectFollowup = useCallback((followupId: string) => {
    setSelectedId(prev => (prev === followupId ? null : followupId))
  }, [])

  const onCloseSheet = useCallback(() => {
    setSelectedId(null)
  }, [])

  const listQuery = useFollowupList(status)
  const detailQuery = useFollowupDetail(selectedId)
  const historyQuery = useFollowupHistory(selectedId)

  return (
    <FollowupView
      compactDetail={compactDetail}
      fmtIso={fmtIso}
      onCloseSheet={onCloseSheet}
      onSelectFollowup={onSelectFollowup}
      onStatusFilterChange={onStatusFilterChange}
      statusFilter={status}
      vm={deriveFollowupViewModel({
        page,
        whoami: who,
        detail: {
          data: detailQuery.data,
          error: detailQuery.error,
          isPending: detailQuery.isPending,
        },
        history: {
          data: historyQuery.data,
          error: historyQuery.error,
          isPending: historyQuery.isPending,
        },
        list: {
          data: listQuery.data,
          error: listQuery.error,
          isPending: listQuery.isPending,
        },
        selectedId,
      })}
    />
  )
}