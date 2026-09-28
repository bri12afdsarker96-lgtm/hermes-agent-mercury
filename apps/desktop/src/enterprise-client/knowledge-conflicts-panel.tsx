import { useStore } from '@nanostores/react'
import { atom } from 'nanostores'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { $enterprisePackageInstallFrozen, registerEnterpriseInstallActivity } from './enterprise-install-readiness'
import type { EnterpriseClientRuntime } from './runtime'

interface Conflict {
  conflict_id: string
  status: string
  counterpart: { text: string; topic: string | null; created_by_principal_id: string } | null
}
interface ConflictResponse {
  conflicts: Conflict[]
  permissions: string[]
  principal_id: string
}
interface Props {
  candidateId: string
  creatorId: string
  onChanged: () => Promise<void>
  runtime: EnterpriseClientRuntime | null
}

export function KnowledgeConflictsPanel({ candidateId, creatorId, onChanged, runtime }: Props) {
  const [data, setData] = useState<ConflictResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [$busy] = useState(() => atom(false))
  const working = useStore($busy)
  const frozen = useStore($enterprisePackageInstallFrozen)
  const busy = working || frozen
  const setBusy = useCallback((busy: boolean) => $busy.set(busy), [$busy])
  const life = useMemo(() => ({ active: true, candidateId, runtime }), [candidateId, runtime])

  useEffect(() => {
    const activity = registerEnterpriseInstallActivity({ blocker: () => $busy.get() ? '知识冲突正在处理，请等待完成后更新。' : null })
    const unsubscribe = $busy.listen(activity.changed)

    return () => { unsubscribe(); activity.dispose() }
  }, [$busy])

  useEffect(() => {
    life.active = true
    setData(null)
    setError(null)
    setBusy(false)

    if (runtime) {
      void runtime
        .get<ConflictResponse>(`/api/knowledge-conflicts?candidate_id=${encodeURIComponent(candidateId)}`)
        .then(response => {
          if (life.active) {
            setData(response)
          }
        })
        .catch(failure => {
          if (life.active) {
            setError(failure instanceof Error ? failure.message : '冲突详情暂时不可用')
          }
        })
    }

    return () => {
      life.active = false
    }
  }, [candidateId, life, runtime, setBusy])

  async function resolve(conflictId: string) {
    if ($enterprisePackageInstallFrozen.get() || !runtime?.post || busy) {
      return
    }

    setBusy(true)
    setError(null)

    try {
      await runtime.post('/api/knowledge-resolve-conflict', {
        conflict_id: conflictId,
        verdict: 'keep_existing',
        idempotency_key: crypto.randomUUID()
      })

      if (life.active) {
        await onChanged()
      }
    } catch (failure) {
      if (life.active) {
        setError(failure instanceof Error ? failure.message : '冲突处理未完成，请刷新重试')
      }
    } finally {
      if (life.active) {
        setBusy(false)
      }
    }
  }

  const canResolve = data?.permissions.some(
    permission => permission === '*' || permission === 'kb.candidate.resolve_conflict'
  )

  return (
    <section aria-label="知识冲突详情">
      <h3>与现有资料的冲突</h3>
      <p className="hesc-muted-copy">
        保留现有资料会结束本条重复候选；不会撤回已发布知识。裁决人不能是任一相关资料的作者。
      </p>
      {error ? (
        <p className="hesc-error" role="alert">
          {error}
        </p>
      ) : null}
      {!data && !error ? <p className="hesc-muted-copy">正在读取冲突内容…</p> : null}
      {data?.conflicts
        .filter(conflict => conflict.status === 'confirmed')
        .map(conflict => {
          const allowed =
            canResolve &&
            data.principal_id !== creatorId &&
            data.principal_id !== conflict.counterpart?.created_by_principal_id

          return (
            <div key={conflict.conflict_id}>
              <h4>{conflict.counterpart?.topic ?? '相关知识'}</h4>
              <pre className="hesc-pre">{conflict.counterpart?.text ?? '相关版本当前不可见，请刷新确认其状态。'}</pre>
              {allowed ? (
                <button
                  className="hesc-action"
                  disabled={busy}
                  onClick={() => void resolve(conflict.conflict_id)}
                  type="button"
                >
                  保留现有资料，结束重复候选
                </button>
              ) : (
                <p className="hesc-muted-copy">请由未参与编写这些资料的企业管理员裁决。</p>
              )}
            </div>
          )
        })}
    </section>
  )
}
