/**
 * ConsoleShell — the enterprise product shell for `Hermes-企业助手`.
 *
 * Renders a Design-System-aligned enterprise chrome over the 13 Phase-1 pages:
 * a BrandMark-locked left nav (AppSidebar-style), an enterprise TopHeader
 * (tenant / role / principal), a content area, and a bottom StatusBar. One
 * top-level route hosts all pages (internal `$activePage`) so the console never
 * sprawls across reserved paths. Every nav row carries its freeze status;
 * content is gated by the server's permission (UI display control only).
 *
 * Authority note: this is presentation only. Identity / tenant / permission /
 * capability all come from the Hermes server via the existing transport; the
 * renderer holds no bearer (main owns the session).
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

/** Brand lockup: wing mark + product wordmark. The plugin SDK boundary
 *  (no-restricted-imports) prevents importing the shell's shared BrandMark,
 *  so the enterprise console keeps its own minimal lockup. */
const assetPath = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`

function BrandMark() {
  return (
    <div aria-label="Hermes-企业助手" className="flex min-w-0 items-center gap-2 px-1">
      <img alt="" aria-hidden="true" className="h-6 w-auto shrink-0" src={assetPath('brand/hermes-mark.svg')} />
      <span aria-hidden="true" className="truncate text-[13px] font-medium tracking-wide text-[--ui-text-primary]">
        Hermes-企业助手
      </span>
    </div>
  )
}

/** Enterprise TopHeader: tenant + role + principal + disconnect. */
function EnterpriseHeader({ who }: { who: Whoami }) {
  const t = usePluginI18n('enterprise-console')

  return (
    <header className="flex h-14 min-w-0 shrink-0 items-center justify-between gap-3 border-b border-border bg-[--ui-bg-surface] px-4">
      <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-[--ui-text-primary]">
        <span aria-hidden="true">🏢</span>
        <span className="max-w-40 truncate" title={who.tenant_id ?? '—'}>
          {who.tenant_id ?? '—'}
        </span>
      </div>
      <div className="flex min-w-0 items-center justify-end gap-2 text-xs text-muted-foreground">
        <span className="max-w-40 truncate" data-testid="console-header-principal" title={who.name}>
          {who.name}
        </span>
        <span
          aria-hidden="true"
          className="rounded px-1.5 py-0.5 text-[11px] text-[--status-info-fg] bg-[--status-info-bg]"
        >
          {who.role}
        </span>
        <Button data-testid="console-disconnect" onClick={() => disconnect()} size="sm" variant="ghost">
          {t('session.disconnect')}
        </Button>
      </div>
    </header>
  )
}

/** Bottom StatusBar: machine facts, quietly stated. */
function EnterpriseStatusBar({ who }: { who: Whoami }) {
  return (
    <footer className="flex h-10 shrink-0 items-center gap-3 border-t border-border bg-[--ui-bg-chrome] px-4 text-[11px] text-[--ui-text-secondary]">
      <span className="inline-flex items-center gap-1.5 rounded bg-[--status-info-bg] px-2 py-0.5 text-[--status-info-fg]">
        <span aria-hidden="true">●</span>
        已连接
      </span>
      <span className="inline-flex items-center gap-1.5 rounded border border-[--ui-stroke-secondary] bg-[--ui-bg-surface] px-2 py-0.5">
        <span className="text-[--ui-text-tertiary]">身份</span>
        <span className="text-[--ui-text-primary]">{who.name}</span>
      </span>
      <span className="flex-1" />
      <span className="text-[--ui-text-tertiary]">Hermes-企业助手</span>
    </footer>
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
      <div className="flex min-h-0 flex-1">
        <nav
          aria-label="Enterprise console"
          className="w-(--ec-sidebar-w) flex shrink-0 flex-col overflow-y-auto border-r border-border p-2"
          data-testid="console-nav"
        >
          <div className="flex h-14 shrink-0 items-center border-b border-border px-1">
            <BrandMark />
          </div>
          {navPages.map(page => (
            <button
              aria-current={page.id === active.id ? 'page' : undefined}
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
        <div className="flex min-w-0 flex-1 flex-col">
          <EnterpriseHeader who={who} />
          <section className="min-w-0 flex-1 overflow-y-auto" data-testid="console-content">
            {renderPage(active, who)}
          </section>
          <EnterpriseStatusBar who={who} />
        </div>
      </div>
    </div>
  )
}
