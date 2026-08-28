/**
 * Honest state for a page that is not (yet) fully live: a server-API gap
 * (blocked), a read-only/partial slice, or a permission denial. It never
 * pretends the feature works — it names exactly what the server is missing so
 * the operator (and TOTAL-CONTROL) can see the gap. Fully-built pages replace
 * this as their server contract lands.
 */

import { EmptyState, usePluginI18n } from '@hermes/plugin-sdk'
import type { ReactNode } from 'react'

import type { ConsolePage } from './catalog'

function PlaceholderFrame({ children, page, status }: { children: ReactNode; page: ConsolePage; status: string }) {
  return (
    <div
      className="mx-auto flex w-full max-w-[96rem] flex-col px-(--ec-page-inset-x) py-(--ec-page-inset-y)"
      data-page-status={status}
      data-testid={`console-page-${page.id}`}
    >
      {children}
    </div>
  )
}

export function BlockedPage({ page }: { page: ConsolePage }) {
  const t = usePluginI18n('enterprise-console')

  return (
    <PlaceholderFrame page={page} status={page.status}>
      <EmptyState
        description={page.gap ? `${t('status.blockedBody')}\n\n${page.gap}` : t('status.blockedBody')}
        title={t('status.blocked')}
      />
    </PlaceholderFrame>
  )
}

export function DeniedPage({ page }: { page: ConsolePage }) {
  const t = usePluginI18n('enterprise-console')

  return (
    <PlaceholderFrame page={page} status="denied">
      <EmptyState description={t('status.deniedBody')} title={t('status.denied')} />
    </PlaceholderFrame>
  )
}

/** Partial pages get a real body eventually; until then, name the read-only gap. */
export function PartialPlaceholder({ page }: { page: ConsolePage }) {
  const t = usePluginI18n('enterprise-console')

  return (
    <PlaceholderFrame page={page} status={page.status}>
      <EmptyState description={page.gap ?? t('status.partial')} title={t('status.partial')} />
    </PlaceholderFrame>
  )
}

/** Server contract confirmed (API_READY) but the console page is not built in
 *  this slice — shown honestly as pending, never as a live feature. */
export function PendingPage({ page }: { page: ConsolePage }) {
  const t = usePluginI18n('enterprise-console')

  return (
    <PlaceholderFrame page={page} status={page.status}>
      <EmptyState description={t('status.pendingBody')} title={t('status.pending')} />
    </PlaceholderFrame>
  )
}
