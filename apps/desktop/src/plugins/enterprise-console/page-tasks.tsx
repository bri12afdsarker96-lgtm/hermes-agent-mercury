/**
 * Tasks page — Glue layer.
 *
 * Per W1-C-REMEDIATION-01 §P5 + §P7 + §P6:
 *   - Reads `query.data?.available ?? false` (server truth; NEVER
 *     fabricates `available: true`).
 *   - Uses TASKS_KEY constant from controller for every invalidateKey
 *     (no literal query-key arrays in glue).
 *   - Per-row action composition is gated on VM-derived eligibility
 *     flags (canRetry / canEscalate / canClose). Glue does NOT
 *     recompute state.
 *   - Closed + all permissions → 0 mutation controls.
 *
 * Per W1-C §P9 (Tasks contract):
 *   - Idempotency invariant: server failure → same key remains;
 *     server success → invalidate + rotate key.
 */

import { Input, Textarea } from '@hermes/plugin-sdk'
import { useState } from 'react'

import { ConfirmAction, FormAction } from './actions'
import { fmtEpoch } from './page-kit'
import {
  TASKS_KEY,
  useKbTasks,
  useTasksMutations,
} from './page-tasks.controller'
import { type TaskRowActionsSlotProps, TasksView } from './page-tasks.view'
import { deriveBizTasks } from './page-tasks.view-model'

function CreateTaskSlot() {
  const mutations = useTasksMutations()
  const [title, setTitle] = useState('')
  const [carrier, setCarrier] = useState('device')
  const [goal, setGoal] = useState('')
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID())

  return (
    <FormAction
      canSubmit={title.trim().length > 0}
      invalidateKey={TASKS_KEY}
      onSuccess={() => setIdempotencyKey(crypto.randomUUID())}
      permission="biztask.write"
      submit={() =>
        mutations.createTask({
          carrier,
          goal: goal || undefined,
          idempotency_key: idempotencyKey,
          title: title.trim(),
        })
      }
      submitLabel="Create"
      testId="console-task-create"
      title="Create task"
      trigger="new task"
    >
      <Input
        data-testid="console-task-create-title"
        onChange={(event) => setTitle(event.target.value)}
        placeholder="title"
        value={title}
      />
      <select
        className="rounded-md border border-border bg-transparent px-2 py-1 text-sm"
        onChange={(event) => setCarrier(event.target.value)}
        value={carrier}
      >
        <option value="device">device</option>
        <option value="broadcast">broadcast</option>
        <option value="workflow">workflow</option>
      </select>
      <Textarea
        onChange={(event) => setGoal(event.target.value)}
        placeholder="goal (optional)"
        value={goal}
      />
    </FormAction>
  )
}

function TaskRowActionsSlot({
  taskId,
  canRetry,
  canEscalate,
  canClose,
}: TaskRowActionsSlotProps) {
  const mutations = useTasksMutations()

  return (
    <>
      {canRetry ? (
        <ConfirmAction
          invalidateKey={TASKS_KEY}
          permission="biztask.write"
          run={() => mutations.retryTask(taskId)}
          testId={`console-task-retry-${taskId}`}
          title="Retry this task?"
        >
          retry
        </ConfirmAction>
      ) : null}
      {canEscalate ? (
        <ConfirmAction
          invalidateKey={TASKS_KEY}
          permission="biztask.escalate"
          run={() => mutations.escalateTask(taskId)}
          testId={`console-task-escalate-${taskId}`}
          title="Escalate this task?"
        >
          escalate
        </ConfirmAction>
      ) : null}
      {canClose ? (
        <ConfirmAction
          description="This closes the task on the server."
          destructive
          invalidateKey={TASKS_KEY}
          permission="biztask.write"
          run={() => mutations.closeTask(taskId)}
          testId={`console-task-close-${taskId}`}
          title="Close this task?"
        >
          close
        </ConfirmAction>
      ) : null}
    </>
  )
}

export function TasksPage() {
  const query = useKbTasks()
  const available = query.data?.available ?? false
  const tasksVm = deriveBizTasks(query.data?.tasks, fmtEpoch)

  return (
    <TasksView
      available={available}
      createSlot={<CreateTaskSlot />}
      tasks={tasksVm}
      tasksError={query.error}
      tasksIsPending={query.isPending}
      tasksRowActionsSlot={(props) => <TaskRowActionsSlot {...props} />}
    />
  )
}
