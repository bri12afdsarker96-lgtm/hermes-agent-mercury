/**
 * Tasks page — Presentational view.
 *
 * Receives a BizTasksViewModel + create-task field state + 4 mutation
 * callbacks. The CreateTask sub-component owns the create form's
 * per-row state (title / carrier / goal / idempotency key). The
 * eslint config enforces VIEW_FORBIDDEN_IMPORTS on this file.
 *
 * Wave 1 / Step 8 of W5-B0 contract freeze.
 */

import { Input, StatusDot, Textarea } from '@hermes/plugin-sdk'
import { useState } from 'react'

import { ConfirmAction, FormAction } from './actions'
import { ConsoleRows, fmtEpoch } from './page-kit'
import type { BizTasksViewModel } from './page-tasks.view-model'
import { PageStatusBadge } from './status-badge'
import { ConsolePanel, PageHeader } from './ui'

export interface TasksViewProps {
  vm: BizTasksViewModel
  onCreate: (body: { carrier: string; goal?: string; idempotency_key: string; title: string }) => void
  onRetry: (taskId: string) => void
  onEscalate: (taskId: string) => void
  onClose: (taskId: string) => void
  onRotateIdempotencyKey: () => string
}

interface CreateTaskFormProps {
  onCreate: TasksViewProps['onCreate']
  onRotateIdempotencyKey: TasksViewProps['onRotateIdempotencyKey']
}

function CreateTaskForm({ onCreate, onRotateIdempotencyKey }: CreateTaskFormProps) {
  const [title, setTitle] = useState('')
  const [carrier, setCarrier] = useState('device')
  const [goal, setGoal] = useState('')
  const [idempotencyKey, setIdempotencyKey] = useState(() => onRotateIdempotencyKey())

  return (
    <FormAction
      canSubmit={title.trim().length > 0}
      invalidateKey={['enterprise-console', 'biz-tasks']}
      onSuccess={() => setIdempotencyKey(onRotateIdempotencyKey())}
      permission="biztask.write"
      submit={() => {
        onCreate({
          carrier,
          goal: goal || undefined,
          idempotency_key: idempotencyKey,
          title: title.trim(),
        })
        setTitle('')
        setGoal('')
      }}
      submitLabel="Create"
      testId="console-task-create"
      title="Create task"
      trigger="new task"
    >
      <Input
        data-testid="console-task-create-title"
        onChange={event => setTitle(event.target.value)}
        placeholder="title"
        value={title}
      />
      <select
        className="rounded-md border border-border bg-transparent px-2 py-1 text-sm"
        onChange={event => setCarrier(event.target.value)}
        value={carrier}
      >
        <option value="device">device</option>
        <option value="broadcast">broadcast</option>
        <option value="workflow">workflow</option>
      </select>
      <Textarea onChange={event => setGoal(event.target.value)} placeholder="goal (optional)" value={goal} />
    </FormAction>
  )
}

export function TasksView({ vm, onCreate, onRetry, onEscalate, onClose, onRotateIdempotencyKey }: TasksViewProps) {
  return (
    <div
      className="mx-auto flex w-full max-w-[96rem] flex-col px-(--ec-page-inset-x) py-(--ec-page-inset-y)"
      data-page-status="ready"
      data-testid="console-page-tasks"
    >
      <PageHeader
        actions={<CreateTaskForm onCreate={onCreate} onRotateIdempotencyKey={onRotateIdempotencyKey} />}
        purpose="Create and operate business tasks through the server-owned task state machine."
        status={<PageStatusBadge status="ready" />}
        title="Tasks"
      />

      <ConsolePanel divided title="Task queue">
        {vm.isEmpty ? (
          <p className="text-(--ui-text-tertiary)" data-testid="console-tasks-empty">
            {!vm.isAvailable ? 'biz-tasks module is not assembled' : 'no tasks'}
          </p>
        ) : (
          <ConsoleRows testId="console-tasks">
            {vm.rows.map(row => (
              <li
                className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                key={row.taskId}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-(--ui-text-primary)">{row.title}</div>
                  <div className="text-(--ui-text-tertiary)">
                    {row.carrier} · {fmtEpoch(row.tsUpdated)} · {row.attempts}/{row.maxRetries}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {row.isStalled ? <span className="text-xs text-amber-600">stalled</span> : null}
                  <span className="inline-flex items-center gap-1 text-xs">
                    <StatusDot tone={row.tone} />
                    {row.state}
                  </span>
                  {!row.isClosed ? (
                    <>
                      <ConfirmAction
                        invalidateKey={['enterprise-console', 'biz-tasks']}
                        permission="biztask.write"
                        run={() => onRetry(row.taskId)}
                        testId={`console-task-retry-${row.taskId}`}
                        title="Retry this task?"
                      >
                        retry
                      </ConfirmAction>
                      <ConfirmAction
                        invalidateKey={['enterprise-console', 'biz-tasks']}
                        permission="biztask.escalate"
                        run={() => onEscalate(row.taskId)}
                        testId={`console-task-escalate-${row.taskId}`}
                        title="Escalate this task?"
                      >
                        escalate
                      </ConfirmAction>
                      <ConfirmAction
                        description="This closes the task on the server."
                        destructive
                        invalidateKey={['enterprise-console', 'biz-tasks']}
                        permission="biztask.write"
                        run={() => onClose(row.taskId)}
                        testId={`console-task-close-${row.taskId}`}
                        title="Close this task?"
                      >
                        close
                      </ConfirmAction>
                    </>
                  ) : null}
                </div>
              </li>
            ))}
          </ConsoleRows>
        )}
      </ConsolePanel>
    </div>
  )
}