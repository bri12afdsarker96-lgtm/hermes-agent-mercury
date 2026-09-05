/**
 * Tasks page — responsive hooks (P1 Responsive/A11y, current head).
 *
 * Tasks is an ACTIVE P1 nav surface; this closes the responsive column of the
 * census with the repo-standard class-hook assertions (jsdom has no layout).
 * Rendered 4-viewport geometry is proven by the packaged CDP probe evidence.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { TasksView } from './page-tasks.view'
import type { BizTaskView } from './page-tasks.view-model'

function task(partial: Partial<BizTaskView>): BizTaskView {
  return {
    attempts: 1,
    attemptsDisplay: '1/3',
    canClose: true,
    canEscalate: true,
    canRetry: true,
    carrier: 'workflow',
    isClosed: false,
    maxRetries: 3,
    stalled: false,
    state: 'running',
    taskId: 'task_1',
    title: 'a very long task title that must truncate instead of stretching the row'.repeat(3),
    tone: 'good',
    tsUpdated: 0,
    tsUpdatedDisplay: 'today',
    ...partial
  }
}

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

const actionsSlot = () => null

afterEach(cleanup)

describe('Tasks responsive hooks (P1 Responsive/A11y)', () => {
  it('page container caps its width and insets from tokens — no full-bleed overflow', () => {
    wrap(
      <TasksView
        available
        createSlot={null}
        tasks={[task({})]}
        tasksError={null}
        tasksIsPending={false}
        tasksRowActionsSlot={actionsSlot}
      />
    )

    const page = screen.getByTestId('console-page-tasks')
    expect(page.className).toContain('mx-auto')
    expect(page.className).toContain('max-w-[96rem]')
    expect(page.className).toContain('px-(--ec-page-inset-x)')
  })

  it('task rows wrap on narrow widths instead of clipping the action cluster', () => {
    wrap(
      <TasksView
        available
        createSlot={null}
        tasks={[task({})]}
        tasksError={null}
        tasksIsPending={false}
        tasksRowActionsSlot={actionsSlot}
      />
    )

    const row = screen.getByTestId('console-task-row-task_1')
    expect(row.className).toContain('flex-wrap')
    expect(row.className).toContain('justify-between')
  })

  it('title cell shrinks and truncates — long titles cannot break the layout', () => {
    wrap(
      <TasksView
        available
        createSlot={null}
        tasks={[task({})]}
        tasksError={null}
        tasksIsPending={false}
        tasksRowActionsSlot={actionsSlot}
      />
    )

    const row = screen.getByTestId('console-task-row-task_1')
    const titleCell = row.querySelector('.min-w-0.flex-1') as HTMLElement
    expect(titleCell).not.toBeNull()
    const title = titleCell.querySelector('.truncate') as HTMLElement
    expect(title).not.toBeNull()
    expect(title.textContent).toContain('a very long task title')
  })

  it('action cluster shrinks but never squashes: shrink-0 + wrap', () => {
    wrap(
      <TasksView
        available
        createSlot={null}
        tasks={[task({})]}
        tasksError={null}
        tasksIsPending={false}
        tasksRowActionsSlot={actionsSlot}
      />
    )

    const row = screen.getByTestId('console-task-row-task_1')
    const cluster = row.querySelector('.shrink-0') as HTMLElement
    expect(cluster).not.toBeNull()
    expect(cluster.className).toContain('flex-wrap')
  })
})
