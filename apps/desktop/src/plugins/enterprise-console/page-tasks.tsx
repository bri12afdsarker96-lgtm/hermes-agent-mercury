/**
 * Tasks page — Glue layer.
 *
 * Composes:
 *   - controller (queries + mutations)
 *   - view-model (pure derivations + tone tables)
 *   - view (presentational; action slots)
 *
 * Per W1-C §P23, the glue owns:
 *   - local form state (title, carrier, goal, idempotency key)
 *   - FormAction / ConfirmAction composition (these own permission +
 *     invalidation + server write)
 *   - ReactNode composition (createSlot, row action slots)
 *
 * Per W1-C §P9 (Tasks contract):
 *   - Idempotency invariant: server failure → same key reused;
 *     server success → invalidate + rotate key. The local state
 *     starts as `() => crypto.randomUUID()` (one key per logical
 *     creation) and rotates only on success via onSuccess.
 *   - No optimistic task row, no client-side state machine.
 *   - retry / escalate / close only when task.state !== 'closed'.
 */

import { Input, Textarea } from '@hermes/plugin-sdk'
import { useState } from 'react'

import { ConfirmAction, FormAction } from './actions'
import { fmtEpoch } from './page-kit'
import {
  useKbTasks,
  useTasksMutations,
} from './page-tasks.controller'
import { TasksView } from './page-tasks.view'
import { deriveBizTasks } from './page-tasks.view-model'

// Note: crypto.randomUUID is a browser API available in jsdom and
// in the Electron renderer. Per W1-C §P25, the VM must not own
// crypto.randomUUID — only the glue (which owns the local creation
// form state) uses it.

function CreateTaskSlot() {
  const mutations = useTasksMutations()
  const [title, setTitle] = useState('')
  const [carrier, setCarrier] = useState('device')
  const [goal, setGoal] = useState('')
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID())

  return (
    <FormAction
      canSubmit={title.trim().length > 0}
      invalidateKey={['enterprise-console', 'biz-tasks']}
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

function TaskRowActionsSlot({ taskId }: { taskId: string }) {
  const mutations = useTasksMutations()

  return (
    <>
      <ConfirmAction
        invalidateKey={['enterprise-console', 'biz-tasks']}
        permission="biztask.write"
        run={() => mutations.retryTask(taskId)}
        testId={`console-task-retry-${taskId}`}
        title="Retry this task?"
      >
        retry
      </ConfirmAction>
      <ConfirmAction
        invalidateKey={['enterprise-console', 'biz-tasks']}
        permission="biztask.escalate"
        run={() => mutations.escalateTask(taskId)}
        testId={`console-task-escalate-${taskId}`}
        title="Escalate this task?"
      >
        escalate
      </ConfirmAction>
      <ConfirmAction
        description="This closes the task on the server."
        destructive
        invalidateKey={['enterprise-console', 'biz-tasks']}
        permission="biztask.write"
        run={() => mutations.closeTask(taskId)}
        testId={`console-task-close-${taskId}`}
        title="Close this task?"
      >
        close
      </ConfirmAction>
    </>
  )
}

export function TasksPage() {
  const query = useKbTasks()
  const tasksVm = deriveBizTasks(query.data?.tasks, fmtEpoch)

  return (
    <TasksView
      createSlot={<CreateTaskSlot />}
      tasks={tasksVm}
      tasksError={query.error}
      tasksIsPending={query.isPending}
      tasksRowActionsSlot={({ taskId }) => <TaskRowActionsSlot taskId={taskId} />}
    />
  )
}