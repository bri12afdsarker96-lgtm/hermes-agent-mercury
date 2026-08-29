/**
 * Conversations page (SC3) — Glue layer.
 *
 * Composes:
 *   - controller (useInboundList / useOutboundList / useAttemptsList)
 *   - view-model (deriveInboundList / deriveOutboundList / deriveAttemptsList)
 *   - view (ConversationsView)
 *
 * Per W1-B1-REMEDIATION-01:
 *   - §P17: this glue is THIN COMPOSITION ONLY. No presentation markup
 *     (no Loader / EmptyState / StatusDot / `<ul>` / CSS classes / text).
 *     All rendering lives in `page-conversations.view.tsx`.
 *   - §P18: attempts error state flows to the view via the attemptsSlot
 *     container which passes error through to the view's
 *     `<AttemptsView>` via QueryBody. The view preserves loading /
 *     error / not_implemented / empty / ready semantics.
 *   - §P19: this glue owns the `fmtIso` import (existing formatter).
 *   - §P20: NO extra `t('status.moduleBody')` paragraph is rendered.
 *
 * The per-row attempts detail block is mounted as an `attemptsSlot`
 * ReactNode prop. The slot renders an `<AttemptsView>` (view) with
 * data lifted up via state setters (so the view re-renders when the
 * query resolves).
 */

import { useEffect, useState } from 'react'

import {
  useAttemptsList,
  useInboundList,
  useOutboundList,
} from './page-conversations.controller'
import {
  AttemptsView,
  ConversationsView,
} from './page-conversations.view'
import {
  type ConversationsAttemptsView,
  type ConversationsTab,
  deriveAttemptsList,
  deriveInboundList,
  deriveOutboundList,
} from './page-conversations.view-model'
import { fmtIso } from './page-kit'

/**
 * Glue-local controller bridge for the selected outbound row. Calls
 * `useAttemptsList` (controller hook), pushes the derived VM up to
 * `ConversationsPage` state via `useEffect` → setState. The view's
 * `<AttemptsView>` consumes the resolved VM. The container itself
 * renders nothing (returns null).
 */
function SelectedAttemptsContainer({
  internalMessageId,
  onAttempts,
}: {
  internalMessageId: string
  onAttempts: (vm: { view: ConversationsAttemptsView; isPending: boolean; error: unknown }) => void
}) {
  const query = useAttemptsList(internalMessageId)
  useEffect(() => {
    onAttempts({
      view: deriveAttemptsList(query.data?.attempts ?? [], fmtIso),
      isPending: query.isPending,
      error: query.error ?? null,
    })
  }, [query.data, query.isPending, query.error, onAttempts])

  return null
}

export function ConversationsPage() {
  const [tab, setTab] = useState<ConversationsTab>('inbound')
  const [selected, setSelected] = useState<null | string>(null)

  const [attemptsState, setAttemptsState] = useState<{
    view: ConversationsAttemptsView
    isPending: boolean
    error: unknown
  }>({ view: { rows: [], isEmpty: true }, isPending: false, error: null })

  const inbound = useInboundList()
  const outbound = useOutboundList()

  const inboundVm = deriveInboundList(inbound.data?.inbound ?? [], fmtIso)
  const outboundVm = deriveOutboundList(outbound.data?.outbound ?? [], fmtIso)

  return (
    <>
      {selected ? (
        <SelectedAttemptsContainer
          internalMessageId={selected}
          onAttempts={setAttemptsState}
        />
      ) : null}
      <ConversationsView
        attemptsSlot={
          selected ? (
            <AttemptsView
              attempts={attemptsState.view}
              error={attemptsState.error}
              isPending={attemptsState.isPending}
            />
          ) : null
        }
        inbound={inboundVm}
        inboundError={inbound.error ?? null}
        inboundPending={inbound.isPending}
        onChangeTab={setTab}
        onSelect={(id) => setSelected((prev) => (prev === id ? null : id))}
        outbound={outboundVm}
        outboundError={outbound.error ?? null}
        outboundPending={outbound.isPending}
        selected={selected}
        tab={tab}
      />
    </>
  )
}