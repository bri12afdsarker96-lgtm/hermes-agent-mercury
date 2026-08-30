/**
 * Tasks page — Presentational View layer.
 *
 * Receives fully-derived VMs + action slots from the glue. NO
 * transport, NO useQueryClient, NO session atom, NO permission
 * authority, NO `./actions` import. FormAction / ConfirmAction are
 * composed in the glue.
 *
 * Per W1-C §P24:
 *   - View MUST NOT import: ./actions / ./transport / ./fetch-transport
 *     / ./session / ./capabilities / page-*.controller / useConsoleQuery
 *     / useQueryClient / useValue / global fetch / axios /
 *     window.hermesDesktop
 *   - View MUST be a dependency leaf.
 *   - Visible copy, className, layout hierarchy, button labels,
 *     dialog titles, placeholder text, status text, section order
 *     must match pre-split exact behavior (per W1-C §P26).
 */

import { StatusDot } from '@hermes/plugin-sdk'
import type { ReactNode } from 'react'

import { ConsoleRows, QueryBody } from './page-kit'
import type { BizTaskView } from './page-tasks.view-model'
import { PageStatusBadge } from './status-badge'
import { ConsolePanel, PageHeader } from './ui'

// ---------------------------------------------------------------------------
// Action slot props
// ---------------------------------------------------------------------------

export interface TaskRowActionsSlotProps {
  taskId: string
}

// ---------------------------------------------------------------------------
// Top-level View
// ---------------------------------------------------------------------------

export interface TasksViewProps {
  tasks: BizTaskView[]
  tasksIsPending: boolean
  tasksError: unknown
  tasksRowActionsSlot: (props: TaskRowActionsSlotProps) => ReactNode
  // The create-action affordance (composed by the glue using
  // FormAction with biztask.write permission).
  createSlot: ReactNode
}

export function TasksView({
  tasks,
  tasksIsPending,
  tasksError,
  tasksRowActionsSlot,
  createSlot,
}: TasksViewProps) {
  return (
    <div
      className="mx-auto flex w-full max-w-[96rem] flex-col px-(--ec-page-inset-x) py-(--ec-page-inset-y)"
      data-page-status="ready"
      data-testid="console-page-tasks"
    >
      <PageHeader
        actions={createSlot}
        purpose="Create and operate business tasks through the server-owned task state machine."
        status={<PageStatusBadge status="ready" />}
        title="Tasks"
      />

      <ConsolePanel divided title="Task queue">
        <QueryBody
          emptyText="no tasks"
          isEmpty={(data: { available: boolean; tasks: unknown[] }) =>
            !data.available || data.tasks.length === 0
          }
          query={{
            data: { available: true, tasks },
            error: tasksError,
            isPending: tasksIsPending,
          }}
        >
          {() => (
            <ConsoleRows testId="console-tasks">
              {tasks.map((task) => (
                <li
                  className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                  data-testid={`console-task-row-${task.taskId}`}
                  key={task.taskId}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-(--ui-text-primary)">{task.title}</div>
                    <div className="text-(--ui-text-tertiary)">
                      {task.carrier} · {task.tsUpdatedDisplay} · {task.attemptsDisplay}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {task.stalled ? <span className="text-xs text-amber-600">stalled</span> : null}
                    <span className="inline-flex items-center gap-1 text-xs">
                      <StatusDot tone={task.tone} />
                      {task.state}
                    </span>
                    {tasksRowActionsSlot({ taskId: task.taskId })}
                  </div>
                </li>
              ))}
            </ConsoleRows>
          )}
        </QueryBody>
      </ConsolePanel>
    </div>
  )
}