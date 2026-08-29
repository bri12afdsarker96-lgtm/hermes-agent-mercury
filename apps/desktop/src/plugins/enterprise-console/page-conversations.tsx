/**
 * Conversations page (SC3) — Glue layer.
 *
 * Composes:
 *   - controller (useInboundList / useOutboundList / useAttemptsList)
 *   - view-model (deriveInboundList / deriveOutboundList / deriveAttemptsList)
 *   - view (ConversationsView / AttemptsView / InboundListView /
 *     OutboundListView)
 *
 * Per W1-B1-REMEDIATION-01:
 *   - §P17: thin composition; no presentation markup.
 *   - §P18: attempts error state flows through the attemptsSlot
 *     container so the view's `<AttemptsView>` renders QueryBody
 *     semantics (loading / error / not_implemented / empty / ready).
 *   - §P19: fmtIso ownership lives here.
 *   - §P20: no extra `t('status.moduleBody')` paragraph.
 *
 * Per W1-B1-REMEDIATION-02:
 *   - §P14: the attempts container returns the view DIRECTLY (no
 *     useEffect relay, no parent-cached attempts state). React Query
 *     state is consumed inside the container synchronously on each
 *     render. Selection identity === render identity ===
 *     query identity via `key={selected}`.
 *   - §P15: a switch from m1 → m2 tears down the m1 container
 *     (and its React Query subscription) immediately; the
 *     `attemptsSlot` slot never carries a stale m1 response.
 */

import { useState } from 'react'

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
  type ConversationsTab,
  deriveAttemptsList,
  deriveInboundList,
  deriveOutboundList,
} from './page-conversations.view-model'
import { fmtIso } from './page-kit'

/**
 * Per W1-B1-REMEDIATION-02 §P14:
 * Container binds attempts to the selected id via `key={selected}`
 * (mounted by `ConversationsPage`). On any selection change, React
 * tears down the old container (and its React Query subscription)
 * and mounts a fresh one for the new id. There is no useEffect
 * relay and no parent-cached VM state. The container returns the
 * rendered view directly.
 */
function SelectedAttemptsContainer({
  internalMessageId,
}: {
  internalMessageId: string
}) {
  const query = useAttemptsList(internalMessageId)
  const attempts = deriveAttemptsList(query.data?.attempts ?? [], fmtIso)

  return (
    <AttemptsView
      attempts={attempts}
      error={query.error ?? null}
      isPending={query.isPending}
    />
  )
}

export function ConversationsPage() {
  const [tab, setTab] = useState<ConversationsTab>('inbound')
  const [selected, setSelected] = useState<null | string>(null)

  const inbound = useInboundList()
  const outbound = useOutboundList()

  const inboundVm = deriveInboundList(inbound.data?.inbound ?? [], fmtIso)
  const outboundVm = deriveOutboundList(outbound.data?.outbound ?? [], fmtIso)

  return (
    <>
      <ConversationsView
        attemptsSlot={
          selected ? (
            <SelectedAttemptsContainer
              internalMessageId={selected}
              key={selected}
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