import { useStore } from '@nanostores/react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'

import {
  addCustomerReply,
  closeCustomerReply,
  type CustomerReplyCustomer,
  type CustomerReplyStore,
  type CustomerReplyWorkspaceStore,
  generateCustomerReply,
  updateCustomerReplyInput
} from './customer-reply'
import type { EnterpriseClientRuntime } from './runtime'

interface CustomerReplyPanelProps {
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
    <button aria-pressed={active} className="hesc-customer-tab" onClick={onSelect} title={customer.label} type="button">
      <strong>{customer.label || '未命名客户'}</strong>
      <span>
        #{customer.id.slice(-8)} · {status}
      </span>
    </button>
  )
}

export function CustomerReplyWorkspace({ configurationId, ready, runtime, workspace }: CustomerReplyWorkspaceProps) {
  const state = useStore(workspace)
  const [search, setSearch] = useState('')
  const active = state.customers.find(customer => customer.id === state.activeId) ?? state.customers[0]
  const query = search.trim().toLocaleLowerCase()

  const matches = state.customers.filter(customer =>
    `${customer.label} ${customer.id}`.toLocaleLowerCase().includes(query)
  )

  return (
    <article aria-label="客户回复工作区" className="hesc-card hesc-customer-reply-workspace">
      <div className="hesc-section-heading">
        <div>
          <h2 className="hesc-section-title">客户回复建议</h2>
          <p className="hesc-muted-copy">每位客户独立保存上下文和草稿，同时生成最多 3 个，其余自动排队。</p>
        </div>
        <Button
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
      <div className="hesc-customer-workbench">
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
                onSelect={() => workspace.set({ ...workspace.get(), activeId: customer.id })}
              />
            ))}
            {matches.length === 0 ? <p className="hesc-muted-copy">未找到客户。清除搜索可查看全部。</p> : null}
          </div>
          <p className="hesc-muted-copy">备注可以同名，以编号区分。离开页面保留；退出登录或重启客户端后清空。</p>
        </aside>
        <div className="hesc-customer-detail">
          <div className="hesc-customer-identity">
            <label htmlFor="customer-reply-label">客户备注（仅用于区分工作区）</label>
            <input
              id="customer-reply-label"
              maxLength={80}
              onChange={event => {
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
      </div>
    </article>
  )
}

function CustomerReplyPanel({
  configurationId,
  customerId,
  customerLabel,
  ready,
  runtime,
  store,
  workspace
}: CustomerReplyPanelProps) {
  const state = useStore(store)
  const [copyStatus, setCopyStatus] = useState<{ draft: string; text: string } | null>(null)
  const busy = state.requestId !== null

  async function copyDraft() {
    const draft = state.draft

    try {
      await navigator.clipboard.writeText(draft)

      if (store.get().draft === draft) {
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
      <form
        className="hesc-agent-composer"
        onSubmit={event => {
          event.preventDefault()
          setCopyStatus(null)

          if (runtime && ready) {
            void generateCustomerReply(workspace, store, runtime, configurationId)
          }
        }}
      >
        <label htmlFor="customer-reply-context">客户会话上下文</label>
        <textarea
          disabled={busy}
          id="customer-reply-context"
          onChange={event => updateCustomerReplyInput(store, 'context', event.target.value)}
          placeholder="粘贴当前客户的问题和必要的前文，建议标明“客户：”“坐席：”…"
          rows={6}
          value={state.context}
        />
        <label htmlFor="customer-reply-instructions">补充要求（选填）</label>
        <textarea
          disabled={busy}
          id="customer-reply-instructions"
          onChange={event => updateCustomerReplyInput(store, 'instructions', event.target.value)}
          placeholder="例如：语气简洁友好，先说明退换货条件，再告知下一步。"
          rows={2}
          value={state.instructions}
        />
        <div>
          <span>只使用当前客户上下文。其他客户的生成任务可在后台继续。</span>
          <Button disabled={!ready || !runtime?.post || busy || !state.context.trim()} size="sm" type="submit">
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
      {state.knowledgeGrounded === true ? (
        <div className="hesc-agent-composer">
          <label htmlFor="customer-reply-draft">待审核回复（可修改）</label>
          <textarea
            id="customer-reply-draft"
            onChange={event => {
              store.set({ ...store.get(), draft: event.target.value, copiedDraft: null })
              setCopyStatus(null)
            }}
            rows={6}
            value={state.draft}
          />
          <div>
            <span>已检索企业知识。请核对事实、承诺和客户身份后发送。</span>
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
    </section>
  )
}
