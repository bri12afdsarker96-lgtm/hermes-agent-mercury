/**
 * Audit evidence page (SC4) — Glue layer.
 *
 * Owns: action / resourceRef filter state + selected event id +
 * correlate resource state. Composes: 3 queries + view-model + view.
 *
 * Wave 1 / Step 12 of W5-B0 Controller/View Contract Freeze.
 */

import { useCallback, useState } from 'react'

import { findPage } from './catalog'
import { fmtIso } from './page-kit'
import { useWhoami } from './session'
import {
  useAuditCorrelate,
  useAuditDetail,
  useAuditList,
} from './page-audit.controller'
import { deriveAuditViewModel } from './page-audit.view-model'
import { AuditView } from './page-audit.view'

export function AuditPage() {
  const who = useWhoami()
  const page = findPage('audit')!

  // Filter state — drives both the view's AuditFilterBar inputs and
  // the controller's audit-list queryKey (so filter changes invalidate
  // and refetch).
  const [action, setAction] = useState('')
  const [resourceRef, setResourceRef] = useState('')

  // Selection state — drives the detail query and the chain query.
  const [selectedId, setSelectedId] = useState<null | string>(null)
  const [correlateRef, setCorrelateRef] = useState<null | string>(null)

  const onFilterChange = useCallback((a: string, r: string) => {
    setAction(a)
    setResourceRef(r)
  }, [])

  const onSelectEvent = useCallback((id: string | null) => {
    setSelectedId(id)
  }, [])

  const onCorrelateResource = useCallback((ref: string | null) => {
    setCorrelateRef(ref)
  }, [])

  const listQuery = useAuditList(action, resourceRef)
  const detailQuery = useAuditDetail(selectedId)
  const chainQuery = useAuditCorrelate(correlateRef)

  return (
    <AuditView
      fmtIso={fmtIso}
      onCorrelateResource={onCorrelateResource}
      onFilterChange={onFilterChange}
      onSelectEvent={onSelectEvent}
      vm={deriveAuditViewModel({
        page,
        whoami: who,
        list: { data: listQuery.data, error: listQuery.error, isPending: listQuery.isPending },
        chain: correlateRef
          ? {
              data: chainQuery.data,
              error: chainQuery.error,
              isPending: chainQuery.isPending,
              resourceRef: correlateRef,
            }
          : null,
        detail: selectedId
          ? {
              data: detailQuery.data,
              error: detailQuery.error,
              isPending: detailQuery.isPending,
              eventId: selectedId,
            }
          : null,
      })}
    />
  )
}