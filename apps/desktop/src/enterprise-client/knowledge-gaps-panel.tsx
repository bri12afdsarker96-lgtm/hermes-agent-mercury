import { useStore } from '@nanostores/react'
import { atom } from 'nanostores'
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'

import { reconcileAfterConflict } from './authority-reconciliation'
import { $enterprisePackageInstallFrozen, registerEnterpriseInstallActivity } from './enterprise-install-readiness'
import { ENTERPRISE_LEARNING_ENABLED } from './enterprise-reply-preferences'
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
  const [$work] = useState(() => atom<{ action: string | null; text: string; reason: string }>({ action: null, text: '', reason: '' }))
  const { action: working, text, reason } = useStore($work)
  const frozen = useStore($enterprisePackageInstallFrozen)
  const action = working ?? (frozen ? 'install' : null)
  const setAction = useCallback((action: string | null) => $work.set({ ...$work.get(), action }), [$work])
  const setText = useCallback((text: string) => $work.set({ ...$work.get(), text }), [$work])
  const setReason = useCallback((reason: string) => $work.set({ ...$work.get(), reason }), [$work])
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID())
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [gaps, setGaps] = useState<KnowledgeGap[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [state, setState] = useState<LoadState>('unavailable')
  const currentRuntime = useRef(runtime)
  const loadSequence = useRef(0)
  currentRuntime.current = runtime
  const invalidateLoad = useCallback(() => { loadSequence.current++ }, [])

  useEffect(() => {
    const activity = registerEnterpriseInstallActivity({ blocker: () => {
      const work = $work.get()

      if (work.action) {return '知识缺口正在提交，请等待完成后更新。'}

      if (work.text.trim() || work.reason.trim()) {return '知识缺口有未提交文字，请先完成提交或清空后更新。'}

      return null
    } })

    const unsubscribe = $work.listen(activity.changed)

    return () => { unsubscribe(); activity.dispose() }
  }, [$work, runtime])

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current

    if (!runtime) {
      setGaps([])
      setSelectedId(null)
      setState('unavailable')

      return
    }

    setError(null)
    setState('loading')

    try {
      const response = await runtime.get<KnowledgeGapsResponse>('/api/kb-gaps?status=new&limit=50')

      if (currentRuntime.current !== runtime || sequence !== loadSequence.current) { return }
      const next = response.gaps ?? []

      setGaps(next)
      setSelectedId(current =>
        current && next.some(row => row.gap_id === current) ? current : (next[0]?.gap_id ?? null)
      )
      setState(response.error ? 'error' : 'ready')
      setError(response.error ?? null)
    } catch (reason) {
      if (currentRuntime.current !== runtime || sequence !== loadSequence.current) { return }
      setGaps([])
      setSelectedId(null)
      setState('error')
      setError(reason instanceof Error ? reason.message : 'cannot load knowledge gaps')
    }
  }, [runtime])

  useEffect(() => {
    $work.set({ action: null, text: '', reason: '' })
    setNotice(null)
    setIdempotencyKey(crypto.randomUUID())
    void load()

    return invalidateLoad
  }, [$work, invalidateLoad, load])

  const selected = gaps.find(row => row.gap_id === selectedId)

  const author = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!ENTERPRISE_LEARNING_ENABLED || $enterprisePackageInstallFrozen.get() || !runtime?.post || !selected?.gap_id || !text.trim()) {
      return
    }

    setAction('author')
    setError(null)
    setNotice(null)
    void runtime
      .post<{ candidate_id?: string; status?: string; retrievable?: boolean }>('/api/knowledge-gap-submit-review', { gap_id: selected.gap_id, correction: text.trim(), idempotency_key: idempotencyKey })
      .then(async receipt => {
        if (currentRuntime.current !== runtime) { return }

        if (!receipt.candidate_id || receipt.status !== 'needs_review' || receipt.retrievable !== false) {
          throw new Error('未收到完整审核提交确认，请保留内容后重试。')
        }

        setText('')
        setIdempotencyKey(crypto.randomUUID())
        setNotice('补充知识已提交审核。完成独立审核和发布后才会用于问答，当前缺口仍待解决。')
        await load()
      })
      .catch(async reason => {
        if (currentRuntime.current !== runtime) { return }
        await reconcileAfterConflict(reason, load)
        setError(reason instanceof Error ? reason.message : 'cannot author knowledge gap')
      })
      .finally(() => { if (currentRuntime.current === runtime) { setAction(null) } })
  }

  const reject = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if ($enterprisePackageInstallFrozen.get() || !runtime?.post || !selected?.gap_id || !reason.trim()) {
      return
    }

    setAction('reject')
    setError(null)
    void runtime
      .post('/api/kb-gap-reject', { gap_id: selected.gap_id, reason: reason.trim() })
      .then(async () => {
        if (currentRuntime.current !== runtime) { return }
        setReason('')
        await load()
      })
      .catch(async reason => {
        if (currentRuntime.current !== runtime) { return }
        await reconcileAfterConflict(reason, load)
        setError(reason instanceof Error ? reason.message : 'cannot reject knowledge gap')
      })
      .finally(() => { if (currentRuntime.current === runtime) { setAction(null) } })
  }

  return (
    <section className="hesc-card hesc-audit-card" data-testid="enterprise-client-knowledge-gaps">
      <div className="hesc-section-heading">
        <div>
          <h2 className="hesc-section-title">知识缺口治理</h2>
          <p className="hesc-muted-copy">查看已记录的问题。新增知识请前往知识库上传，完成审核和发布后用于企业问答。</p>
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
      {notice ? <p className="hesc-muted-copy" role="status">{notice}</p> : null}
      {state === 'ready' && gaps.length === 0 ? <p className="hesc-muted-copy">当前没有待处理的知识缺口。</p> : null}
      <div className="hesc-outbound-list">
        {gaps.map((gap, index) => {
          const gapId = gap.gap_id

          return (
            <button
              aria-current={gapId === selectedId ? 'true' : undefined}
              disabled={!gapId || action !== null || (gapId !== selectedId && Boolean(text.trim() || reason.trim()))}
              key={gapId ?? `gap-${index}`}
              onClick={() => { setSelectedId(gapId ?? null); setIdempotencyKey(crypto.randomUUID()); setNotice(null) }}
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
          <p className="hesc-muted-copy">编辑期间请先提交或清空文字，再切换问题。</p>
          {ENTERPRISE_LEARNING_ENABLED ? <form className="hesc-agent-composer" onSubmit={author}>
            <label htmlFor="enterprise-gap-content">补充知识</label>
            <textarea
              disabled={action !== null}
              id="enterprise-gap-content"
              maxLength={4000}
              onChange={event => { if (!$enterprisePackageInstallFrozen.get()) {setText(event.target.value); setIdempotencyKey(crypto.randomUUID())} }}
              placeholder="填写待审核的完整知识建议，保留适用条件并移除客户个人资料"
              value={text}
            />
            <button className="hesc-action" disabled={!runtime?.post || action !== null} type="submit">
              {action === 'author' ? '正在提交…' : '提交补充知识审核'}
            </button>
            <button className="hesc-action" disabled={action !== null} onClick={() => { setText(''); setReason(''); setIdempotencyKey(crypto.randomUUID()) }} type="button">清空未提交文字</button>
          </form> : <p className="hesc-muted-copy">本版暂不启用学习反馈；请通过知识库上传补充资料。</p>}
          <form className="hesc-agent-composer" onSubmit={reject}>
            <label htmlFor="enterprise-gap-reason">驳回原因</label>
            <input
              disabled={frozen}
              id="enterprise-gap-reason"
              onChange={event => { if (!$enterprisePackageInstallFrozen.get()) {setReason(event.target.value)} }}
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
