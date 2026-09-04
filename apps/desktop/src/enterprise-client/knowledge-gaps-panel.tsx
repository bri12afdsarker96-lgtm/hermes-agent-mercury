import { type FormEvent, useCallback, useEffect, useState } from 'react'

import type { EnterpriseClientRuntime } from './runtime'

interface KnowledgeGap {
  biz_line?: string
  detail?: string
  gap_id?: string
  query?: string
  signal?: string
  status?: string
}

interface KnowledgeGapsResponse {
  collections?: string[]
  error?: string
  gaps?: KnowledgeGap[]
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

export function KnowledgeGapsPanel({ runtime }: { runtime: EnterpriseClientRuntime | null }) {
  const [action, setAction] = useState<string | null>(null)
  const [collections, setCollections] = useState<string[]>([])
  const [collection, setCollection] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [gaps, setGaps] = useState<KnowledgeGap[]>([])
  const [reason, setReason] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [state, setState] = useState<LoadState>('unavailable')
  const [text, setText] = useState('')

  const load = useCallback(async () => {
    if (!runtime) {
      setCollections([])
      setGaps([])
      setSelectedId(null)
      setState('unavailable')

      return
    }

    setError(null)
    setState('loading')

    try {
      const response = await runtime.get<KnowledgeGapsResponse>('/api/kb-gaps?status=new&limit=50')
      const next = response.gaps ?? []

      setCollections(response.collections ?? [])
      setGaps(next)
      setSelectedId(current =>
        current && next.some(row => row.gap_id === current) ? current : (next[0]?.gap_id ?? null)
      )
      setState(response.error ? 'error' : 'ready')
      setError(response.error ?? null)
    } catch (reason) {
      setCollections([])
      setGaps([])
      setSelectedId(null)
      setState('error')
      setError(reason instanceof Error ? reason.message : 'cannot load knowledge gaps')
    }
  }, [runtime])

  useEffect(() => {
    void load()
  }, [load])

  const selected = gaps.find(row => row.gap_id === selectedId)

  const author = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!runtime?.post || !selected?.gap_id || !text.trim() || !collection.trim()) {
      return
    }

    setAction('author')
    setError(null)
    void runtime
      .post('/api/kb-gap-author', { collection: collection.trim(), gap_id: selected.gap_id, text: text.trim() })
      .then(async () => {
        setText('')
        await load()
      })
      .catch(reason => setError(reason instanceof Error ? reason.message : 'cannot author knowledge gap'))
      .finally(() => setAction(null))
  }

  const reject = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!runtime?.post || !selected?.gap_id || !reason.trim()) {
      return
    }

    setAction('reject')
    setError(null)
    void runtime
      .post('/api/kb-gap-reject', { gap_id: selected.gap_id, reason: reason.trim() })
      .then(async () => {
        setReason('')
        await load()
      })
      .catch(reason => setError(reason instanceof Error ? reason.message : 'cannot reject knowledge gap'))
      .finally(() => setAction(null))
  }

  return (
    <section className="hesc-card hesc-audit-card" data-testid="enterprise-client-knowledge-gaps">
      <div className="hesc-section-heading">
        <div>
          <h2 className="hesc-section-title">知识缺口治理</h2>
          <p className="hesc-muted-copy">仅处理服务端识别出的待补充缺口；写入和驳回由服务端复核权限及并发状态。</p>
        </div>
        <span
          className="hesc-status"
          data-tone={state === 'ready' ? 'success' : state === 'error' ? 'error' : 'warning'}
        >
          {stateLabel(state)}
        </span>
      </div>

      {error ? (
        <p className="hesc-error-copy" role="status">
          {error}
        </p>
      ) : null}
      {state === 'ready' && gaps.length === 0 ? <p className="hesc-muted-copy">当前没有待处理的知识缺口。</p> : null}
      <div className="hesc-outbound-list">
        {gaps.map((gap, index) => {
          const gapId = gap.gap_id

          return (
            <button
              aria-current={gapId === selectedId ? 'true' : undefined}
              disabled={!gapId}
              key={gapId ?? `gap-${index}`}
              onClick={() => setSelectedId(gapId ?? null)}
              type="button"
            >
              <strong>{gap.query ?? gap.signal ?? '服务端未提供缺口问题'}</strong>
              <span>
                {gap.signal ?? '—'} · {gap.biz_line ?? '未提供业务线'}
              </span>
            </button>
          )
        })}
      </div>

      {selected?.gap_id ? (
        <div className="hesc-knowledge-gap-actions">
          <p className="hesc-muted-copy">{selected.detail ?? `缺口标识：${selected.gap_id}`}</p>
          <form className="hesc-agent-composer" onSubmit={author}>
            <label htmlFor="enterprise-gap-content">补充知识</label>
            <textarea
              id="enterprise-gap-content"
              onChange={event => setText(event.target.value)}
              placeholder="填写经确认的知识内容"
              value={text}
            />
            <input
              aria-label="目标知识集合"
              list="enterprise-gap-collections"
              onChange={event => setCollection(event.target.value)}
              placeholder="目标知识集合"
              value={collection}
            />
            <datalist id="enterprise-gap-collections">
              {collections.map(name => (
                <option key={name} value={name} />
              ))}
            </datalist>
            <button className="hesc-action" disabled={!runtime?.post || action !== null} type="submit">
              {action === 'author' ? '正在提交…' : '提交补充知识'}
            </button>
          </form>
          <form className="hesc-agent-composer" onSubmit={reject}>
            <label htmlFor="enterprise-gap-reason">驳回原因</label>
            <input
              id="enterprise-gap-reason"
              onChange={event => setReason(event.target.value)}
              placeholder="必须说明驳回原因"
              value={reason}
            />
            <button className="hesc-action" disabled={!runtime?.post || action !== null} type="submit">
              {action === 'reject' ? '正在驳回…' : '驳回缺口'}
            </button>
          </form>
        </div>
      ) : null}
    </section>
  )
}
