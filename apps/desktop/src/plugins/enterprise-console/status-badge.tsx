/**
 * Small presentational badges that turn a page's freeze status and a server
 * capability's maturity into an honest, consistent visual — reused by the shell
 * nav and the page bodies so "ready / partial / blocked / dev" always read the
 * same. Capability Truth lives here: DEV/CONTRACT/PLANNED never render as green.
 */

import { StatusDot, type StatusTone, usePluginI18n } from '@hermes/plugin-sdk'

import type { PageStatus } from './catalog'
import type { CapabilityStatus } from './types'

const PAGE_TONE: Record<PageStatus, StatusTone> = {
  blocked: 'bad',
  partial: 'warn',
  ready: 'good',
  'ready-dev': 'warn'
}

const PAGE_LABEL_KEY: Record<PageStatus, string> = {
  blocked: 'status.blocked',
  partial: 'status.partial',
  ready: 'status.ready',
  'ready-dev': 'status.dev'
}

export function PageStatusBadge({ status }: { status: PageStatus }) {
  const t = usePluginI18n('enterprise-console')

  return (
    <span className="inline-flex items-center gap-1 text-[0.6875rem] text-muted-foreground">
      <StatusDot tone={PAGE_TONE[status]} />
      {t(PAGE_LABEL_KEY[status])}
    </span>
  )
}

const CAP_TONE: Record<CapabilityStatus, StatusTone> = {
  CONTRACT: 'muted',
  DEV: 'warn',
  LIVE: 'good',
  PLANNED: 'muted'
}

/** The server's own maturity verdict for a capability, verbatim. */
export function CapabilityBadge({ status }: { status: CapabilityStatus }) {
  return (
    <span className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[0.6875rem] uppercase tracking-wide text-muted-foreground">
      <StatusDot tone={CAP_TONE[status]} />
      {status}
    </span>
  )
}
