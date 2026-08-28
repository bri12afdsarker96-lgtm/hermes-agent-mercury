/**
 * ConsolePanel / PageHeader — the two repeated containers of the approved
 * Enterprise Desktop layout.
 *
 * Named `ConsolePanel`, not `Panel`, on purpose: the app already has a `Panel`
 * family in `app/overlays/panel.tsx` for floating overlay surfaces. That one is
 * a different concern (borderless, `shadow-nous`, lives above the workspace)
 * and is not reachable from inside the plugin fence anyway. Two things called
 * `Panel` with different elevation rules is exactly the drift this layer exists
 * to avoid, so the name says which one it is.
 *
 * DESIGN.md principle 1 is "flat, not boxed — no card-in-card". A ConsolePanel
 * is therefore a LEAF container: put content in it, never another
 * ConsolePanel. Grouping inside a panel is done with whitespace and a single
 * hairline, which is what `divided` is for.
 *
 * PageHeader encodes the approved copy rule: a page title is a NOUN plus a
 * one-line statement of purpose ("业务跟进 / 跟踪应收、客户沟通、状态更新与后续提醒"),
 * never a verb or a slogan. `status` is the slot where a page's honest read/write
 * contract badge goes — the console already owns `PageStatusBadge`, so this only
 * provides the position, it does not restate the vocabulary.
 */

import { cn } from '@hermes/plugin-sdk'
import type { ReactNode } from 'react'

export interface ConsolePanelProps {
  /** Quiet trailing control on the title row — the design's 「查看全部」 link. */
  action?: ReactNode
  children: ReactNode
  className?: string
  /** Hairline between the title row and the body, for list-shaped panels. */
  divided?: boolean
  /** Omit for an unlabelled panel; when present it renders as a real heading. */
  title?: ReactNode
}

export function ConsolePanel({ action, children, className, divided = false, title }: ConsolePanelProps) {
  return (
    <section
      className={cn(
        'rounded-(--ec-panel-radius) border border-(--ui-stroke-secondary) bg-(--ui-bg-card) p-(--ec-panel-pad)',
        className
      )}
      data-slot="ec-panel"
    >
      {title === undefined ? null : (
        <div
          className={cn(
            'flex items-center justify-between gap-3',
            divided ? 'border-b border-(--ui-stroke-tertiary) pb-3' : 'pb-3'
          )}
          data-slot="ec-panel-header"
        >
          <h2 className="text-[0.9375rem] leading-normal font-bold text-(--ui-text-primary)">{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

export interface PageHeaderProps {
  /** Primary controls for the page, right-aligned against the title block. */
  actions?: ReactNode
  /** One line saying what the page is for. Not marketing copy. */
  purpose?: ReactNode
  /** The page's honest read/write contract badge. */
  status?: ReactNode
  /** A noun. 工作台 / 企业会话 / 企业知识 — never a verb. */
  title: ReactNode
}

export function PageHeader({ actions, purpose, status, title }: PageHeaderProps) {
  return (
    <header className="flex items-start justify-between gap-4 pb-(--ec-page-inset-y)" data-slot="ec-page-header">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex items-center gap-2">
          <h1 className="truncate text-xl leading-tight font-bold text-(--ui-text-primary)">{title}</h1>
          {status}
        </div>
        {purpose === undefined ? null : <p className="text-(--ui-text-secondary)">{purpose}</p>}
      </div>
      {actions === undefined ? null : <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  )
}
