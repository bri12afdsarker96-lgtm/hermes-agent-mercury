import { useStore } from '@nanostores/react'
import { useEffect, useId, useState } from 'react'

import { Button } from '@/components/ui/button'

import {
  addCustomerReply,
  closeCustomerReply,
  confirmCustomerMemory,
  type CustomerReplyCustomer,
  type CustomerReplyStore,
  type CustomerReplyWorkspaceStore,
  type CustomerReplyBackendChoice,
  generateCustomerReply,
  updateCustomerMemoryDraft,
  updateCustomerReplyInput
} from './customer-reply'
import { CustomerReplyFeedback } from './customer-reply-feedback'
import { AssistantResponseDetails } from './assistant-response-details'
import {
  customerDraftSyncFor,
  reloadCustomerDrafts,
  saveCustomerDrafts,
  startCustomerDraftSync
} from './customer-reply-persistence'
import { $enterprisePackageInstallFrozen } from './enterprise-install-readiness'
import { customerReplyPreferencesFor, ENTERPRISE_LEARNING_ENABLED, type EnterpriseReplyPreferences, updateCustomerReplyPreferences } from './enterprise-reply-preferences'
import type { EnterpriseClientRuntime } from './runtime'
import { VOICE_INPUT_FROZEN, VoiceControls } from './voice-controls'

interface CustomerReplyPanelProps {
  backendChoice?: CustomerReplyBackendChoice
  choiceProtocolSupported?: boolean
  customerId: string
  customerLabel: string
  configurationId?: string
  ready: boolean
  runtime: EnterpriseClientRuntime | null
  store: CustomerReplyStore
  workspace: CustomerReplyWorkspaceStore
}

type CustomerReplyWorkspaceProps = Omit<CustomerReplyPanelProps, 'store' | 'customerLabel' | 'customerId'>

function CustomerTab({
  active,
  customer,
  onSelect
}: {
  active: boolean
  customer: CustomerReplyCustomer
  onSelect: () => void
}) {
  const reply = useStore(customer.reply)

  const status =
    reply.phase === 'queued'
      ? '排队中'
      : reply.phase === 'generating'
        ? '生成中'
        : reply.copiedDraft && reply.copiedDraft === reply.draft
          ? '已复制 · 待发送'
          : reply.error
            ? '生成失败'
            : reply.knowledgeGrounded === false
              ? '待补充知识'
              : reply.knowledgeGrounded === true
                ? '待审核'
                : '待处理'

  return (
    <button aria-pressed={active} className="hesc-customer-tab" onClick={onSelect} type="button">
      <strong>{customer.label || '未命名客户'}</strong>
      <span>
        #{customer.id.slice(-8)} · {status}
      </span>
    </button>
  )
}

export function CustomerReplyWorkspace({ backendChoice, choiceProtocolSupported, configurationId, ready, runtime, workspace }: CustomerReplyWorkspaceProps) {
  const frozen = useStore($enterprisePackageInstallFrozen)
  const state = useStore(workspace)
  const sync = useStore(customerDraftSyncFor(workspace))
  const preferences = useStore(customerReplyPreferencesFor(workspace))
  const [search, setSearch] = useState('')
  const active = state.customers.find(customer => customer.id === state.activeId) ?? state.customers[0]
  const query = search.trim().toLocaleLowerCase()

  const matches = state.customers.filter(customer =>
    `${customer.label} ${customer.id}`.toLocaleLowerCase().includes(query)
  )

  useEffect(() => {
    if (runtime) {startCustomerDraftSync(workspace, runtime)}
    // Navigation leaves the scoped autosave alive. Authentication retirement
    // stops it before clearing customer state in assistant-session.ts.
  }, [runtime, workspace])

  return (
    <article aria-label="客户回复工作区" className="hesc-card hesc-customer-reply-workspace">
      <div className="hesc-section-heading">
        <div>
          <h2 className="hesc-section-title">客户回复建议</h2>
          <p className="hesc-muted-copy">
            每位客户独立保存上下文和草稿。本窗口同时生成最多 3 个，其余自动排队；企业服务器另有并发上限。
          </p>
        </div>
        <Button
          disabled={frozen || !sync.loaded || state.customers.length >= 200}
          onClick={() => {
            addCustomerReply(workspace)
            setSearch('')
          }}
          size="sm"
          variant="secondary"
        >
          新增客户
        </Button>
      </div>
      <div aria-live="polite" className="hesc-inline-actions">
        <span className="hesc-muted-copy">{sync.message}</span>
        {sync.phase === 'error' ? (
          <Button
            onClick={() => void (sync.loaded ? saveCustomerDrafts(workspace) : reloadCustomerDrafts(workspace))}
            size="sm"
            variant="text"
          >
            {sync.loaded ? '重试保存' : '重新读取草稿'}
          </Button>
        ) : null}
        {sync.phase === 'pending' ? (
          <Button onClick={() => void saveCustomerDrafts(workspace)} size="sm" variant="text">
            立即保存
          </Button>
        ) : null}
        {sync.phase === 'conflict' ? (
          <Button onClick={() => void reloadCustomerDrafts(workspace)} size="sm" variant="text">
            读取服务器版本并替换本机修改
          </Button>
        ) : null}
      </div>
      {ENTERPRISE_LEARNING_ENABLED ? <fieldset className="hesc-inline-actions" disabled={frozen || !sync.loaded}>
        <legend>回复偏好 · 本机当前账号</legend>
        <label>
          语气
          <select aria-label="回复语气" onChange={event => updateCustomerReplyPreferences(workspace, { ...preferences, tone: event.target.value as EnterpriseReplyPreferences['tone'] })} value={preferences.tone}>
            <option value="professional">专业</option><option value="warm">亲和</option>
          </select>
        </label>
        <label>
          长度
          <select aria-label="回复长度" onChange={event => updateCustomerReplyPreferences(workspace, { ...preferences, length: event.target.value as EnterpriseReplyPreferences['length'] })} value={preferences.length}>
            <option value="concise">简洁</option><option value="balanced">适中</option><option value="detailed">详细</option>
          </select>
        </label>
        <label>
          称呼
          <select aria-label="回复称呼" onChange={event => updateCustomerReplyPreferences(workspace, { ...preferences, address: event.target.value as EnterpriseReplyPreferences['address'] })} value={preferences.address}>
            <option value="nin">您</option><option value="ni">你</option>
          </select>
        </label>
        <span className="hesc-muted-copy">偏好用于允许的呈现；企业知识原文与条件保持不变。</span>
      </fieldset> : null}
      <fieldset className="hesc-customer-workbench" disabled={frozen || !sync.loaded}>
        <aside aria-label="客户队列" className="hesc-customer-queue">
          <label htmlFor="customer-reply-search">搜索客户 · 共 {state.customers.length} 位</label>
          <input
            aria-label="搜索客户备注或编号"
            id="customer-reply-search"
            onChange={event => setSearch(event.target.value)}
            placeholder="备注或客户编号"
            type="search"
            value={search}
          />
          <div aria-label="正在处理的客户" className="hesc-customer-tabs" role="group">
            {matches.map(customer => (
              <CustomerTab
                active={active.id === customer.id}
                customer={customer}
                key={customer.id}
                onSelect={() => { if (!$enterprisePackageInstallFrozen.get()) {workspace.set({ ...workspace.get(), activeId: customer.id })} }}
              />
            ))}
            {matches.length === 0 ? <p className="hesc-muted-copy">未找到客户。清除搜索可查看全部。</p> : null}
          </div>
          <p className="hesc-muted-copy">
            以编号区分同名客户。草稿加密保存于企业服务器，跨重启恢复；90 天未更新后清理。最多保留 200 位客户。
          </p>
        </aside>
        <div className="hesc-customer-detail">
          <div className="hesc-customer-identity">
            <label htmlFor="customer-reply-label">客户备注（仅用于区分工作区）</label>
            <input
              id="customer-reply-label"
              maxLength={80}
              onChange={event => {
                if ($enterprisePackageInstallFrozen.get()) {return}
                const current = workspace.get()
                workspace.set({
                  ...current,
                  customers: current.customers.map(customer =>
                    customer.id === active.id ? { ...customer, label: event.target.value } : customer
                  )
                })
              }}
              value={active.label}
            />
            <Button onClick={() => closeCustomerReply(workspace, active.id)} size="sm" variant="text">
              结束并清除当前客户
            </Button>
          </div>
          <CustomerReplyPanel
            backendChoice={backendChoice}
            choiceProtocolSupported={choiceProtocolSupported}
            configurationId={configurationId}
            customerId={active.id}
            customerLabel={active.label || '未命名客户'}
            key={active.id}
            ready={ready}
            runtime={runtime}
            store={active.reply}
            workspace={workspace}
          />
        </div>
      </fieldset>
    </article>
  )
}

function CustomerReplyPanel({
  backendChoice,
  choiceProtocolSupported,
  configurationId,
  customerId,
  customerLabel,
  ready,
  runtime,
  store,
  workspace
}: CustomerReplyPanelProps) {
  const state = useStore(store)
  const sync = useStore(customerDraftSyncFor(workspace))
  const [copyStatus, setCopyStatus] = useState<{ draft: string; text: string } | null>(null)
  const [recordingBusy, setRecordingBusy] = useState(false)
  const voiceInstance = useId()
  const busy = state.requestId !== null
  const memoryEdited = state.memoryDraft !== state.memoryNote

  async function copyDraft() {
    if ($enterprisePackageInstallFrozen.get()) {return}
    const draft = state.draft

    try {
      await navigator.clipboard.writeText(draft)

      if (!$enterprisePackageInstallFrozen.get() && store.get().draft === draft) {
        store.set({ ...store.get(), copiedDraft: draft })
        setCopyStatus({
          draft,
          text: `已复制「${customerLabel} · #${customerId.slice(-8)}」的回复，请回到企业微信核对客户后粘贴发送。`
        })
      }
    } catch {
      if (store.get().draft === draft) {
        setCopyStatus({ draft, text: '复制失败，请选中回复内容，按 Ctrl+C 手动复制。' })
      }
    }
  }

  return (
    <section aria-label={`${customerLabel}的回复`} className="hesc-customer-reply">
      <p className="hesc-muted-copy">
        当前客户：{customerLabel} · #{customerId.slice(-8)}
        。粘贴会话、生成并审核建议，再复制到企业微信发送；无需会话存档。
      </p>
      {ENTERPRISE_LEARNING_ENABLED ? <div className="hesc-agent-composer">
        <label htmlFor="customer-memory-note">此客户的参考记忆</label>
        <textarea
          id="customer-memory-note"
          maxLength={4000}
          onChange={event => updateCustomerMemoryDraft(store, event.target.value)}
          placeholder="只填写希望在此客户后续交流中参考的信息，核对后点击确认保存。"
          rows={3}
          value={state.memoryDraft}
        />
        <p className="hesc-muted-copy">仅本账号此客户可用，需手动确认保存。不是企业已审核知识；工作区 90 天未更新后清理。{state.memoryDraft.length}/4000</p>
        <div className="hesc-inline-actions">
          <Button disabled={!memoryEdited || state.memoryPending || !ready} onClick={() => void confirmCustomerMemory(workspace, store)} size="sm" variant="secondary">确认保存记忆</Button>
          <Button disabled={!memoryEdited} onClick={() => updateCustomerMemoryDraft(store, store.get().memoryNote)} size="sm" variant="text">恢复已确认内容</Button>
          <Button disabled={!state.memoryNote || state.memoryPending || !ready} onClick={() => void confirmCustomerMemory(workspace, store, true)} size="sm" variant="text">删除已确认记忆</Button>
        </div>
        <p aria-live="polite" className="hesc-muted-copy">
          {state.memoryPending
            ? ['error', 'conflict'].includes(sync.phase) ? '记忆尚未保存，请先处理上方保存提示。' : '正在等待服务器确认；此客户暂不能生成。'
            : memoryEdited ? '有未确认的记忆编辑；确认保存或恢复后可生成。'
              : state.memoryConfirmedAt ? '记忆已保存，仅作为此客户的参考资料。' : '尚无已确认记忆。'}
        </p>
      </div> : null}
      <form
        className="hesc-agent-composer"
        onSubmit={event => {
          event.preventDefault()
          setCopyStatus(null)

          if (runtime && ready) {
            if (recordingBusy) {return}
            void generateCustomerReply(workspace, store, runtime, configurationId, backendChoice, choiceProtocolSupported)
          }
        }}
      >
        <label htmlFor="customer-reply-context">客户会话上下文</label>
        <textarea
          disabled={busy}
          id="customer-reply-context"
          maxLength={24_000}
          onChange={event => updateCustomerReplyInput(store, 'context', event.target.value)}
          placeholder="粘贴当前客户的问题和必要的前文，建议标明“客户：”“坐席：”…"
          rows={6}
          value={state.context}
        />
        {!VOICE_INPUT_FROZEN ? <VoiceControls
          disabled={busy || !ready}
          key={`${voiceInstance}:${customerId}`}
          onBusyChange={setRecordingBusy}
          onTranscript={text => {
            const context = [store.get().context.trim(), text].filter(Boolean).join('\n')

            if (context.length > 24_000) {throw new Error('加入语音后会话超过 24000 个字符，请先精简当前上下文再录音。')}
            updateCustomerReplyInput(store, 'context', context)
          }}
          runtime={runtime}
          scope={`${voiceInstance}:${customerId}`}
        /> : null}
        <label htmlFor="customer-reply-instructions">补充要求（选填）</label>
        <textarea
          disabled={busy}
          id="customer-reply-instructions"
          maxLength={4_000}
          onChange={event => updateCustomerReplyInput(store, 'instructions', event.target.value)}
          placeholder="例如：语气简洁友好，先说明退换货条件，再告知下一步。"
          rows={2}
          value={state.instructions}
        />
        <div>
          <span>只使用当前客户上下文。其他客户的生成任务可在后台继续。</span>
          <Button
            disabled={!ready || !runtime?.post || busy || recordingBusy || (ENTERPRISE_LEARNING_ENABLED && (state.memoryPending || memoryEdited)) || !state.context.trim()}
            size="sm"
            type="submit"
          >
            {state.phase === 'queued' ? '排队等待生成' : busy ? '正在检索并生成' : '生成回复建议'}
          </Button>
        </div>
      </form>
      {state.error ? (
        <p className="hesc-error-copy" role="alert">
          {state.error} 已保留输入，可再次生成。
        </p>
      ) : null}
      {state.knowledgeGrounded === false ? (
        <p className="hesc-muted-copy" role="status">
          企业知识库中未找到足够依据，暂不生成客户回复。请补充相关知识资料或交由人工核实。
        </p>
      ) : null}
      <AssistantResponseDetails
        customerReplyOptions={state.customerReplyOptions}
        knowledgeTrace={state.knowledgeTrace}
        reasoningSummary={state.reasoningSummary}
      />
      {state.knowledgeGrounded === true ? (
        <div className="hesc-agent-composer">
          <label htmlFor="customer-reply-draft">待审核回复（可修改）</label>
          <textarea
            id="customer-reply-draft"
            maxLength={24_000}
            onChange={event => {
              if ($enterprisePackageInstallFrozen.get()) {return}
              store.set({ ...store.get(), draft: event.target.value, copiedDraft: null })
              setCopyStatus(null)
            }}
            rows={6}
            value={state.draft}
          />
          <div>
            <span>内部坐席参考。请确认内容允许对客披露，并核对事实、承诺和客户身份后发送。</span>
            <Button disabled={!state.draft.trim()} onClick={() => void copyDraft()} size="sm">
              复制当前客户回复
            </Button>
          </div>
          {copyStatus?.draft === state.draft ? (
            <p className="hesc-muted-copy" role="status">
              {copyStatus.text}
            </p>
          ) : null}
        </div>
      ) : null}
      {ENTERPRISE_LEARNING_ENABLED ? <CustomerReplyFeedback customerId={customerId} ready={ready} runtime={runtime} workspace={workspace} /> : null}
    </section>
  )
}
