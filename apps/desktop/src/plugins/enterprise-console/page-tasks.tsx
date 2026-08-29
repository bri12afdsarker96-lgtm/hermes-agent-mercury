/**
 * Tasks page — Glue layer.
 *
 * Builds the mutation factory in the glue, then passes bound callbacks
 * to the view. The view never imports transport; the create mutation
 * (with idempotency key rotation) is fully captured in onCreate +
 * onRotateIdempotencyKey.
 *
 * Wave 1 / Step 8 of W5-B0 Controller/View Contract Freeze.
 */

import { findPage } from './catalog'
import { QueryBody } from './page-kit'
import { useWhoami } from './session'
import {
  makeBizTaskMutations,
  newIdempotencyKey,
  useBizTasksData,
} from './page-tasks.controller'
import { deriveBizTasksViewModel } from './page-tasks.view-model'
import { TasksView } from './page-tasks.view'
import { useTransport } from './transport'

export function TasksPage() {
  const who = useWhoami()
  const query = useBizTasksData()
  const transport = useTransport()
  const mutations = makeBizTaskMutations(transport)
  const page = findPage('tasks')!

  return (
    <QueryBody
      emptyText="no tasks"
      isEmpty={vm => !vm.isAvailable || vm.rows.length === 0}
      query={query}
    >
      {data => (
        <TasksView
          vm={deriveBizTasksViewModel({ page, whoami: who, data })}
          onCreate={body => {
            void mutations.create(body)
          }}
          onRetry={taskId => {
            void mutations.retry({ task_id: taskId })
          }}
          onEscalate={taskId => {
            void mutations.escalate({ task_id: taskId })
          }}
          onClose={taskId => {
            void mutations.close({ task_id: taskId })
          }}
          onRotateIdempotencyKey={newIdempotencyKey}
        />
      )}
    </QueryBody>
  )
}