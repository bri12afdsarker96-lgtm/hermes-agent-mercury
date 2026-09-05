/**
 * Honest state for a page that is not (yet) fully live: a server-API gap
 * (blocked), a read-only/partial slice, or a permission denial. It never
 * pretends the feature works — it names exactly what the server is missing so
 * the operator (and TOTAL-CONTROL) can see the gap. Fully-built pages replace
 * this as their server contract lands.
 */

import { EmptyState, usePluginI18n } from '@hermes/plugin-sdk'

import type { ConsolePage } from './catalog'

export function BlockedPage({ page }: { page: ConsolePage }) {
  const t = usePluginI18n('enterprise-console')

  return (
    <div data-page-status={page.status} data-testid={`console-page-${page.id}`}>
      <EmptyState
        description={page.gap ? `${t('status.blockedBody')}\n\n${page.gap}` : t('status.blockedBody')}
        title={t('status.blocked')}
      />
    </div>
  )
}

export function DeniedPage({ page }: { page: ConsolePage }) {
  const t = usePluginI18n('enterprise-console')

  return (
    <div data-page-status="denied" data-testid={`console-page-${page.id}`}>
      <EmptyState description={t('status.deniedBody')} title={t('status.denied')} />
    </div>
  )
}

/** Partial pages get a real body eventually; until then, name the read-only gap. */
export function PartialPlaceholder({ page }: { page: ConsolePage }) {
  const t = usePluginI18n('enterprise-console')

  return (
    <div data-page-status={page.status} data-testid={`console-page-${page.id}`}>
      <EmptyState description={page.gap ?? t('status.partial')} title={t('status.partial')} />
    </div>
  )
}

/** Server contract confirmed (API_READY) but the console page is not built in
 *  this slice — shown honestly as pending, never as a live feature. */
export function PendingPage({ page }: { page: ConsolePage }) {
  const t = usePluginI18n('enterprise-console')

  return (
    <div data-page-status={page.status} data-testid={`console-page-${page.id}`}>
      <EmptyState description={t('status.pendingBody')} title={t('status.pending')} />
    </div>
  )
}
