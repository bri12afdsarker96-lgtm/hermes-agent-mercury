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
    controlStatus: 'missing',
    gap: 'server has only a static connector schema — no integration status, callback health, or secret-state authority',
    id: 'wecom',
    labelKey: 'page.wecom',
    status: 'blocked'
  },
  {
    controlStatus: 'partial',
    gap: 'ChannelBinding has no HTTP route (identity/principals is ready)',
    id: 'identity',
    labelKey: 'page.identity',
    permission: 'principal.crud',
    status: 'partial'
  },
  {
    capability: 'delivery',
    controlStatus: 'missing',
    gap: 'inbound / held / recovery have no server route; outbound delivery-outbox is read-only',
    id: 'conversations',
    labelKey: 'page.conversations',
    permission: 'delivery.read',
    status: 'partial'
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
    controlStatus: 'missing',
    gap: 'domain exists (enterprise/followup.py) but no HTTP route — awaiting a server companion',
    id: 'followup',
    labelKey: 'page.followup',
    status: 'blocked'
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
    controlStatus: 'partial',
    gap: 'budget config is ready; real-time token usage/spend has no server endpoint',
    id: 'usage',
    labelKey: 'page.usage',
    permission: 'metrics.view',
    status: 'partial'
  },
  {
    controlStatus: 'missing',
    gap: 'audit is append-only write — no read/replay route',
    id: 'audit',
    labelKey: 'page.audit',
    status: 'blocked'
  }
]

export function findPage(id: string): ConsolePage | undefined {
  return CONSOLE_PAGES.find(page => page.id === id)
}
