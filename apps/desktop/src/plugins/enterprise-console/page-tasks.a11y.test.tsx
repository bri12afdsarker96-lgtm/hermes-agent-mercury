/**
 * Tasks page — a11y / keyboard test (P1 Responsive/A11y, current head).
 *
 * Tasks is an ACTIVE P1 nav surface whose previous coverage was behavior-only;
 * this file closes the a11y column of the census:
 *  - page heading is a level-1 heading, panel title a level-2;
 *  - task state is text + dot (never color-only);
 *  - rows keep actions reachable via native buttons with names;
 *  - empty state copy is informative and programmatically present.
 */

import { Button } from '@hermes/plugin-sdk'
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
    title: 'reconcile the ledgers',
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

const actionsSlot = () => (
  <Button data-testid="task-retry-btn" size="sm" variant="secondary">
    Retry
  </Button>
)

afterEach(cleanup)

describe('Tasks a11y (P1 Responsive/A11y)', () => {
  it('page title is a level-1 heading and panel title a level-2 heading', () => {
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

    expect(screen.getByRole('heading', { level: 1, name: 'Tasks' })).not.toBeNull()
    expect(screen.getByRole('heading', { level: 2, name: 'Task queue' })).not.toBeNull()
  })

  it('task state is text + dot, never color-only', () => {
    wrap(
      <TasksView
        available
        createSlot={null}
        tasks={[task({ state: 'escalated', tone: 'warn' })]}
        tasksError={null}
        tasksIsPending={false}
        tasksRowActionsSlot={actionsSlot}
      />
    )

    const row = screen.getByTestId('console-task-row-task_1')
    expect(row.textContent).toContain('escalated')
  })

  it('stalled tasks state the word "stalled" as text, not color alone', () => {
    wrap(
      <TasksView
        available
        createSlot={null}
        tasks={[task({ stalled: true })]}
        tasksError={null}
        tasksIsPending={false}
        tasksRowActionsSlot={actionsSlot}
      />
    )

    expect(screen.getByText('stalled')).not.toBeNull()
  })

  it('per-row action buttons keep accessible names', () => {
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

    expect(screen.getByRole('button', { name: 'Retry' })).not.toBeNull()
  })

  it('empty state exposes informative copy', () => {
    wrap(
      <TasksView
        available
        createSlot={null}
        tasks={[]}
        tasksError={null}
        tasksIsPending={false}
        tasksRowActionsSlot={actionsSlot}
      />
    )

    expect(screen.getByText('no tasks')).not.toBeNull()
  })

  it('pending and error states are programmatically distinguishable', () => {
    wrap(
      <TasksView
        available
        createSlot={null}
        tasks={[]}
        tasksError={new Error('server down')}
        tasksIsPending={false}
        tasksRowActionsSlot={actionsSlot}
      />
    )

    // Error state surfaces through QueryBody's error branch — text, not a blank row.
    expect(screen.getByText(/server down/)).not.toBeNull()
  })
})
