import { useStore } from '@nanostores/react'
import { useWebPresentation } from './web-presentation'
import { useWebLayoutCopy } from './web-sections'
import { atom } from 'nanostores'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { $enterprisePackageInstallFrozen, registerEnterpriseInstallActivity } from './enterprise-install-readiness'
import { KnowledgeConflictsPanel } from './knowledge-conflicts-panel'
import { KnowledgeGapsPanel } from './knowledge-gaps-panel'
import { KnowledgeUploadHistory, RechunkControls } from './knowledge-upload-history'
import type { EnterpriseClientRuntime } from './runtime'

interface Candidate {
  candidate_id: string
  topic: string | null
  text: string
  status: string
  risk_level: string
  created_by_principal_id: string
  reviewed_by_principal_id: string | null
  kb_state: string | null
  retrievable: boolean
  publication_stage: string | null
}
interface CandidatesResponse {
  role?: string
  candidates: Candidate[]
  permissions: string[]
  principal_id: string
  has_more: boolean
}
interface KnowledgeStatus {
  available: boolean
  pending_review?: number
  published?: number
}
interface UploadResponse {
  upload_id: string
  filename?: string
  review_submission_limit?: number
  total?: number
  chunks?: { text: string }[]
}

function reviewSubmissionLimit(staged: UploadResponse): number {
  const limit = staged.review_submission_limit

  return typeof limit === 'number' && Number.isInteger(limit) && limit > 0 ? limit : 1_000
}

const labels: Record<string, string> = {
  approved: '审核通过 · 待发布',
  conflict: '待处理冲突',
  expired: '已失效',
  needs_review: '待审核',
  new: '待处理',
  published: '已发布记录 · 当前不可检索',
  rejected: '审核未通过',
  superseded: '已有替代版本'
}

function statusLabel(row: Candidate) {
  if (row.kb_state === 'withdrawn') {
    return '已撤回 · 不参与问答'
  }

  if (row.retrievable) {
    return '已发布 · 可用于问答'
  }

  return labels[row.status] ?? '等待状态确认'
}

async function retryKnowledgeRequest<T>(request: () => Promise<T>, attempts = 3): Promise<T> {
  let failure: unknown

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await request()
    } catch (reason) {
      failure = reason
      if (attempt < attempts) {
        await new Promise<void>(resolve => window.setTimeout(resolve, 250 * attempt))
      }
    }
  }

  throw failure
}

export function KnowledgePage({ runtime }: { runtime: EnterpriseClientRuntime | null }) {
  const web = useWebPresentation()
  const layout = useWebLayoutCopy()
  const [section, setSection] = useState('knowledge')
  const [$work] = useState(() => atom<{ topic: string; file: File | null; staged: UploadResponse | null; reason: string; busy: boolean }>({ topic: '', file: null, staged: null, reason: '', busy: false }))
  const { topic, file, staged, reason, busy: working } = useStore($work)
  const frozen = useStore($enterprisePackageInstallFrozen)
  const busy = working || frozen
  const setTopic = useCallback((topic: string) => $work.set({ ...$work.get(), topic }), [$work])
  const setFile = useCallback((file: File | null) => $work.set({ ...$work.get(), file }), [$work])
  const setStaged = useCallback((staged: UploadResponse | null) => $work.set({ ...$work.get(), staged }), [$work])
  const setReason = useCallback((reason: string) => $work.set({ ...$work.get(), reason }), [$work])
  const setBusy = useCallback((busy: boolean) => $work.set({ ...$work.get(), busy }), [$work])
  const [data, setData] = useState<CandidatesResponse | null>(null)
  const [knowledgeStatus, setKnowledgeStatus] = useState<KnowledgeStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [filter, setFilter] = useState('all')
  const [offset, setOffset] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const lifecycle = useMemo(() => ({ runtime, active: true }), [runtime])
  const version = useRef(0)
  const fileInput = useRef<HTMLInputElement>(null)
  const [editableChunks, setEditableChunks] = useState<string[] | null>(null)
  const [checked, setChecked] = useState<string[]>([])
  const [confirmBatchWithdraw, setConfirmBatchWithdraw] = useState(false)

  useEffect(() => {
    const activity = registerEnterpriseInstallActivity({ blocker: () => {
      const work = $work.get()

      if (work.busy) {return '知识资料正在上传、审核或发布，请等待完成后更新。'}

      if (work.file || work.staged || work.topic.trim() || work.reason.trim()) {return '知识页有未提交资料或说明，请先完成提交或清空后更新。'}

      return null
    } })

    const unsubscribe = $work.listen(activity.changed)

    return () => { unsubscribe(); activity.dispose() }
  }, [$work, runtime])

  const refresh = useCallback(async () => {
    if (!runtime) {
      return
    }

    const request = ++version.current
    setLoading(true)

    try {
      const statusRequest = runtime.get<KnowledgeStatus>('/api/knowledge-status').catch(() => null)
      const response = await runtime.get<CandidatesResponse>(
        `/api/knowledge-candidates?status=${filter}&offset=${offset}&limit=100`
      )
      const status = await statusRequest

      if (!lifecycle.active || request !== version.current) {
        return
      }

      setData(response)
      setKnowledgeStatus(status)
      setChecked(current => current.filter(id => response.candidates.some(row => row.candidate_id === id && ['needs_review', 'approved'].includes(row.status))))
      setSelectedId(current =>
        response.candidates.some(row => row.candidate_id === current)
          ? current
          : (response.candidates[0]?.candidate_id ?? null)
      )
      setError(null)
    } catch (failure) {
      if (!lifecycle.active || request !== version.current) {
        return
      }

      setError(failure instanceof Error ? failure.message : '知识状态暂时无法读取')
    } finally {
      if (lifecycle.active && request === version.current) {
        setLoading(false)
      }
    }
  }, [runtime, filter, offset, lifecycle])

  useEffect(() => {
    lifecycle.active = true
    setData(null)
    setChecked([])
    setEditableChunks(null)
    setSelectedId(null)
    setStaged(null)
    setFile(null)
    setTopic('')
    setReason('')
    setNotice(null)
    setError(null)
    setBusy(false)

    return () => {
      lifecycle.active = false
    }
  }, [lifecycle, setBusy, setFile, setReason, setStaged, setTopic])
  useEffect(() => {
    void refresh()
  }, [refresh])

  const has = (permission: string) => Boolean(data?.permissions.includes(permission) || data?.permissions.includes('*'))
  const selected = data?.candidates.find(row => row.candidate_id === selectedId)
  const canUpload = has('kb.upload') && has('kb.author')

  const canReview = Boolean(
    selected &&
    selected.status === 'needs_review' &&
    (data?.role === 'tenant_admin' || selected.created_by_principal_id !== data?.principal_id) &&
    has(selected.risk_level === 'high' ? 'kb.candidate.approve' : 'kb.candidate.review')
  )

  const canPublish = Boolean(
    selected &&
    selected.status === 'approved' &&
    has('kb.candidate.publish') &&
    (data?.role === 'tenant_admin' || selected.created_by_principal_id !== data?.principal_id) &&
    (data?.role === 'tenant_admin' || selected.reviewed_by_principal_id !== data?.principal_id)
  )
  const checkedRows = data?.candidates.filter(row => checked.includes(row.candidate_id)) ?? []
  const checkedForPublish = checkedRows.filter(row => row.status === 'needs_review' || row.status === 'approved')

  async function perform(action: () => Promise<string>) {
    if ($enterprisePackageInstallFrozen.get() || !runtime || busy) {
      return
    }

    setBusy(true)
    setError(null)
    setNotice(null)

    try {
      const message = await action()

      if (!lifecycle.active) {
        return
      }

      setNotice(message)
      await refresh()
    } catch (failure) {
      if (!lifecycle.active) {
        return
      }

      await refresh()

      if (!lifecycle.active) {
        return
      }

      setError(failure instanceof Error ? failure.message : '操作未完成，请刷新状态后重试')
    } finally {
      if (lifecycle.active) {
        setBusy(false)
      }
    }
  }

  async function upload() {
    if (!runtime?.upload || !file || !topic.trim()) {
      return
    }

    const origin = runtime

    if (file.size > 50 * 1024 * 1024) {
      setError('文件超过 50 MiB 上传上限，请拆分后再试')

      return
    }

    await perform(async () => {
      const response = await origin.upload!<UploadResponse>('/api/knowledge-upload', {
        bytes: await file.arrayBuffer(),
        contentType: file.type || 'application/octet-stream',
        filename: file.name
      })

      if (!response.upload_id) {
        throw new Error('服务端未返回上传标识')
      }

      if (lifecycle.active) {
        setStaged(response)
        setEditableChunks(null)
      }

      return '文件已解析，请核对预览后提交审核。此时不会用于 AI 问答。'
    })
  }

  async function submitReview() {
    if (!runtime?.post || !staged) {
      return
    }

    const total = staged.total ?? staged.chunks?.length
    const limit = reviewSubmissionLimit(staged)

    if (typeof total === 'number' && total > limit) {
      setNotice(null)
      setError(`本次已解析 ${total} 条知识，单次最多可提交 ${limit} 条。请拆分文件后重新上传；当前预览会保留。`)

      return
    }

    const origin = runtime
    await perform(async () => {
      if (editableChunks) { await origin.post!('/api/knowledge-edit-chunks', { upload_id: staged.upload_id, chunks: editableChunks }) }
      await origin.post!('/api/knowledge-submit-review', { upload_id: staged.upload_id, topic: topic.trim() })

      if (lifecycle.active) {
        setStaged(null)
        setFile(null)
        setTopic('')
      }

      return '资料已进入审核队列，企业管理员可自行审核并发布。'
    })
  }

  async function review(verdict: string) {
    if (!runtime?.post || !selected) {
      return
    }

    const origin = runtime
    await perform(async () => {
      await origin.post!('/api/knowledge-review', {
        candidate_id: selected.candidate_id,
        verdict,
        reason: reason.trim() || null,
        idempotency_key: crypto.randomUUID()
      })

      if (lifecycle.active) {setReason('')}

      if (verdict === 'approved' && data?.role === 'tenant_admin') {
        const result = await origin.post!<{ done: boolean }>('/api/knowledge-publish', {
          candidate_id: selected.candidate_id, idempotency_key: crypto.randomUUID()
        })
        return result.done ? '审核并发布完成，可用于企业 AI 问答。' : '审核已通过，发布进度已保存，请点击继续发布。'
      }
      return verdict === 'approved' ? '审核已通过，可继续发布。' : '已记录未通过审核，资料不会用于问答。'
    })
  }

  async function publish() {
    if (!runtime?.post || !selected) {
      return
    }

    const origin = runtime
    await perform(async () => {
      const result = await origin.post!<{ done: boolean }>('/api/knowledge-publish', {
        candidate_id: selected.candidate_id,
        idempotency_key: crypto.randomUUID()
      })

      return result.done
        ? '知识已完成发布，可供有权限的企业成员查询。'
        : '发布进度已保存，索引尚未完成。请刷新状态后继续发布。'
    })
  }

  async function publishChecked() {
    if (!runtime?.post || data?.role !== 'tenant_admin') {return}
    const origin = runtime
    const rows = checkedForPublish
    await perform(async () => {
      let done = 0
      for (const row of rows) {
        if (!lifecycle.active) {break}
        try {
          if (row.status === 'needs_review') {
            const reviewKey = crypto.randomUUID()
            await retryKnowledgeRequest(() => origin.post!('/api/knowledge-review', {
              candidate_id: row.candidate_id, verdict: 'approved', reason: reason.trim() || null, idempotency_key: reviewKey
            }))
          }
          const publishKey = crypto.randomUUID()
          const result = await retryKnowledgeRequest(() => origin.post!<{ done: boolean }>('/api/knowledge-publish', {
            candidate_id: row.candidate_id, idempotency_key: publishKey
          }))
          if (!result.done) {throw new Error('该条发布尚未完成，请刷新后继续发布')}
          done++
          setChecked(current => current.filter(id => id !== row.candidate_id))
        } catch (failure) {
          throw new Error(`已发布 ${done}/${rows.length} 条；在“${row.topic ?? '企业知识'}”处停止。该条已自动重试 3 次仍未完成：${failure instanceof Error ? failure.message : '请重试'}。已完成的记录保留，可再次点击继续处理未完成项。`)
        }
      }
      return `已审核并发布 ${done} 条资料，可用于企业 AI 问答。`
    })
  }

  async function deleteKnowledge() {
    if (!runtime?.post || !selected) {
      return
    }

    const origin = runtime
    await perform(async () => {
      await retryKnowledgeRequest(() => origin.post!('/api/knowledge-discard', { candidate_id: selected.candidate_id }))

      return web.enabled ? '知识已永久删除。' : '知识已永久删除，服务端的知识记录、切片和检索索引已一并清除。'
    })
  }

  async function withdrawChecked() {
    if (!runtime?.post || !checkedRows.length) {return}
    const origin = runtime
    const rows = checkedRows
    setConfirmBatchWithdraw(false)
    await perform(async () => {
      let done = 0
      const failedTopics: string[] = []
      for (const row of rows) {
        try {
          await retryKnowledgeRequest(() => origin.post!('/api/knowledge-discard', { candidate_id: row.candidate_id }))
          done++
          setChecked(current => current.filter(id => id !== row.candidate_id))
        } catch {
          // One stale or conflicted row must not prevent the remaining selected
          // knowledge from being removed. Failed rows stay checked for retry.
          failedTopics.push(row.topic ?? '企业知识')
        }
      }
      if (failedTopics.length) {
        const preview = failedTopics.slice(0, 3).join('、')
        const more = failedTopics.length > 3 ? ` 等 ${failedTopics.length} 条` : ''
        throw new Error(`已删除 ${done}/${rows.length} 条；${preview}${more} 自动重试 3 次后仍未完成。其余资料已从知识库和检索索引清除；失败项仍保持勾选，可刷新后继续删除。`)
      }
      return web.enabled ? `已永久删除 ${done} 条知识。` : `已批量删除 ${done} 条知识；资料、审核候选、切片和检索索引均已从服务器清除。`
    })
  }

  return (
    <section className="hesc-page" data-testid="enterprise-client-knowledge">
      <header className="hesc-page-header">
        <div>
          <h1>企业知识</h1>
          <p>{web.enabled ? '管理企业资料，审核发布后可用于问答。' : '只有已发布且当前有效的资料参与企业知识问答。删除会永久清除资料、审核候选、切片和检索索引。'}</p>
        </div>
        {canUpload ? <button className="hesc-action" disabled={busy || Boolean(staged)} onClick={() => {setSection('upload'); fileInput.current?.click()}} type="button">上传文件</button> : null}
        <button
          className="hesc-action"
          disabled={!runtime || loading || busy}
          onClick={() => void refresh()}
          type="button"
        >
          {loading ? '正在读取' : '刷新状态'}
        </button>
      </header>
      {error ? (
        <div className="hesc-error" role="alert">
          <div>
            <strong>知识服务提示</strong>
            <span>{error}</span>
          </div>
        </div>
      ) : null}
      {notice ? (
        <p className="hesc-provisioning-notice" role="status">
          {notice}
        </p>
      ) : null}
      {!runtime ? <p className="hesc-muted-copy">连接企业服务后即可读取知识状态。</p> : null}
      {web.enabled ? <div className="web-section-tabs" role="group" aria-label={layout.settings}>{[['knowledge',layout.knowledge],...(canUpload ? [['upload',layout.upload]] : []),['gaps',layout.gaps]].map(([id,label]) => <button className="hesc-action" type="button" aria-pressed={section === id} key={id} onClick={() => setSection(id)}>{label}</button>)}</div> : null}

      {canUpload ? (
        <article className="hesc-card" hidden={web.enabled && section !== 'upload'}>
          {runtime ? <KnowledgeUploadHistory runtime={runtime} disabled={busy || Boolean(staged || file || topic)} onResume={row => perform(async () => {
            const preview = await runtime.get<UploadResponse>(`/api/knowledge-preview?upload_id=${encodeURIComponent(row.upload_id)}&offset=0&limit=50`)
            if (!Array.isArray(preview.chunks) || typeof preview.total !== 'number') {throw new Error('服务端未返回有效预览')}
            if (lifecycle.active) {setStaged({ ...preview, upload_id: row.upload_id, filename: row.filename }); setTopic(row.filename.replace(/\.[^.]+$/, '')); setFile(null); setEditableChunks(null)}
            return '已恢复历史上传预览，请核对后提交审核。'
          })} /> : null}
          <div className="hesc-knowledge-upload-layout">
            <div>
              <h2 className="hesc-section-title">上传企业知识</h2>
              {web.enabled ? <details><summary>文件格式说明</summary><p>Markdown 按 <code>##</code> 标题分段，XLSX 按行导入。请核对预览并提交审核，资料不会自动发布。</p></details> : <p className="hesc-muted-copy">文件先解析为待审核切片。Markdown 文件以每个 <code>##</code> 标题作为知识单元起点；XLSX 表格会以每条数据行作为一个完整知识单元，保留问题、相似问法和答案在同一切片。旧版“已入库”资料需重新上传并审核，不会自动发布。</p>}
              <form
                className="hesc-provisioning-form"
                onSubmit={event => {
                  event.preventDefault()
                  void upload()
                }}
              >
                <label>
                  知识主题
                  <input
                    disabled={busy || Boolean(staged)}
                    onChange={event => setTopic(event.target.value)}
                    placeholder="例如：员工手册"
                    value={topic}
                  />
                </label>
                <label>
                  选择文件
                  <input
                    ref={fileInput}
                    accept=".txt,.md,.pdf,.docx,.csv,.xlsx"
                    disabled={busy || Boolean(staged)}
                    onChange={event => { const selected = event.currentTarget.files?.[0] ?? null; setFile(selected); if (selected && !topic.trim()) {setTopic(selected.name.replace(/\.[^.]+$/, ''))} }}
                    type="file"
                  />
                </label>
                <button
                  className="hesc-action"
                  disabled={busy || !file || !topic.trim() || Boolean(staged) || !runtime?.upload}
                  type="submit"
                >
                  {working && !staged ? '正在解析' : '上传并预览'}
                </button>
              </form>
            </div>
            <aside aria-live="polite" className="hesc-knowledge-status-card">
              <h3>知识库状态</h3>
              {knowledgeStatus?.available ? <>
                <div><strong>{knowledgeStatus.published ?? 0}</strong><span>审核通过并已发布</span></div>
                <div><strong>{knowledgeStatus.pending_review ?? 0}</strong><span>待审核 / 待处理</span></div>
                <p>仅“已发布”资料参与企业知识检索。</p>
              </> : <p>知识状态暂时无法读取；未以零值替代真实数据。</p>}
            </aside>
          </div>
          {staged ? (
            <div>
              <RechunkControls disabled={busy || !runtime?.post || Boolean(editableChunks)} onRechunk={(chunk_size, overlap) => perform(async () => {
                const result = await runtime!.post!<UploadResponse>('/api/knowledge-rechunk', { upload_id: staged.upload_id, chunk_size, overlap })
                if (!Array.isArray(result.chunks) || typeof result.total !== 'number') {throw new Error('服务端未返回有效切分预览')}
                if (lifecycle.active) {setStaged({ ...staged, ...result, upload_id: staged.upload_id }); setEditableChunks(null)}
                return '已重新切分，请重新核对预览。'
              })} />
              <h3>
                {staged.filename ?? file?.name} · 共 {staged.total ?? staged.chunks?.length ?? '待确认'} 个切片
              </h3>
              <p className="hesc-muted-copy">
                以下为前 {Math.min(3, staged.chunks?.length ?? 0)} 个切片预览。提交后可在审核队列逐条核对全文。
              </p>
              {typeof staged.total === 'number' ? (
                <p className="hesc-muted-copy" role="status">
                  本次已解析 {staged.total} 条知识；单次最多可提交 {reviewSubmissionLimit(staged)} 条。
                </p>
              ) : null}
              {web.enabled && editableChunks ? <p role="status" className="web-editing-notice">{web.words.editing}</p> : null}
              {editableChunks ? editableChunks.map((text, index) => (
                <label key={index}>第 {index + 1} 段
                  <textarea className="hesc-pre" rows={6} value={text} disabled={busy} onChange={event => setEditableChunks(current => current!.map((value, i) => i === index ? event.target.value : value))} />
                </label>
              )) : staged.chunks?.slice(0, 3).map((chunk, index) => <pre className="hesc-pre" key={index}>{chunk.text}</pre>)}
              {!editableChunks ? <button className="hesc-action" disabled={busy} type="button" onClick={() => void perform(async () => {
                const chunks: string[] = []
                let total = 1
                for (let offset = 0; offset < total; offset += 500) {
                  const page = await runtime!.get<{ total: number; chunks: { text: string }[] }>(`/api/knowledge-preview?upload_id=${encodeURIComponent(staged.upload_id)}&offset=${offset}&limit=500`)
                  total = page.total
                  chunks.push(...page.chunks.map(chunk => chunk.text))
                }
                if (lifecycle.active) {setEditableChunks(chunks)}
                return '可直接修改各段文字，提交审核时保存。'
              })}>编辑全文</button> : null}
              <div className="hesc-inline-actions">
                <button
                  className="hesc-action"
                  disabled={busy || !runtime?.post}
                  onClick={() => void submitReview()}
                  type="button"
                >
                  提交审核
                </button>
                <button
                  className="hesc-action"
                  disabled={busy}
                  onClick={() => {
                    setStaged(null)
                    setNotice(null)
                  }}
                  type="button"
                >
                  重新选择文件
                </button>
              </div>
            </div>
          ) : null}
        </article>
      ) : null}

      <div className="hesc-knowledge-layout" hidden={web.enabled && section !== 'knowledge'}>
        <aside aria-label="知识审核队列" className="hesc-card hesc-knowledge-collections">
          <h2 className="hesc-section-title">知识审核与发布</h2>
          <label>
            资料状态
            <select
              onChange={event => {
                setFilter(event.target.value)
                setOffset(0)
                setReason('')
              }}
              value={filter}
            >
              <option value="all">全部状态</option>
              <option value="needs_review">待审核</option>
              <option value="approved">待发布</option>
              <option value="published">发布记录</option>
              <option value="rejected">未通过审核</option>
            </select>
          </label>
          {loading ? <p className="hesc-muted-copy">正在读取知识状态…</p> : null}
          {!loading && data?.candidates.length === 0 ? (
            <p className="hesc-muted-copy">此列表暂无资料。企业管理员可上传、审核并发布。</p>
          ) : null}
          <div className="hesc-collection-list">
            {data?.role === 'tenant_admin' ? <div className="hesc-inline-actions"><button className="hesc-action" disabled={busy} type="button" onClick={() => setChecked(data.candidates.filter(row => row.status === 'approved' || (row.status === 'needs_review' && has(row.risk_level === 'high' ? 'kb.candidate.approve' : 'kb.candidate.review'))).map(row => row.candidate_id))}>选择本页待处理</button><button className="hesc-action" type="button" hidden={web.enabled && !checkedRows.length} disabled={busy || !checkedForPublish.length} onClick={() => void publishChecked()}>审核并发布所选（{checkedForPublish.length}）</button>{has('kb.delete') ? <><button className="hesc-action" disabled={busy} type="button" onClick={() => setChecked(data.candidates.map(row => row.candidate_id))}>选择本页知识</button><button className="hesc-action hesc-action-danger" hidden={web.enabled && !checkedRows.length} disabled={busy || !checkedRows.length} onClick={() => setConfirmBatchWithdraw(true)} type="button">批量删除（{checkedRows.length}）</button></> : null}</div> : null}
            {confirmBatchWithdraw ? <div className="hesc-confirmation" role="alert"><p>确认永久删除所选 {checkedRows.length} 条知识？资料、审核候选、切片和检索索引都会从服务器清除，无法恢复。</p><div className="hesc-inline-actions"><button className="hesc-action hesc-action-danger" disabled={busy} onClick={() => void withdrawChecked()} type="button">确认批量删除</button><button className="hesc-action hesc-action-secondary" disabled={busy} onClick={() => setConfirmBatchWithdraw(false)} type="button">取消</button></div></div> : null}
            {data?.candidates.map(row => (
              <div key={row.candidate_id}>
              {data.role === 'tenant_admin' && (['needs_review', 'approved'].includes(row.status) || has('kb.delete')) ? <label><input type="checkbox" aria-label={`选择 ${row.topic ?? '企业知识'} ${row.candidate_id}`} checked={checked.includes(row.candidate_id)} disabled={busy} onChange={event => { setConfirmBatchWithdraw(false); setChecked(current => event.target.checked ? [...current, row.candidate_id] : current.filter(id => id !== row.candidate_id)) }} />{web.enabled ? web.words.selectKnowledge : has('kb.delete') ? '加入批量删除' : '加入批量处理'}</label> : null}
              <button
                aria-current={row.candidate_id === selectedId ? 'true' : undefined}
                key={row.candidate_id}
                onClick={() => {
                  setSelectedId(row.candidate_id)
                  setReason('')
                }}
                type="button"
              >
                <span>
                  {row.topic ?? '企业知识'} · {row.candidate_id.slice(-6)}
                </span>
                <small>{statusLabel(row)}</small>
              </button>
              </div>
            ))}
          </div>
          <div className="hesc-inline-actions">
            <button
              disabled={offset === 0 || loading}
              onClick={() => setOffset(Math.max(0, offset - 100))}
              type="button"
            >
              上一页
            </button>
            <button disabled={!data?.has_more || loading} onClick={() => setOffset(offset + 100)} type="button">
              下一页
            </button>
          </div>
        </aside>
        <article className="hesc-card hesc-knowledge-entries">
          {selected ? (
            <>
              <div className="hesc-section-heading">
                <h2 className="hesc-section-title">{selected.topic ?? '知识详情'}</h2>
                <span className="hesc-status" data-tone={selected.retrievable ? 'success' : 'warning'}>
                  {statusLabel(selected)}
                </span>
              </div>
              <p className="hesc-muted-copy">
                {selected.risk_level === 'high' ? '高风险内容 · 需企业管理员审核' : '企业管理员审核并发布'}{' '}
                · 编号 {selected.candidate_id.slice(-6)}
              </p>
              <pre className="hesc-pre">{selected.text}</pre>
              {selected.status === 'needs_review' ? (
                <p className="hesc-muted-copy">
                  请核对资料准确性，企业管理员确认通过后直接发布。
                </p>
              ) : null}
              {selected.status === 'approved' ? (
                <p className="hesc-muted-copy">审核已通过，点击发布知识完成索引。</p>
              ) : null}
              {selected.status === 'conflict' ? (
                <KnowledgeConflictsPanel
                  candidateId={selected.candidate_id}
                  creatorId={selected.created_by_principal_id}
                  onChanged={refresh}
                  runtime={runtime}
                />
              ) : null}
              {canReview ? (
                <>
                  <label>
                    审核说明
                    <textarea
                      disabled={busy}
                      maxLength={2048}
                      onChange={event => setReason(event.target.value)}
                      placeholder="补充审核意见（选填）"
                      value={reason}
                    />
                  </label>
                  <div className="hesc-inline-actions">
                    <button
                      className="hesc-action"
                      disabled={busy}
                      onClick={() => void review('approved')}
                      type="button"
                    >
                      {data?.role === 'tenant_admin' ? '审核并发布' : '通过审核'}
                    </button>
                    <button
                      className="hesc-action"
                      disabled={busy}
                      onClick={() => void review('rejected')}
                      type="button"
                    >
                      不通过审核
                    </button>
                  </div>
                </>
              ) : null}
              {canPublish ? (
                <button className="hesc-action" disabled={busy} onClick={() => void publish()} type="button">
                  {selected.publication_stage ? '继续发布' : '发布知识'}
                </button>
              ) : null}
              {selected.retrievable && has('kb.delete') ? (
                <button className="hesc-action hesc-action-danger" disabled={busy} onClick={() => void deleteKnowledge()} type="button">
                  永久删除此知识
                </button>
              ) : null}
              {busy ? (
                <p className="hesc-muted-copy" role="status">
                  正在处理，完成后将刷新服务端状态…
                </p>
              ) : null}
            </>
          ) : (
            <p className="hesc-muted-copy">选择一条资料查看内容、审核结果和发布状态。</p>
          )}
        </article>
      </div>
      <div hidden={web.enabled && section !== 'gaps'}><KnowledgeGapsPanel runtime={runtime} /></div>
    </section>
  )
}
