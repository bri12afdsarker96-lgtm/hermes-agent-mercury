import { useCallback, useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n/context'
import { customerServiceCopy } from '@/i18n/customer-service'
import { customerServiceLayoutCopy } from '@/i18n/customer-service-layout'
import { nativeUiCopy } from '@/i18n/native-ui'

import type {
  CustomerRule,
  CustomerRuleDraft,
  CustomerServiceRequest,
  CustomerServiceRulesSnapshot,
  CustomerServiceSnapshot
} from '../../electron/customer-service-types'
import type { ShopBrowserProfile } from '../../electron/shop-browser-types'

import { CustomerServiceWorkbench } from './customer-service-workbench'
import type { EnterpriseClientRuntime } from './runtime'
import { ShopBrowserRuntimeSettings } from './shop-browser-runtime'

const emptyDraft = (): CustomerRuleDraft => ({
  name: '',
  priority: 500,
  keywords: '',
  reply: '',
  enabled: true,
  matchType: 'keyword_any',
  cooldownSeconds: 0,
  stopProcessing: true,
  doNotInvite: false,
  transferHuman: false,
  processEvaluatedClaim: false
})

function editDraft(rule: CustomerRule): CustomerRuleDraft {
  const actions = JSON.parse(rule.ActionsJson) as { type: string }[]

  return {
    id: rule.id,
    name: rule.IntentName,
    priority: rule.SortOrder,
    keywords: rule.Keywords,
    reply: rule.ReplyText,
    enabled: rule.Enabled === 1,
    matchType: rule.MatchType,
    cooldownSeconds: rule.CooldownSeconds,
    stopProcessing: rule.StopProcessing,
    doNotInvite: actions.some(action => action.type === 'set_do_not_invite'),
    transferHuman: actions.some(action => action.type === 'transfer_human'),
    processEvaluatedClaim: actions.some(action => action.type === 'process_evaluated_claim')
  }
}

type PanelProps = {
  runtime: EnterpriseClientRuntime
  profileId: string
  view?: 'rules' | 'workbench'
  profiles?: ShopBrowserProfile[]
  onSelectProfile?: (id: string) => void
  onHandle?: () => void
  onRefresh?: () => void
}

export function CustomerServicePreviewPanel(props: PanelProps) {
  if (props.view === 'workbench') {
    return <CustomerServiceWorkbench {...props} profiles={props.profiles ?? []} />
  }

  return <CustomerServiceRulesPanel {...props} />
}

function CustomerServiceRulesPanel(props: PanelProps) {
  const [testing, setTesting] = useState(false)
  const {locale} = useI18n()
  const copy = customerServiceCopy[locale]

  return <>
    <CustomerServiceLocalPanel {...props} />
    <details onToggle={event => setTesting(event.currentTarget.open)}>
      <summary>{copy.ruleTest}</summary>
      {testing ? <><p>{copy.ruleTestHint}</p><CustomerServiceLocalPanel {...props} onHandle={undefined} view="workbench" /></> : null}
    </details>
  </>
}

function CustomerServiceLocalPanel({
  runtime,
  profileId,
  view = 'rules',
  profiles = [],
  onSelectProfile,
  onHandle
}: PanelProps) {
  const { locale } = useI18n()
  const copy = customerServiceCopy[locale]
  const layout = customerServiceLayoutCopy[locale]
  const native = nativeUiCopy[locale]
  const lifecycle = useMemo(() => ({ runtime, profileId, alive: true, busy: false }), [runtime, profileId])
  const [snapshot, setSnapshot] = useState<CustomerServiceSnapshot>()
  const [rulesSnapshot, setRulesSnapshot] = useState<CustomerServiceRulesSnapshot>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [draft, setDraft] = useState<CustomerRuleDraft>()
  const [priority, setPriority] = useState('0')
  const [cooldown, setCooldown] = useState('0')
  const [confirmation, setConfirmation] = useState<{ action: 'complete' | 'deleteRule'; id: string }>()
  const [conversationId, setConversationId] = useState('')
  const [messageId, setMessageId] = useState(() => `message-${Date.now()}`)
  const [content, setContent] = useState('')
  const [timestamp, setTimestamp] = useState(() => new Date().toISOString())
  const [reason, setReason] = useState('')
  const [composerOpen, setComposerOpen] = useState(false)
  const [shopSearch, setShopSearch] = useState('')
  const [shopScope, setShopScope] = useState('all')
  const [shopPendingCounts, setShopPendingCounts] = useState<Record<string, number>>({})
  const [conversationSearch, setConversationSearch] = useState('')
  const [actionsRule, setActionsRule] = useState<CustomerRule>()
  const [dismissedLoginWarnings, setDismissedLoginWarnings] = useState<string[]>([])

  const run = useCallback(
    async (request: Omit<CustomerServiceRequest, 'sessionId' | 'profileId'>) => {
      if (lifecycle.busy || !lifecycle.runtime.customerService) {
        return undefined
      }

      lifecycle.busy = true
      setBusy(true)
      setError('')
      setNotice('')

      try {
        const reply = await lifecycle.runtime.customerService({ ...request, profileId: lifecycle.profileId })

        if (!lifecycle.alive) {
          return undefined
        }

        if (!reply.ok || (view === 'rules' ? !reply.rulesSnapshot : !reply.snapshot)) {
          throw new Error(reply.error ?? 'CUSTOMER_FAILED')
        }

        if (view === 'rules') {
          setRulesSnapshot(reply.rulesSnapshot)
        } else {
          setSnapshot(reply.snapshot)
        }

        if (reply.duplicate) {
          setNotice(copy.duplicate)
        }

        return reply
      } catch (failure) {
        if (lifecycle.alive) {
          const code = failure instanceof Error ? failure.message : 'CUSTOMER_FAILED'

          if (/^(CUSTOMER_(OWNER_CHANGED|FORBIDDEN|PROFILE_NOT_FOUND)|SHOP_PROFILE_|REVOKED)/.test(code)) {
            setSnapshot(undefined)
            setRulesSnapshot(undefined)
            setDraft(undefined)
            setConfirmation(undefined)
          }

          setError(code)
        }

        return undefined
      } finally {
        lifecycle.busy = false

        if (lifecycle.alive) {
          setBusy(false)
        }
      }
    },
    [lifecycle, copy.duplicate, view]
  )

  useEffect(() => {
    lifecycle.alive = true
    setSnapshot(undefined)
    setRulesSnapshot(undefined)
    setDraft(undefined)
    setConfirmation(undefined)
    void run({ action: view === 'rules' ? 'rulesSnapshot' : 'snapshot' })

    const timer = setInterval(() => {
      if (!lifecycle.busy) {
        void run({ action: view === 'rules' ? 'rulesSnapshot' : 'snapshot' })
      }
    }, 10000)

    return () => {
      lifecycle.alive = false
      clearInterval(timer)
    }
  }, [lifecycle, run, view])

  useEffect(() => {
    if (view !== 'workbench' || !runtime.customerService) {
      return
    }

    let alive = true
    setShopPendingCounts({})
    void Promise.all(
      profiles
        .filter(profile => profile.id !== profileId)
        .map(async profile => {
          try {
            const reply = await runtime.customerService!({ action: 'snapshot', profileId: profile.id })

            return reply.ok && reply.snapshot
              ? ([profile.id, reply.snapshot.tasks.filter(task => task.status === 'pending').length] as const)
              : undefined
          } catch {
            return undefined
          }
        })
    ).then(results => {
      if (alive && lifecycle.alive) {
        setShopPendingCounts(Object.fromEntries(results.filter(result => result !== undefined)))
      }
    })

    return () => {
      alive = false
    }
  }, [lifecycle, profileId, profiles, runtime, view])

  const beginEdit = (rule?: CustomerRule) => {
    const next = rule ? editDraft(rule) : emptyDraft()
    setDraft(next)
    setPriority(String(next.priority))
    setCooldown(String(next.cooldownSeconds))
  }

  const mutate = (request: Omit<CustomerServiceRequest, 'sessionId' | 'profileId'>) =>
    run({ ...request, expectedRevision: view === 'rules' ? rulesSnapshot?.revision : snapshot?.revision,
      ...(view === 'rules' ? {rulesOnly:true} : {}) })

  const save = async () => {
    if (!draft) {
      return
    }

    if (!/^[+-]?[0-9]+$/.test(priority.trim()) || !/^[+-]?[0-9]+$/.test(cooldown.trim())) {
      setError('CUSTOMER_RULE_INVALID')

      return
    }

    const result = await mutate({
      action: 'saveRule',
      rule: { ...draft, priority: Number(priority), cooldownSeconds: Number(cooldown) }
    })

    if (result) {
      setDraft(undefined)
    }
  }

  const confirm = async () => {
    if (!confirmation) {
      return
    }

    const result = await mutate(
      confirmation.action === 'complete'
        ? { action: 'complete', taskId: confirmation.id }
        : { action: 'deleteRule', ruleId: confirmation.id }
    )

    if (result) {
      setConfirmation(undefined)
    }
  }

  if (!runtime.customerService) {
    return <p>{copy.noTransport}</p>
  }

  const conversation = snapshot?.conversations.find(item => item.id === conversationId)

  const actionSummary = (rule: CustomerRule) =>
    (JSON.parse(rule.ActionsJson) as { type: string }[])
      .map(
        action =>
          ({
            send_message: copy.reply,
            transfer_human: copy.transfer,
            set_do_not_invite: copy.doNotInvite,
            process_evaluated_claim: copy.claim
          })[action.type]
      )
      .filter(Boolean)
      .join(' + ')

  const selectedTask = snapshot?.tasks.find(task => task.conversationId === conversationId && task.status === 'pending')

  const pendingCount = (id: string) =>
    id === profileId ? snapshot?.tasks.filter(task => task.status === 'pending').length : shopPendingCounts[id]

  const chatEvents =
    snapshot?.events
      .filter(
        event => event.conversationId === conversationId && ['incoming_message', 'send_message'].includes(event.action)
      )
      .slice()
      .reverse() ?? []

  const simulate = async () => {
    const result = await mutate({
      action: 'simulate',
      message: { conversationId, messageId, text: content, timestampMs: timestamp.trim() ? Date.parse(timestamp) : NaN }
    })

    if (result) {
      setComposerOpen(false)
    }
  }

  return (
    <section aria-label={copy.title} className="cs-service" data-testid="customer-service-preview" data-view={view}>
      {view === 'workbench' ? (
        <div className="cs-toolbar cs-service-toolbar">
          <i className="cs-status-dot" />
          <span role="status">{copy.rehearsal}</span>
          <span className="cs-muted">{snapshot?.profile.shopName || snapshot?.profile.displayName}</span>
          <ShopBrowserRuntimeSettings runtime={runtime} />
          <Button disabled={busy} onClick={() => void run({ action: 'snapshot' })} variant="secondary">
            {copy.refresh}
          </Button>
          {snapshot && view === 'workbench' ? (
            <Button
              disabled={busy}
              onClick={() => {
                setMessageId(`message-${Date.now()}`)
                setTimestamp(new Date().toISOString())
                setComposerOpen(true)
              }}
            >
              {copy.simulate}
            </Button>
          ) : null}
          {busy ? <span>{copy.busy}</span> : null}
        </div>
      ) : null}
      {error ? (
        <p className="cs-error" role="alert">
          {error === 'CUSTOMER_RULE_INVALID' ? copy.invalid : copy.failed} ({error})
        </p>
      ) : null}
      {notice ? (
        <p className="cs-notice" role="status">
          {notice}
        </p>
      ) : null}
      {rulesSnapshot && view === 'rules' ? (
        <div className="cs-native-page cs-rule-page">
          <h2>{copy.rules}</h2>
          <div className="cs-toolbar">
            <Button disabled={busy} onClick={() => beginEdit()}>
              {copy.newRule}
            </Button>
            <span className="cs-muted">{copy.ruleLocal}</span>
            <Button disabled={busy} onClick={() => void run({ action: 'rulesSnapshot' })} variant="secondary">
              {copy.refresh}
            </Button>
          </div>
          <div className="cs-table-wrap">
            <table className="cs-table cs-rules-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>{copy.name}</th>
                  <th>{copy.priority}</th>
                  <th>{native.enabled}</th>
                  <th>{native.actions}</th>
                  <th>{copy.keywords}</th>
                  <th>{layout.operations}</th>
                </tr>
              </thead>
              <tbody>
                {rulesSnapshot.rules.map((rule, index) => (
                  <tr key={rule.id}>
                    <td>{index + 1}</td>
                    <td>{rule.IntentName}</td>
                    <td>{rule.SortOrder}</td>
                    <td>
                      <span className={rule.Enabled ? 'cs-badge is-verified' : 'cs-badge'}>
                        {rule.Enabled ? '✓' : '—'}
                      </span>
                    </td>
                    <td>
                      <button
                        aria-label={`${layout.ruleDetails} · ${rule.IntentName}`}
                        className="cs-link"
                        onClick={() => setActionsRule(rule)}
                        type="button"
                      >
                        {actionSummary(rule)}
                      </button>
                    </td>
                    <td>{rule.Keywords || '—'}</td>
                    <td>
                      <div className="cs-actions">
                        <Button
                          data-native-tone="amber"
                          disabled={busy}
                          onClick={() => beginEdit(rule)}
                          variant="secondary"
                        >
                          {copy.edit}
                        </Button>
                        <Button
                          data-native-tone="danger"
                          disabled={busy}
                          onClick={() => setConfirmation({ action: 'deleteRule', id: rule.id })}
                          variant="secondary"
                        >
                          {native.remove}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!rulesSnapshot.rules.length ? <p className="cs-empty">{copy.emptyRules}</p> : null}
          </div>
        </div>
      ) : null}
      {snapshot && view === 'workbench' ? (
        <div className="cs-work-columns">
          <section className="cs-column">
            <div className="cs-column-head cs-shop-search">
              <select
                aria-label={native.shopFilter}
                onChange={event => setShopScope(event.target.value)}
                value={shopScope}
              >
                <option value="pending">{layout.pendingOnly}</option>
                <option value="all">{layout.all}</option>
              </select>
              <Input
                aria-label={layout.searchShops}
                onChange={event => setShopSearch(event.target.value)}
                placeholder={layout.searchShops}
                value={shopSearch}
              />
            </div>
            <div className="cs-scroll">
              {profiles
                .filter(
                  profile =>
                    (shopScope === 'all' || (pendingCount(profile.id) ?? 0) > 0) &&
                    `${profile.shopName ?? ''} ${profile.displayName} ${profile.shopId ?? ''}`
                      .toLowerCase()
                      .includes(shopSearch.toLowerCase())
                )
                .map(profile => (
                  <button
                    className="cs-list-row cs-work-shop"
                    data-active={profile.id === profileId}
                    disabled={busy}
                    key={profile.id}
                    onClick={() => onSelectProfile?.(profile.id)}
                    type="button"
                  >
                    <span>{profile.shopName || profile.displayName}</span>
                    <span
                      aria-label={pendingCount(profile.id) === undefined ? native.unknownCount : copy.tasks}
                      className="cs-count"
                    >
                      {pendingCount(profile.id) ?? '—'}
                    </span>
                    <span className={profile.id === profileId ? 'cs-green' : 'cs-muted'}>
                      <i className="cs-status-dot" />
                      {profile.id === profileId ? copy.rehearsal : native.loginProfiles}
                    </span>
                  </button>
                ))}
            </div>
          </section>
          <section aria-label={copy.tasks} className="cs-column">
            <div className="cs-column-head">
              <h4>{layout.nativePending}</h4>
              <span className="cs-muted">{snapshot.tasks.filter(task => task.status === 'pending').length}</span>
            </div>
            <Input
              aria-label={layout.searchConversations}
              onChange={event => setConversationSearch(event.target.value)}
              placeholder={layout.searchConversations}
              value={conversationSearch}
            />
            <div className="cs-scroll">
              {snapshot.conversations
                .filter(item => item.id.toLowerCase().includes(conversationSearch.toLowerCase()))
                .map(item => {
                  const task = snapshot.tasks.find(task => task.conversationId === item.id && task.status === 'pending')

                  return (
                    <button
                      className="cs-list-row"
                      data-active={item.id === conversationId}
                      key={item.id}
                      onClick={() => setConversationId(item.id)}
                      type="button"
                    >
                      <span>{item.id}</span>
                      <small>{copy[item.mode]}</small>
                      {task ? <small className="cs-amber">{task.seen ? copy.read : copy.unread}</small> : null}
                    </button>
                  )
                })}
              {!snapshot.conversations.length ? <p className="cs-empty">{copy.emptyTasks}</p> : null}
            </div>
          </section>
          <section className="cs-column cs-chat">
            <div className="cs-column-head">
              <h4>{layout.chat}</h4>
              <div className="cs-actions">
                <Button disabled={busy || !selectedTask || !onHandle} onClick={onHandle} variant="secondary">
                  {layout.handle}
                </Button>
                <Button
                  disabled={busy || !selectedTask}
                  onClick={() => selectedTask && setConfirmation({ action: 'complete', id: selectedTask.id })}
                  variant="secondary"
                >
                  {copy.complete}
                </Button>
              </div>
            </div>
            {conversation ? (
              <div className="cs-chat-meta">
                <strong>{conversationId}</strong>
                {conversation ? <span role="status">{copy[conversation.mode]}</span> : null}
                {selectedTask ? (
                  <Button
                    disabled={busy || selectedTask.seen}
                    onClick={() => void mutate({ action: 'seen', taskId: selectedTask.id })}
                    variant="secondary"
                  >
                    {copy.seen}
                  </Button>
                ) : null}
              </div>
            ) : null}
            <div aria-label={layout.simulatedChat} className="cs-chat-history">
              {chatEvents.map(event => (
                <div className={event.action === 'send_message' ? 'cs-bubble cs-outgoing' : 'cs-bubble'} key={event.id}>
                  <p>{event.detail}</p>
                  <time>{new Date(event.at).toLocaleString(locale)}</time>
                </div>
              ))}
              {!chatEvents.length ? <p className="cs-empty">{layout.chooseConversation}</p> : null}
            </div>
            {conversation?.mode === 'waiting_resume' ? (
              <div className="cs-resume">
                <label>
                  {copy.reason}
                  <Input
                    aria-label={copy.reason}
                    disabled={busy}
                    onChange={event => setReason(event.target.value)}
                    value={reason}
                  />
                </label>
                <Button
                  disabled={busy || !reason.trim()}
                  onClick={() => void mutate({ action: 'resume', conversationId, reason })}
                >
                  {copy.resume}
                </Button>
              </div>
            ) : null}
          </section>
          <section className="cs-column cs-activity">
            <div className="cs-column-head">
              <h4 className="cs-red">{layout.loginLog}</h4>
              <Button
                disabled={
                  busy ||
                  !profiles.some(
                    profile =>
                      profile.loginState === 'expired' &&
                      !dismissedLoginWarnings.includes(`${profile.id}:${profile.checkedAt}`)
                  )
                }
                onClick={() =>
                  setDismissedLoginWarnings(
                    profiles
                      .filter(profile => profile.loginState === 'expired')
                      .map(profile => `${profile.id}:${profile.checkedAt}`)
                  )
                }
                variant="secondary"
              >
                {native.clear}
              </Button>
            </div>
            <div className="cs-login-log">
              {profiles
                .filter(
                  profile =>
                    profile.loginState === 'expired' &&
                    !dismissedLoginWarnings.includes(`${profile.id}:${profile.checkedAt}`)
                )
                .map(profile => (
                  <p key={profile.id}>
                    [{profile.checkedAt ? new Date(profile.checkedAt).toLocaleString(locale) : '—'}]{' '}
                    {profile.shopName || profile.displayName} · {layout.loginLog}
                  </p>
                ))}
              {!profiles.some(
                profile =>
                  profile.loginState === 'expired' &&
                  !dismissedLoginWarnings.includes(`${profile.id}:${profile.checkedAt}`)
              ) ? (
                <p className="cs-muted">{layout.noLoginIssues}</p>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
      {snapshot && view === 'workbench' ? (
        <details className="cs-work-history">
          <summary>{native.history}</summary>
          <ol className="cs-event-list">
            {snapshot.events.map(event => (
              <li key={event.id}>
                <time>{new Date(event.at).toLocaleTimeString(locale)}</time> · <code>{event.action}</code>
                <p>{event.detail}</p>
                {event.payoutSettings ? (
                  <pre className="cs-action-json">{JSON.stringify(event.payoutSettings, null, 2)}</pre>
                ) : null}
              </li>
            ))}
          </ol>
        </details>
      ) : null}
      <Dialog
        onOpenChange={open => {
          if (!busy) {
            setComposerOpen(open)
          }
        }}
        open={composerOpen && !!snapshot}
      >
        <DialogContent bodyClassName="cs-dialog-body" className="cs-native-dialog">
          <DialogTitle>{layout.messageDialog}</DialogTitle>
          <DialogDescription>{copy.ruleTestHint}</DialogDescription>
          {error ? (
            <p className="cs-error" role="alert">
              {copy.failed} ({error})
            </p>
          ) : null}
          <form
            className="cs-message-form"
            onSubmit={event => {
              event.preventDefault()
              void simulate()
            }}
          >
            <label>
              {copy.conversation}
              <Input
                aria-label={copy.conversation}
                disabled={busy}
                onChange={event => setConversationId(event.target.value)}
                value={conversationId}
              />
            </label>
            <label>
              {copy.message}
              <Input
                aria-label={copy.message}
                disabled={busy}
                onChange={event => setMessageId(event.target.value)}
                value={messageId}
              />
            </label>
            <label>
              {copy.timestamp}
              <Input
                aria-label={copy.timestamp}
                disabled={busy}
                onChange={event => setTimestamp(event.target.value)}
                value={timestamp}
              />
            </label>
            <label>
              {copy.content}
              <textarea
                aria-label={copy.content}
                disabled={busy}
                onChange={event => setContent(event.target.value)}
                value={content}
              />
            </label>
            <div className="cs-dialog-actions">
              <Button disabled={busy} onClick={() => setComposerOpen(false)} type="button" variant="secondary">
                {copy.cancel}
              </Button>
              <Button disabled={busy || !content.trim() || !messageId.trim() || !conversationId.trim()} type="submit">
                {copy.run}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        onOpenChange={open => {
          if (!open) {
            setActionsRule(undefined)
          }
        }}
        open={!!actionsRule}
      >
        <DialogContent bodyClassName="cs-dialog-body" className="cs-native-dialog">
          <DialogTitle>{copy.actions}</DialogTitle>
          <DialogDescription>{copy.actions}</DialogDescription>
          <pre className="cs-action-json">
            {actionsRule ? JSON.stringify(JSON.parse(actionsRule.ActionsJson), null, 2) : ''}
          </pre>
        </DialogContent>
      </Dialog>
      <Dialog
        onOpenChange={open => {
          if (!open && !busy) {
            setDraft(undefined)
          }
        }}
        open={!!draft}
      >
        <DialogContent
          bodyClassName="cs-dialog-body"
          className="cs-native-dialog cs-rule-dialog"
          showCloseButton={false}
        >
          <DialogTitle>{draft?.id ? native.editRule : copy.newRule}</DialogTitle>
          <DialogDescription className="sr-only">{copy.ruleLocal}</DialogDescription>
          {error ? (
            <p role="alert">
              {error === 'CUSTOMER_RULE_INVALID' ? copy.invalid : copy.failed} ({error})
            </p>
          ) : null}
          {draft ? (
            <form
              className="cs-rule-form"
              onSubmit={event => {
                event.preventDefault()
                void save()
              }}
            >
              <label className="block">
                {copy.name}
                <span aria-hidden="true"> *</span>
                <Input
                  aria-label={copy.name}
                  disabled={busy}
                  onChange={event => setDraft({ ...draft, name: event.target.value })}
                  required
                  value={draft.name}
                />
              </label>
              <div className="cs-rule-numbers">
                <label>
                  {native.priority}
                  <Input
                    aria-label={copy.priority}
                    disabled={busy}
                    inputMode="numeric"
                    onChange={event => setPriority(event.target.value)}
                    value={priority}
                  />
                </label>
                <label>
                  {copy.cooldown}
                  <Input
                    aria-label={copy.cooldown}
                    disabled={busy}
                    inputMode="numeric"
                    onChange={event => setCooldown(event.target.value)}
                    value={cooldown}
                  />
                </label>
              </div>
              <div className="cs-rule-flags">
                {(['enabled', 'stopProcessing'] as const).map((field, index) => (
                  <label key={field}>
                    <input
                      aria-label={[copy.enabled, copy.stop][index]}
                      checked={draft[field]}
                      disabled={busy}
                      onChange={event => setDraft({ ...draft, [field]: event.target.checked })}
                      type="checkbox"
                    />
                    {[native.enabled, native.stop][index]}
                  </label>
                ))}
              </div>
              <label className="cs-rule-match">
                {copy.match}
                <select
                  aria-label={copy.match}
                  disabled={busy}
                  onChange={event =>
                    setDraft({ ...draft, matchType: event.target.value as CustomerRuleDraft['matchType'] })
                  }
                  value={draft.matchType}
                >
                  <option value="keyword_any">{native.keywordAny}</option>
                  <option value="exact_match">{copy.exact}</option>
                </select>
              </label>
              <label className="block">
                {native.keywords}
                <textarea
                  aria-label={copy.keywords}
                  className="min-h-16 w-full rounded-md border border-(--ui-stroke-tertiary) bg-transparent p-2"
                  disabled={busy}
                  onChange={event => setDraft({ ...draft, keywords: event.target.value })}
                  value={draft.keywords}
                />
              </label>
              <label className="block">
                {native.reply}
                <span aria-hidden="true"> *</span>
                <small className="cs-rule-reply-hint">{native.replyHint}</small>
                <textarea
                  aria-label={copy.reply}
                  className="min-h-20 w-full rounded-md border border-(--ui-stroke-tertiary) bg-transparent p-2"
                  disabled={busy}
                  onChange={event => setDraft({ ...draft, reply: event.target.value })}
                  required
                  value={draft.reply}
                />
              </label>
              <h3>{native.additionalActions}</h3>
              <div className="cs-rule-additional">
                {(['transferHuman', 'doNotInvite', 'processEvaluatedClaim'] as const).map((field, index) => (
                  <label className="flex items-center gap-2" key={field}>
                    <input
                      aria-label={[copy.transfer, copy.doNotInvite, copy.claim][index]}
                      checked={draft[field]}
                      disabled={busy}
                      onChange={event => setDraft({ ...draft, [field]: event.target.checked })}
                      type="checkbox"
                    />
                    {[copy.transfer, native.doNotInvite, native.claim][index]}
                  </label>
                ))}
              </div>
              <div className="cs-dialog-actions">
                <Button disabled={busy} onClick={() => setDraft(undefined)} type="button" variant="secondary">
                  {copy.cancel}
                </Button>
                <Button aria-label={copy.save} disabled={busy} type="submit">
                  {native.save}
                </Button>
              </div>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
      <Dialog
        onOpenChange={open => {
          if (!open && !busy) {
            setConfirmation(undefined)
          }
        }}
        open={!!confirmation}
      >
        <DialogContent bodyClassName="cs-dialog-body" className="cs-native-dialog">
          <DialogTitle>{confirmation?.action === 'complete' ? copy.confirm : copy.deleteConfirm}</DialogTitle>
          <DialogDescription>
            {confirmation?.action === 'complete' ? copy.completeDescription : copy.remove}
          </DialogDescription>
          <div className="flex gap-2">
            <Button disabled={busy} onClick={() => void confirm()}>
              {confirmation?.action === 'complete' ? copy.confirm : copy.deleteConfirm}
            </Button>
            <Button disabled={busy} onClick={() => setConfirmation(undefined)} variant="secondary">
              {copy.cancel}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}
