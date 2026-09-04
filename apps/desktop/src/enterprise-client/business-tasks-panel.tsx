import { useEffect, useState } from 'react'

import { reconcileAfterConflict } from './authority-reconciliation'
import type { EnterpriseClientRuntime } from './runtime'

interface BusinessTask {
  attempts?: number
  carrier?: string
  created_by?: string
  due_ts?: number
  max_retries?: number
  state?: string
  stalled?: boolean
  task_id?: string
  title?: string
  ts_updated?: number
}

interface TaskAssignment {
  assignee_principal_id?: string
  claimed_ts?: number
  expires_ts?: number
  resolution_action?: string
  status?: string
}

interface TasksResponse {
  available?: boolean
  tasks?: BusinessTask[]
}

interface AssignmentsResponse {
  assignments?: TaskAssignment[]
}

type LoadState = 'error' | 'loading' | 'ready' | 'unavailable'

function stateLabel(state: LoadState): string {
  if (state === 'loading') {
    return '正在读取'
  }

  if (state === 'ready') {
    return '已连接'
  }

  if (state === 'error') {
    return '读取失败'
  }

  return '等待企业服务连接'
}

function timestamp(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '—'
  }

  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value * 1000))
}

export function BusinessTasksPanel({
  principalId,
  runtime
}: {
  principalId?: string
  runtime: EnterpriseClientRuntime | null
}) {
  const [actionState, setActionState] = useState<string | null>(null)
  const [assignments, setAssignments] = useState<TaskAssignment[]>([])
  const [assignmentState, setAssignmentState] = useState<LoadState>('unavailable')
  const [available, setAvailable] = useState<boolean | null>(null)
  const [conflictNotice, setConflictNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [resolutionNote, setResolutionNote] = useState('')
  const [reloadToken, setReloadToken] = useState(0)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [state, setState] = useState<LoadState>('unavailable')
  const [tasks, setTasks] = useState<BusinessTask[]>([])

  useEffect(() => {
    let active = true

    if (!runtime) {
      setAssignments([])
      setAssignmentState('unavailable')
      setAvailable(null)
      setConflictNotice(null)
      setError(null)
      setSelectedTaskId(null)
      setState('unavailable')
      setTasks([])

      return () => {
        active = false
      }
    }

    setError(null)
    setState('loading')
    void runtime
      .get<TasksResponse>('/api/biz-tasks')
      .then(response => {
        if (!active) {
          return
        }

        const nextTasks = response.tasks ?? []
        setAvailable(response.available ?? false)
        setTasks(nextTasks)
        setSelectedTaskId(current =>
          current && nextTasks.some(task => task.task_id === current) ? current : (nextTasks[0]?.task_id ?? null)
        )
        setState('ready')
      })
      .catch(reason => {
        if (!active) {
          return
        }

        setAvailable(null)
        setSelectedTaskId(null)
        setState('error')
        setTasks([])
        setError(reason instanceof Error ? reason.message : 'cannot load business tasks')
      })

    return () => {
      active = false
    }
  }, [reloadToken, runtime])

  useEffect(() => {
    let active = true

    if (!runtime || !selectedTaskId) {
      setAssignments([])
      setAssignmentState('unavailable')

      return () => {
        active = false
      }
    }

    setAssignments([])
    setAssignmentState('loading')
    void runtime
      .get<AssignmentsResponse>(`/api/biz-task-assignments?task_id=${encodeURIComponent(selectedTaskId)}`)
      .then(response => {
        if (!active) {
          return
        }

        setAssignments(response.assignments ?? [])
        setAssignmentState('ready')
      })
      .catch(reason => {
        if (!active) {
          return
        }

        setAssignments([])
        setAssignmentState('error')
        setError(reason instanceof Error ? reason.message : 'cannot load business task assignments')
      })

    return () => {
      active = false
    }
  }, [reloadToken, runtime, selectedTaskId])

  const selectedTask = tasks.find(task => task.task_id === selectedTaskId)
  const activeAssignment = assignments.find(assignment => assignment.status === 'claimed')
  const canClaim = Boolean(selectedTask?.task_id && selectedTask.state === 'escalated' && !activeAssignment)
  const canResolve = Boolean(selectedTask?.task_id && activeAssignment?.assignee_principal_id === principalId)

  const runAction = async (path: string, body: Record<string, string>) => {
    if (!runtime?.post) {
      setError('当前桌面运行时不支持企业任务写操作')

      return
    }

    setActionState(path)
    setConflictNotice(null)
    setError(null)

    try {
      await runtime.post(path, body)
      setResolutionNote('')
      setReloadToken(current => current + 1)
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'cannot complete business task action'

      const reconciled = await reconcileAfterConflict(reason, async () => {
        setReloadToken(current => current + 1)
      })

      if (reconciled) {
        setConflictNotice(message)

      } else {
        setError(message)
      }
    } finally {
      setActionState(null)
    }
  }

  const presentationError = error ?? conflictNotice

  return (
    <article className="hesc-card hesc-attempts-card" data-testid="enterprise-client-business-tasks">
      <div className="hesc-section-heading">
        <div>
          <h2 className="hesc-section-title">企业任务执行</h2>
          <p className="hesc-muted-copy">
            呈现服务端任务状态、停滞标记和人工认领事实。生命周期命令仍须由 Hermes_AI 校验权限与状态机。
          </p>
        </div>
        <span
          className="hesc-status"
          data-tone={state === 'ready' ? 'success' : state === 'error' ? 'error' : 'warning'}
        >
          {stateLabel(state)}
        </span>
      </div>

      {presentationError ? (
        <div className="hesc-error" role="status">
          <div>
            <strong>企业任务服务响应异常</strong>
            <span>{presentationError}</span>
          </div>
        </div>
      ) : null}
      {state === 'loading' ? <p className="hesc-muted-copy">正在读取服务端企业任务…</p> : null}
      {state === 'ready' && available === false ? (
        <p className="hesc-muted-copy">当前服务端尚未安装企业任务 authority。</p>
      ) : null}
      {state === 'ready' && available && tasks.length === 0 ? (
        <p className="hesc-muted-copy">当前授权范围内没有企业任务。</p>
      ) : null}

      <div className="hesc-workflows-grid">
        <div className="hesc-outbound-list">
          {tasks.map((task, index) => {
            const id = task.task_id

            return (
              <button
                aria-current={id === selectedTaskId ? 'true' : undefined}
                disabled={!id}
                key={id ?? `business-task-${index}`}
                onClick={() => setSelectedTaskId(id ?? null)}
                type="button"
              >
                <strong>{task.title ?? id ?? '服务端未提供任务标题'}</strong>
                <span>
                  {task.state ?? '—'} · {task.carrier ?? '—'} · {task.stalled ? '已标记停滞' : '未标记停滞'}
                </span>
              </button>
            )
          })}
        </div>

        <div>
          <h3 className="hesc-section-title">任务事实</h3>
          {selectedTask ? (
            <>
              <dl className="hesc-detail-list">
                <div>
                  <dt>任务标识</dt>
                  <dd>{selectedTask.task_id ?? '—'}</dd>
                </div>
                <div>
                  <dt>状态</dt>
                  <dd>{selectedTask.state ?? '—'}</dd>
                </div>
                <div>
                  <dt>执行载体</dt>
                  <dd>{selectedTask.carrier ?? '—'}</dd>
                </div>
                <div>
                  <dt>尝试次数</dt>
                  <dd>
                    {selectedTask.attempts ?? '—'} / {selectedTask.max_retries ?? '—'}
                  </dd>
                </div>
                <div>
                  <dt>最后更新</dt>
                  <dd>{timestamp(selectedTask.ts_updated)}</dd>
                </div>
                <div>
                  <dt>计划执行</dt>
                  <dd>{timestamp(selectedTask.due_ts)}</dd>
                </div>
              </dl>
              {canClaim ? (
                <button
                  className="hesc-action"
                  disabled={actionState !== null}
                  onClick={() => void runAction('/api/biz-task-claim', { task_id: selectedTask.task_id! })}
                  type="button"
                >
                  {actionState === '/api/biz-task-claim' ? '正在认领…' : '认领任务'}
                </button>
              ) : null}
              {canResolve ? (
                <div className="hesc-composer">
                  <label htmlFor="enterprise-task-resolution">处理说明</label>
                  <textarea
                    id="enterprise-task-resolution"
                    onChange={event => setResolutionNote(event.target.value)}
                    placeholder="说明人工核实或重试原因（由服务端记录）"
                    value={resolutionNote}
                  />
                  <div className="hesc-action-row">
                    <button
                      className="hesc-action"
                      disabled={actionState !== null}
                      onClick={() =>
                        void runAction('/api/biz-task-resolve', {
                          action: 'close',
                          note: resolutionNote.trim(),
                          task_id: selectedTask.task_id!
                        })
                      }
                      type="button"
                    >
                      {actionState === '/api/biz-task-resolve' ? '正在提交…' : '完成任务'}
                    </button>
                    <button
                      className="hesc-action"
                      disabled={actionState !== null}
                      onClick={() =>
                        void runAction('/api/biz-task-resolve', {
                          action: 'retry',
                          note: resolutionNote.trim(),
                          task_id: selectedTask.task_id!
                        })
                      }
                      type="button"
                    >
                      退回重试
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <p className="hesc-muted-copy">选择一条服务端任务以查看其授权投影。</p>
          )}
        </div>
      </div>

      <div className="hesc-section-heading">
        <div>
          <h3 className="hesc-section-title">人工处理记录</h3>
          <p className="hesc-muted-copy">认领记录来自所选任务的服务端 assignment 账本。</p>
        </div>
        <span
          className="hesc-status"
          data-tone={assignmentState === 'ready' ? 'success' : assignmentState === 'error' ? 'error' : 'warning'}
        >
          {stateLabel(assignmentState)}
        </span>
      </div>
      {assignmentState === 'loading' ? <p className="hesc-muted-copy">正在读取人工处理记录…</p> : null}
      {assignmentState === 'ready' && assignments.length === 0 ? (
        <p className="hesc-muted-copy">该任务没有返回人工处理记录。</p>
      ) : null}
      {assignments.length > 0 ? (
        <div className="hesc-table-wrap">
          <table className="hesc-table">
            <thead>
              <tr>
                <th scope="col">处理主体</th>
                <th scope="col">状态</th>
                <th scope="col">处理结果</th>
                <th scope="col">认领时间</th>
                <th scope="col">有效截止</th>
              </tr>
            </thead>
            <tbody>
              {assignments.map((assignment, index) => (
                <tr key={`${assignment.assignee_principal_id ?? 'assignment'}-${index}`}>
                  <td>{assignment.assignee_principal_id ?? '—'}</td>
                  <td>{assignment.status ?? '—'}</td>
                  <td>{assignment.resolution_action ?? '—'}</td>
                  <td>{timestamp(assignment.claimed_ts)}</td>
                  <td>{timestamp(assignment.expires_ts)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </article>
  )
}
