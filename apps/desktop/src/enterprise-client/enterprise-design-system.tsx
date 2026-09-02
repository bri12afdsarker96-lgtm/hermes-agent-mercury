import type { ReactNode } from 'react'

import hermesMark from './assets/hermes-mark.svg'

export type EnterpriseStatusTone = 'error' | 'success' | 'warning'

export interface EnterpriseShellWorkspace {
  glyph: string
  id: string
  label: string
}

export interface EnterpriseStatusBadgeProps {
  children: ReactNode
  tone: EnterpriseStatusTone
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
      <header className="hesc-titlebar">
        <img alt="" aria-hidden="true" className="hesc-brand-mark" src={hermesMark} />
        <strong className="hesc-product-name">{productName}</strong>
        <span className="hesc-product-channel">{productChannel}</span>
        <div className="hesc-title-spacer" />
        <span className="hesc-connection-dot" data-state={indicatorState} />
        <span className="hesc-title-status">{connectionStatus}</span>
      </header>

      <aside className="hesc-sidebar">
        <div className="hesc-sidebar-identity">
          <strong>{identityName}</strong>
          <span>{tenantLabel}</span>
        </div>
        <nav aria-label={navigationLabel} className="hesc-nav">
          {workspaces.map(workspace => (
            <button
              aria-current={workspace.id === activeWorkspace.id ? 'page' : undefined}
              key={workspace.id}
              onClick={() => onSelectWorkspace(workspace.id)}
              type="button"
            >
              <span aria-hidden="true" className="hesc-nav-glyph">
                {workspace.glyph}
              </span>
              <span className="hesc-nav-label">{workspace.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      <header className="hesc-topbar">
        <div className="hesc-breadcrumb">
          {productName} / <strong>{activeWorkspace.label}</strong>
        </div>
        <div className="hesc-topbar-scope">{scopeLabel}</div>
      </header>

      <main className="hesc-main">{children}</main>

      <footer className="hesc-statusbar">
        <span>{statusbarLabel}</span>
        <code>{statusbarDetail}</code>
      </footer>
    </div>
  )
}
