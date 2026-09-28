import { useStore } from '@nanostores/react'
import { atom, type WritableAtom } from 'nanostores'

import { Button } from '@/components/ui/button'

import type { CustomerReplyWorkspaceStore } from './customer-reply'
import { flushCustomerDraftsForRequest } from './customer-reply-persistence'
import { $enterprisePackageInstallFrozen, registerEnterpriseInstallActivity } from './enterprise-install-readiness'
import type { EnterpriseClientRuntime } from './runtime'

interface FeedbackState {
  question: string
  correction: string
  idempotencyKey: string
  busy: boolean
  notice: string | null
  error: string | null
}

interface FeedbackRow {
  state: WritableAtom<FeedbackState>
  unsubscribe: () => void
}

interface FeedbackGroup {
  rows: Map<string, FeedbackRow>
  retired: boolean
  activity: ReturnType<typeof registerEnterpriseInstallActivity>
  unsubscribe: () => void
}

interface FeedbackReceipt {
  kind: 'gap' | 'correction'
  recorded: boolean
  gap_id: string
  candidate_id?: string
  status?: string
  retrievable?: boolean
}

export interface CustomerReplyFeedbackProps {
  workspace: CustomerReplyWorkspaceStore
  customerId: string
  runtime: EnterpriseClientRuntime | null
  ready: boolean
}

const groups = new WeakMap<CustomerReplyWorkspaceStore, FeedbackGroup>()

function feedbackFor(workspace: CustomerReplyWorkspaceStore, customerId: string) {
  let group = groups.get(workspace)

  if (!group) {
    const rows = new Map<string, FeedbackRow>()

    const activity = registerEnterpriseInstallActivity({ blocker: () => {
      for (const row of rows.values()) {
        const state = row.state.get()

        if (state.busy) { return '客户知识反馈正在提交，请等待完成后更新。' }

        if (state.question.trim() || state.correction.trim()) { return '客户知识反馈有未提交文字，请先提交或清空后更新。' }
      }

      return null
    } })

    group = { rows, retired: false, activity, unsubscribe: workspace.listen(value => {
      const ids = new Set(value.customers.map(customer => customer.id))

      for (const [id, row] of rows) {
        if (!ids.has(id)) { row.unsubscribe(); rows.delete(id); activity.changed() }
      }
    }) }
    groups.set(workspace, group)
  }

  let row = group.rows.get(customerId)

  if (!row) {
    const state = atom<FeedbackState>({ question: '', correction: '', idempotencyKey: crypto.randomUUID(), busy: false, notice: null, error: null })

    row = { state, unsubscribe: state.listen(group.activity.changed) }
    group.rows.set(customerId, row)
  }

  return { group, state: row.state }
}

/** Navigation keeps feedback; retiring an authenticated scope removes it. */
export function retireCustomerReplyFeedback(workspace: CustomerReplyWorkspaceStore): void {
  const group = groups.get(workspace)

  if (!group) { return }
  group.retired = true
  group.unsubscribe()
  group.activity.dispose()

  for (const row of group.rows.values()) { row.unsubscribe() }
  group.rows.clear()
  groups.delete(workspace)
}

export function CustomerReplyFeedback({ workspace, customerId, runtime, ready }: CustomerReplyFeedbackProps) {
  const { group, state: $state } = feedbackFor(workspace, customerId)
  const state = useStore($state)
  const frozen = useStore($enterprisePackageInstallFrozen)
  const current = () => !group.retired && group.rows.get(customerId)?.state === $state && workspace.get().customers.some(customer => customer.id === customerId)
  const disabled = frozen || state.busy || !ready || !runtime?.post

  function edit(field: 'question' | 'correction', value: string) {
    if ($enterprisePackageInstallFrozen.get() || $state.get().busy || !current()) { return }
    $state.set({ ...$state.get(), [field]: value, idempotencyKey: crypto.randomUUID(), notice: null, error: null })
  }

  async function submit(kind: 'gap' | 'correction') {
    if (disabled || !current() || !$state.get().question.trim()) { return }
    const snapshot = $state.get()

    if (kind === 'correction' && !snapshot.correction.trim()) { return }
    $state.set({ ...snapshot, busy: true, notice: null, error: null })

    try {
      const saved = await flushCustomerDraftsForRequest(workspace)

      if (!current() || $enterprisePackageInstallFrozen.get()) { return }

      const receipt = await runtime!.post!<FeedbackReceipt>('/api/customer-reply-feedback', {
        kind, customer_id: customerId, workspace_revision: saved.revision,
        question: snapshot.question.trim(),
        ...(kind === 'correction' ? { correction: snapshot.correction.trim() } : {}),
        idempotency_key: snapshot.idempotencyKey
      })

      if (!current()) { return }

      if (receipt.kind !== kind || receipt.recorded !== true || typeof receipt.gap_id !== 'string' || !receipt.gap_id ||
          (kind === 'correction' && (!receipt.candidate_id || receipt.status !== 'needs_review' || receipt.retrievable !== false))) {
        throw new Error('未收到完整的提交确认，请保留文字后重试。')
      }

      $state.set({ question: kind === 'correction' || !snapshot.correction.trim() ? '' : snapshot.question, correction: kind === 'correction' ? '' : snapshot.correction, idempotencyKey: crypto.randomUUID(), busy: false, error: null,
        notice: kind === 'correction' ? '纠正建议已提交审核。经独立审核和发布后，才会用于企业知识问答。' : '知识缺口已登记，等待企业管理人员补充资料。' })
    } catch (error) {
      if (current()) { $state.set({ ...$state.get(), error: error instanceof Error ? error.message : '提交失败，已保留文字，可重试。' }) }
    } finally {
      if (current()) { $state.set({ ...$state.get(), busy: false }) }
    }
  }

  return (
    <details className="hesc-customer-feedback">
      <summary>帮助改进企业知识</summary>
      <div className="hesc-agent-composer">
        <p className="hesc-muted-copy">只提交可供企业内部审核的问题和纠正建议，请先删除客户姓名、电话、订单号等资料。不会自动提交会话、客户记忆或录音。</p>
        <label htmlFor={`feedback-question-${customerId}`}>需要补充或纠正的问题</label>
        <textarea disabled={disabled} id={`feedback-question-${customerId}`} maxLength={1000} onChange={event => edit('question', event.target.value)} placeholder="例如：已签收包裹应按哪种售后流程处理？" rows={2} value={state.question} />
        <label htmlFor={`feedback-correction-${customerId}`}>人工纠正建议（登记缺口时可不填）</label>
        <textarea disabled={disabled} id={`feedback-correction-${customerId}`} maxLength={4000} onChange={event => edit('correction', event.target.value)} placeholder="填写建议采用的完整表述，并保留适用条件。" rows={3} value={state.correction} />
        <div className="hesc-inline-actions">
          <Button disabled={disabled || !state.question.trim() || !state.correction.trim()} onClick={() => void submit('correction')} size="sm">提交纠正建议审核</Button>
          <Button disabled={disabled || !state.question.trim()} onClick={() => void submit('gap')} size="sm" variant="outline">只登记知识缺口</Button>
          <Button disabled={frozen || state.busy} onClick={() => { edit('question', ''); edit('correction', '') }} size="sm" variant="ghost">清空</Button>
        </div>
        {state.busy ? <p role="status">正在保存当前客户并提交…</p> : null}
        {state.notice ? <p role="status">{state.notice}</p> : null}
        {state.error ? <p className="hesc-error-copy" role="alert">{state.error}</p> : null}
      </div>
    </details>
  )
}
