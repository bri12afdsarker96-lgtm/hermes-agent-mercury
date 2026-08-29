/**
 * Conversations page (SC3) — Glue layer.
 *
 * Composes:
 *   - controller (useInboundList / useOutboundList / useAttemptsList)
 *   - view-model (deriveInboundList / deriveOutboundList / deriveAttemptsList)
 *   - view (ConversationsView) — for inbound + tab + outbound list
 *   - glue-rendered AttemptsBlock for the selected outbound row
 *
 * The glue owns the React Query hook for per-row attempts because the
 * view can't call hooks inline. The view renders the structural
 * shell and the list; the glue slots the attempts block into the
 * selected row's cell.
 *
 * Visual output is identical to the pre-split page-conversations.tsx.
 * No data-testid values change. No new mutation surface. The delivery
 * attempts stay evidence-only — no resend/replay/retry button is
 * exposed.
 */

import {
  EmptyState,
  Loader,
  StatusDot,
  usePluginI18n,
} from '@hermes/plugin-sdk'
import { useState } from 'react'

import { useAttemptsList, useInboundList, useOutboundList } from './page-conversations.controller'
import { ConversationsView } from './page-conversations.view'
import {
  type ConversationsTab,
  deriveAttemptsList,
  deriveInboundList,
  deriveOutboundList,
  OUTCOME_TONE,
  STATE_TONE,
} from './page-conversations.view-model'

/**
 * Glue-local component that mounts the controller's `useAttemptsList`
 * hook for the selected outbound row. The view does not see this
 * component; the glue slots it into the list cell directly.
 */
function SelectedAttempts({
  internalMessageId,
}: {
  internalMessageId: string
}) {
  const t = usePluginI18n('enterprise-console')
  const query = useAttemptsList(internalMessageId)
  const attempts = deriveAttemptsList(query.data?.attempts ?? [])

  if (query.isPending) {
    return (
      <div className="mt-2 border-l border-(--ui-stroke-tertiary) pl-3">
        <Loader />
      </div>
    )
  }

  if (attempts.isEmpty) {
    return (
      <div className="mt-2 border-l border-(--ui-stroke-tertiary) pl-3">
        <EmptyState title="no attempts" />
      </div>
    )
  }

  return (
    <div className="mt-2 border-l border-(--ui-stroke-tertiary) pl-3">
      <ul className="divide-y divide-(--ui-stroke-tertiary)" data-testid="console-conv-attempts">
        {attempts.rows.map((row) => (
          <li className="flex items-center justify-between gap-3 py-2" key={row.attemptId}>
            <span className="min-w-0 truncate text-(--ui-text-secondary)" data-ec-mono="">
              #{row.attemptNumber} · {row.outcomeClass} · {row.finishedTs ?? '—'}
            </span>
            <span className="inline-flex shrink-0 items-center gap-1.5 text-(--ui-text-secondary)">
              <StatusDot
                tone={OUTCOME_TONE[row.outcomeClass] ?? STATE_TONE[row.state] ?? 'muted'}
              />
              {row.state}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-(--ui-text-tertiary)">{t('status.moduleBody')}</p>
    </div>
  )
}

export function ConversationsPage() {
  const [tab, setTab] = useState<ConversationsTab>('inbound')
  const [selected, setSelected] = useState<null | string>(null)

  const inbound = useInboundList()
  const outbound = useOutboundList()

  const inboundVm = deriveInboundList(inbound.data?.inbound ?? [])
  const outboundVm = deriveOutboundList(outbound.data?.outbound ?? [])

  return (
    <ConversationsView
      attemptsSlot={selected ? <SelectedAttempts internalMessageId={selected} /> : null}
      inbound={inboundVm}
      inboundError={inbound.error}
      inboundPending={inbound.isPending}
      onChangeTab={setTab}
      onSelect={(id) => setSelected((prev) => (prev === id ? null : id))}
      outbound={outboundVm}
      outboundError={outbound.error}
      outboundPending={outbound.isPending}
      selected={selected}
      tab={tab}
    />
  )
}