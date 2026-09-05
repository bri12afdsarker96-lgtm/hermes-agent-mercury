/**
 * ConsoleShell — the `/console` page body: a connect gate, then a left sub-nav
 * over the 13 Phase-1 pages and a content area. One top-level route hosts all
 * pages (internal `$activePage`) so the console never sprawls across reserved
 * paths. Every nav row carries its freeze status; content is gated by the
 * server's permission (UI display control only).
 */

import { atom, Button, usePluginI18n, useValue } from '@hermes/plugin-sdk'
import type { ComponentType } from 'react'

import { hasPermission } from './capabilities'
import { CONSOLE_PAGES, type ConsolePage } from './catalog'
import { AlertsPage } from './page-alerts'
import { AuditPage } from './page-audit'
import { ConversationsPage } from './page-conversations'
import { DashboardPage } from './page-dashboard'
import { FollowupPage } from './page-followup'
import { HandoffPage } from './page-handoff'
import { IdentityPage } from './page-identity'
import { KnowledgePage } from './page-knowledge'
import { BlockedPage, DeniedPage, PartialPlaceholder, PendingPage } from './page-placeholder'
import { ProviderPage } from './page-provider'
import { RemindersPage } from './page-reminders'
import { TasksPage } from './page-tasks'
import { UsagePage } from './page-usage'
import { WeComPage } from './page-wecom'
import { $whoami, disconnect } from './session'
import { PageStatusBadge } from './status-badge'
import type { Whoami } from './types'

/** In-memory selected page (defaults to the live dashboard). */
export const $activePage = atom<string>('dashboard')

/** Pages with a real implementation. Everything else falls through to an honest
 *  status placeholder (blocked / partial / pending) — never a fabricated view. */
const PAGE_COMPONENTS: Record<string, ComponentType> = {
  alerts: AlertsPage,
  audit: AuditPage,
  conversations: ConversationsPage,
  dashboard: DashboardPage,
  followup: FollowupPage,
  handoff: HandoffPage,
  identity: IdentityPage,
  knowledge: KnowledgePage,
  provider: ProviderPage,
  reminders: RemindersPage,
  tasks: TasksPage,
  usage: UsagePage,
  wecom: WeComPage
}

function renderPage(page: ConsolePage, who: Whoami) {
  if (page.permission && !hasPermission(who, page.permission)) {
    return <DeniedPage page={page} />
  }

  const Component = PAGE_COMPONENTS[page.id]

  if (Component) {
    return <Component />
  }

  if (page.status === 'blocked') {
    return <BlockedPage page={page} />
  }

  if (page.status === 'partial') {
    return <PartialPlaceholder page={page} />
  }

  return <PendingPage page={page} />
}

function SessionHeader({ who }: { who: Whoami }) {
  const t = usePluginI18n('enterprise-console')

  return (
    <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-2">
      <div className="text-sm font-semibold">{t('title')}</div>
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span data-testid="console-header-principal">{who.name}</span>
        <span>·</span>
        <span>{who.tenant_id ?? '—'}</span>
        <span>·</span>
        <span>{who.role}</span>
        <Button data-testid="console-disconnect" onClick={() => disconnect()} size="sm" variant="ghost">
          {t('session.disconnect')}
        </Button>
      </div>
    </header>
  )
}

export function ConsoleShell() {
  const t = usePluginI18n('enterprise-console')
  const who = useValue($whoami)
  const activeId = useValue($activePage)

  if (!who) {
    // Production console access is native one-login only. Never render a
    // renderer token form as a fallback: the main process owns the bearer.
    return (
      <div className="mx-auto mt-16 max-w-sm text-sm text-muted-foreground" data-testid="console-session-unavailable">
        enterprise session unavailable — sign in to the desktop account and retry
      </div>
    )
  }

  // Nav rows for surfaces flagged hideWhenUnpermitted (e.g. audit, tenant_admin
  // only) are omitted entirely for viewers who lack the permission — the row
  // does not merely deny in content. Other pages keep the row + DeniedPage.
  const navPages = CONSOLE_PAGES.filter(
    page => !(page.hideWhenUnpermitted && page.permission && !hasPermission(who, page.permission))
  )

  const active = navPages.find(page => page.id === activeId) ?? navPages[0]

  return (
    <div className="flex h-full flex-col" data-testid="enterprise-console">
      <SessionHeader who={who} />
      <div className="flex min-h-0 flex-1">
        <nav className="w-52 shrink-0 overflow-y-auto border-r border-border p-2" data-testid="console-nav">
          {navPages.map(page => (
            <button
              className={
                page.id === active.id
                  ? 'flex w-full flex-col items-start gap-0.5 rounded-md bg-accent px-2 py-1.5 text-left text-sm'
                  : 'flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent/50'
              }
              data-active={page.id === active.id}
              data-testid={`console-nav-${page.id}`}
              key={page.id}
              onClick={() => $activePage.set(page.id)}
              type="button"
            >
              <span>{t(page.labelKey)}</span>
              <PageStatusBadge status={page.status} />
            </button>
          ))}
        </nav>
        <section className="min-w-0 flex-1 overflow-y-auto p-4" data-testid="console-content">
          {renderPage(active, who)}
        </section>
      </div>
    </div>
  )
}
