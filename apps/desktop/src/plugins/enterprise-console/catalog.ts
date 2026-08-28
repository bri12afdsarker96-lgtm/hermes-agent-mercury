/**
 * The Phase-1 page catalog — the DESKTOP_PHASE1_INTERFACE_FREEZE encoded in
 * code. `status` is the READ status (drives the nav badge); `controlStatus` is
 * the write/workflow status, kept separate so "the page has data" is never
 * mistaken for "the workflow is complete" (per TOTAL-CONTROL). See
 * docs/enterprise-console/WRITE_SURFACE_CENSUS.md.
 *
 * status (read):
 *   'ready' | 'ready-dev' | 'partial' | 'blocked' (SERVER_API_GAP — never faked).
 * controlStatus (write): 'ready' | 'partial' | 'missing'.
 */

export type ControlStatus = 'missing' | 'partial' | 'ready'
export type PageStatus = 'blocked' | 'partial' | 'ready' | 'ready-dev'

export interface ConsolePage {
  capability?: string
  /** Write/workflow surface the server exposes (real HTTP routes only). */
  controlStatus: ControlStatus
  /** For blocked/partial: what the server is missing, for the operator. */
  gap?: string
  /** Hide the nav row entirely when the viewer lacks `permission` (for
   *  tenant_admin-only surfaces where even the row should not appear). Default
   *  behavior otherwise: the row shows and the content is a DeniedPage. */
  hideWhenUnpermitted?: boolean
  id: string
  labelKey: string
  permission?: string
  status: PageStatus
}

export const CONSOLE_PAGES: ConsolePage[] = [
  {
    capability: 'metrics',
    controlStatus: 'ready',
    id: 'dashboard',
    labelKey: 'page.dashboard',
    permission: 'metrics.view',
    status: 'ready'
  },
  {
    // SC5 /api/wecom-status now supplies real tenant-scoped association +
    // credential-state facts (read-only integration status).
    controlStatus: 'ready',
    id: 'wecom',
    labelKey: 'page.wecom',
    permission: 'channel.binding.manage',
    status: 'ready'
  },
  {
    // SC2 ChannelBinding list + create/revoke routes now exist (the binding
    // section self-gates in-component on channel.binding.manage).
    controlStatus: 'ready',
    id: 'identity',
    labelKey: 'page.identity',
    permission: 'principal.crud',
    status: 'ready'
  },
  {
    // SC3 /api/conversations-inbound|outbound|attempts (conversation.read — NOT
    // delivery.read). Read-only by design: the server deliberately exposes no
    // operator retry/held-release (unknown-delivery must not be blindly resent).
    controlStatus: 'missing',
    id: 'conversations',
    labelKey: 'page.conversations',
    permission: 'conversation.read',
    status: 'ready'
  },
  {
    capability: 'biz_tasks',
    controlStatus: 'ready',
    id: 'tasks',
    labelKey: 'page.tasks',
    permission: 'biztask.read',
    status: 'ready'
  },
  {
    // SC1 /api/followup-list|detail|history (followup.read; owner-scoped for
    // managed roles inside the server model). Read-only: no followup-* write
    // route exists in Phase-1 (transitions are actor-driven, not admin-driven).
    controlStatus: 'missing',
    id: 'followup',
    labelKey: 'page.followup',
    permission: 'followup.read',
    status: 'ready'
  },
  {
    capability: 'reminders',
    controlStatus: 'ready',
    id: 'reminders',
    labelKey: 'page.reminders',
    permission: 'reminder.read',
    status: 'ready'
  },
  {
    capability: 'knowledge_rag',
    controlStatus: 'ready',
    id: 'knowledge',
    labelKey: 'page.knowledge',
    permission: 'kb.author',
    status: 'ready-dev'
  },
  {
    capability: 'handoff',
    controlStatus: 'ready',
    id: 'handoff',
    labelKey: 'page.handoff',
    permission: 'inbox.list',
    status: 'ready'
  },
  {
    capability: 'metrics',
    controlStatus: 'ready',
    id: 'alerts',
    labelKey: 'page.alerts',
    permission: 'metrics.view',
    status: 'ready'
  },
  { controlStatus: 'ready', id: 'provider', labelKey: 'page.provider', permission: 'provider.set', status: 'ready' },
  {
    // Budget config reads via /api/tenant-profile (tenant.profile.read — NOT
    // metrics.view, which operators also hold and would wrongly pass the gate).
    // Real-time token usage/spend still has no server endpoint → honestly partial.
    controlStatus: 'partial',
    gap: 'budget config is ready; real-time token usage/spend has no server endpoint',
    id: 'usage',
    labelKey: 'page.usage',
    permission: 'tenant.profile.read',
    status: 'partial'
  },
  {
    // SC4 /api/audit-list|detail|correlate (audit.read; tenant_admin-only,
    // undelegatable). Read-only evidence — NEVER re-execution/replay. Hidden
    // from the nav entirely for non-admins.
    controlStatus: 'missing',
    hideWhenUnpermitted: true,
    id: 'audit',
    labelKey: 'page.audit',
    permission: 'audit.read',
    status: 'ready'
  }
]

export function findPage(id: string): ConsolePage | undefined {
  return CONSOLE_PAGES.find(page => page.id === id)
}
