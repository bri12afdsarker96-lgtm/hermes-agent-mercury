import { type ComponentProps, type CSSProperties, type ReactNode, useEffect, useRef } from 'react'

import { useWindowControlsOverlayWidth } from '@/app/shell/hooks/use-window-controls-overlay-width'
import { Brain, FileText, LayoutDashboard, Lock, MessageSquareText, Network, NotebookTabs, Settings, Users, Wrench } from '@/lib/icons'

import hermesMark from './assets/hermes-mark.svg'
import { EnterprisePackageUpdateButton } from './package-update-ui'

export type EnterpriseStatusTone = 'error' | 'success' | 'warning'

interface EnterpriseTitlebarProps extends ComponentProps<'header'> {
  style?: CSSProperties
}

/** One reservation for login, password-change and connected desktop chrome. */
export function EnterpriseTitlebar({ style, ...props }: EnterpriseTitlebarProps) {
  const measured = useWindowControlsOverlayWidth()
  const overlay = (navigator as Navigator & { windowControlsOverlay?: { visible: boolean } }).windowControlsOverlay
  const width = measured ?? (overlay?.visible ? 138 : 0)

  return <header {...props} style={{ ...style, '--hesc-window-controls-width': `${width}px` } as CSSProperties} />
}

export interface EnterpriseShellWorkspace {
  glyph: string
  id: string
  label: string
}

const WORKSPACE_ICONS = {
  assistant: Brain,
  knowledge_qa: NotebookTabs,
  customer_replies: MessageSquareText,
  conversations: MessageSquareText,
  governance: Users,
  handoffs: Users,
  knowledge: NotebookTabs,
  platform: Network,
  reminders: FileText,
  receivables: FileText,
  overdue: FileText,
  ai_config: Settings,
  tools: Wrench,
  workbench: LayoutDashboard
}

export interface EnterpriseStatusBadgeProps {
  children: ReactNode
  tone: EnterpriseStatusTone
}

export interface EnterpriseModalDialogProps {
  children: ReactNode
  label: string
  onClose: () => void
}

/** A presentation-only, keyboard-safe modal shell for existing enterprise actions. */
export function EnterpriseModalDialog({ children, label, onClose }: EnterpriseModalDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const restoreFocusTo = useRef<HTMLElement | null>(null)

  useEffect(() => {
    restoreFocusTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = dialogRef.current
    const focusable = () => dialog ? Array.from(dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter(element => element.getAttribute('aria-hidden') !== 'true') : []
    focusable()[0]?.focus()

    const keepFocusInDialog = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()

        return
      }

      if (event.key !== 'Tab') {
        return
      }

      const controls = focusable()

      if (controls.length === 0) {
        event.preventDefault()
        dialog?.focus()

        return
      }

      const first = controls[0]
      const last = controls[controls.length - 1]
      const active = document.activeElement

      if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', keepFocusInDialog)

    return () => {
      window.removeEventListener('keydown', keepFocusInDialog)
      restoreFocusTo.current?.focus()
      restoreFocusTo.current = null
    }
  }, [onClose])

  return <div className="hesc-dialog-backdrop"><div aria-label={label} aria-modal="true" className="hesc-dialog" ref={dialogRef} role="dialog" tabIndex={-1}>{children}</div></div>
}

/**
 * Presentational only. Callers retain the authority for deciding a status and
 * must pass a server-derived or controller-derived label.
 */
export function EnterpriseStatusBadge({ children, tone }: EnterpriseStatusBadgeProps) {
  return (
    <span className="hesc-status" data-tone={tone}>
      {children}
    </span>
  )
}

export interface EnterpriseClientShellProps {
  accountActions?: ReactNode
  activeWorkspace: EnterpriseShellWorkspace
  children: ReactNode
  connectionState: 'error' | 'loading' | 'ready' | 'unavailable'
  connectionStatus: string
  identityName: string
  navigationLabel: string
  onSelectWorkspace: (workspaceId: string) => void
  productChannel: string
  productName: string
  scopeLabel: string
  statusbarDetail: string
  statusbarLabel: string
  tenantLabel: string
  workspaces: readonly EnterpriseShellWorkspace[]
}

/**
 * The Enterprise product shell is deliberately separate from the generic
 * Hermes chat chrome. It renders only presentation state supplied by its
 * controller; identity, permissions, capabilities and connection lifecycle
 * remain authoritative outside this component.
 */
export function EnterpriseClientShell({
  accountActions,
  activeWorkspace,
  children,
  connectionState,
  connectionStatus,
  identityName,
  navigationLabel,
  onSelectWorkspace,
  productChannel,
  productName,
  scopeLabel,
  statusbarDetail,
  statusbarLabel,
  tenantLabel,
  workspaces
}: EnterpriseClientShellProps) {
  const indicatorState = connectionState === 'ready' ? 'ready' : connectionState === 'error' ? 'error' : 'idle'

  return (
    <div className="hesc-root" data-testid="enterprise-client-root">
      <a className="hesc-skip-link" href="#enterprise-main">
        {activeWorkspace.label}
      </a>
      <EnterpriseTitlebar className="hesc-titlebar">
        <img alt="" aria-hidden="true" className="hesc-brand-mark" src={hermesMark} />
        <strong className="hesc-product-name">{productName}</strong>
        <div className="hesc-title-spacer" />
        <EnterprisePackageUpdateButton />
        <div className="hesc-title-connection">
          <span className="hesc-connection-dot" data-state={indicatorState} />
          <span className="hesc-title-status">{connectionStatus}</span>
        </div>
      </EnterpriseTitlebar>

      <aside className="hesc-sidebar">
        <div className="hesc-sidebar-brand">
          <img alt="" aria-hidden="true" className="hesc-sidebar-mark" src={hermesMark} />
          <span>
            <strong>Hermes</strong>
            <small>{productChannel}</small>
          </span>
        </div>
        <nav aria-label={navigationLabel} className="hesc-nav">
          {workspaces.map(workspace => {
            const Icon = WORKSPACE_ICONS[workspace.id as keyof typeof WORKSPACE_ICONS]

            return (
              <button
                aria-current={workspace.id === activeWorkspace.id ? 'page' : undefined}
                aria-label={workspace.label}
                key={workspace.id}
                onClick={() => onSelectWorkspace(workspace.id)}
                type="button"
              >
                <span aria-hidden="true" className="hesc-nav-glyph">
                  {Icon ? <Icon /> : workspace.glyph}
                </span>
                <span className="hesc-nav-label">{workspace.label}</span>
              </button>
            )
          })}
        </nav>
        <div aria-hidden="true" className="hesc-sidebar-orbit">
          <span />
          <span />
          <i />
        </div>
      </aside>

      <header className="hesc-topbar">
        <div className="hesc-tenant">
          <span aria-hidden="true" className="hesc-tenant-icon">
            企
          </span>
          <span className="hesc-tenant-name">{tenantLabel}</span>
        </div>
        <div className="hesc-account">
          <span aria-hidden="true" className="hesc-avatar">
            {identityName.slice(0, 1)}
          </span>
          <span className="hesc-account-name">{identityName}</span>
          <span className="hesc-role">{scopeLabel}</span>
          {accountActions}
        </div>
      </header>

      <main className="hesc-main" id="enterprise-main" tabIndex={-1}>
        {children}
      </main>

      <footer className="hesc-statusbar">
        <span className="hesc-health" data-state={indicatorState}>
          <span aria-hidden="true" className="hesc-connection-dot" data-state={indicatorState} />
          {connectionStatus}
        </span>
        <span className="hesc-status-item">
          <span>身份</span>
          <strong>{scopeLabel}</strong>
        </span>
        <span className="hesc-status-spacer" />
        <span>{statusbarLabel}</span>
        <span className="hesc-status-detail">
          <Lock aria-hidden="true" />
          {statusbarDetail}
        </span>
      </footer>
    </div>
  )
}
