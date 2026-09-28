import { useCallback, useEffect, useState } from 'react'

import type { EnterpriseClientRuntime } from './runtime'

interface BotReminderStatus {
  bot_webhook_configured?: boolean
  direct_reminder_configured?: boolean
  encryption_ready?: boolean
}

interface WeComAppStatus {
  configured?: boolean
  app_config_ref?: string
  encryption_ready?: boolean
}

interface WeComAppForm {
  app_config_ref: string
  corp_id: string
  corp_secret: string
  agent_id: string
  token: string
  encoding_aes_key: string
}

const EMPTY_APP_FORM: WeComAppForm = {
  app_config_ref: '', corp_id: '', corp_secret: '', agent_id: '', token: '', encoding_aes_key: ''
}

function errorText(reason: unknown): string {
  return reason instanceof Error && reason.message ? reason.message : '企业微信提醒配置暂时不可用。'
}

/** Tenant-admin-only configuration for the outbound reminder bot.
 * The renderer never reads back or retains the webhook after the save call. */
export function WeComReminderPanel({ runtime }: { runtime: EnterpriseClientRuntime | null }) {
  const [status, setStatus] = useState<BotReminderStatus | null>(null)
  const [appStatus, setAppStatus] = useState<WeComAppStatus | null>(null)
  const [webhookUrl, setWebhookUrl] = useState('')
  const [appForm, setAppForm] = useState<WeComAppForm>(EMPTY_APP_FORM)
  const [busy, setBusy] = useState(false)
  const [appBusy, setAppBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!runtime) {
      setStatus(null)
      setAppStatus(null)
      return
    }
    const [bot, app] = await Promise.all([
      runtime.get<BotReminderStatus>('/api/wecom-bot-reminder'),
      runtime.get<WeComAppStatus>('/api/wecom-config')
    ])
    setStatus(bot)
    setAppStatus(app)
  }, [runtime])

  useEffect(() => {
    let active = true
    setError(null)
    void load().catch(reason => {
      if (active) {setError(errorText(reason))}
    })
    return () => {active = false}
  }, [load])

  const save = useCallback(async () => {
    if (!runtime?.post || busy || !webhookUrl.trim()) {return}
    const value = webhookUrl.trim()
    setBusy(true)
    setError(null)
    setNotice(null)
    // Clear promptly: a rerender, crash report, or later interaction must not
    // retain the webhook key in renderer state.
    setWebhookUrl('')
    try {
      const next = await runtime.post<BotReminderStatus>('/api/wecom-bot-reminder', {bot_webhook_url: value})
      setStatus(next)
      setNotice('企业微信提醒机器人已加密保存。到期提醒仍由服务器调度，客户端会同时弹出提示。')
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }, [busy, runtime, webhookUrl])

  const saveDirectApp = useCallback(async () => {
    if (!runtime?.post || appBusy || Object.values(appForm).some(value => !value.trim())) {return}
    const value = {...appForm}
    setAppBusy(true)
    setError(null)
    setNotice(null)
    // CorpSecret, callback Token and EncodingAESKey must not survive the save
    // request in the renderer, snapshots, or a later screen interaction.
    setAppForm(EMPTY_APP_FORM)
    try {
      const next = await runtime.post<WeComAppStatus>('/api/wecom-config', value)
      setAppStatus(next)
      setNotice('企业微信自建应用已加密保存。成员绑定自己的企业微信后，谁创建提醒谁会收到企业微信私信。')
      await load()
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setAppBusy(false)
    }
  }, [appBusy, appForm, load, runtime])

  return <article className="hesc-card" data-testid="wecom-reminder-panel">
    <div className="hesc-section-heading">
      <div>
        <h2 className="hesc-section-title">企业微信到期提醒</h2>
        <p className="hesc-muted-copy">服务器到期时会保留网页和客户端提醒；群机器人可同步群通知。配置自建应用并由成员完成本人绑定后，系统会依据创建该提醒的成员向其企业微信单独发送，不会把 Webhook 或密钥回显到客户端。</p>
      </div>
      <span className="hesc-status" data-tone={status?.bot_webhook_configured ? 'success' : status?.encryption_ready === false ? 'error' : 'warning'}>
        {status?.bot_webhook_configured ? '已配置' : '未配置'}
      </span>
    </div>
    <label className="hesc-provisioning-form">机器人 Webhook
      <input autoComplete="off" disabled={!runtime || busy} onChange={event => setWebhookUrl(event.target.value)} placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…" type="password" value={webhookUrl} />
    </label>
    <div className="hesc-inline-actions">
      <button className="hesc-action" disabled={!runtime || busy || !webhookUrl.trim()} onClick={() => void save()} type="button">
        {busy ? '正在安全保存…' : status?.bot_webhook_configured ? '更新提醒机器人' : '保存提醒机器人'}
      </button>
      <button className="hesc-action hesc-action-secondary" disabled={busy} onClick={() => void load()} type="button">刷新状态</button>
    </div>
    <div className="hesc-divider" />
    <div className="hesc-section-heading">
      <div>
        <h3 className="hesc-section-title">按创建成员直达提醒</h3>
        <p className="hesc-muted-copy">使用企业微信自建应用，而非群 Webhook。谁创建提醒，谁在“提醒中心”绑定自己的企业微信一次后接收该提醒。</p>
      </div>
      <span className="hesc-status" data-tone={status?.direct_reminder_configured ? 'success' : appStatus?.encryption_ready === false ? 'error' : 'warning'}>
        {status?.direct_reminder_configured ? '已就绪' : '未配置'}
      </span>
    </div>
    <div className="hesc-provisioning-form">
      <label>应用标识
        <input autoComplete="off" disabled={!runtime || appBusy} onChange={event => setAppForm(current => ({...current, app_config_ref: event.target.value}))} placeholder="例如：enterprise-reminder" value={appForm.app_config_ref} />
      </label>
      <label>企业 CorpId
        <input autoComplete="off" disabled={!runtime || appBusy} onChange={event => setAppForm(current => ({...current, corp_id: event.target.value}))} value={appForm.corp_id} />
      </label>
      <label>应用 Secret
        <input autoComplete="new-password" disabled={!runtime || appBusy} onChange={event => setAppForm(current => ({...current, corp_secret: event.target.value}))} type="password" value={appForm.corp_secret} />
      </label>
      <label>AgentId
        <input autoComplete="off" disabled={!runtime || appBusy} onChange={event => setAppForm(current => ({...current, agent_id: event.target.value}))} value={appForm.agent_id} />
      </label>
      <label>回调 Token
        <input autoComplete="new-password" disabled={!runtime || appBusy} onChange={event => setAppForm(current => ({...current, token: event.target.value}))} type="password" value={appForm.token} />
      </label>
      <label>EncodingAESKey
        <input autoComplete="new-password" disabled={!runtime || appBusy} onChange={event => setAppForm(current => ({...current, encoding_aes_key: event.target.value}))} type="password" value={appForm.encoding_aes_key} />
      </label>
    </div>
    <div className="hesc-inline-actions">
      <button className="hesc-action" disabled={!runtime || appBusy || Object.values(appForm).some(value => !value.trim())} onClick={() => void saveDirectApp()} type="button">
        {appBusy ? '正在安全保存…' : appStatus?.configured ? '更新直达提醒应用' : '保存直达提醒应用'}
      </button>
      {appStatus?.configured ? <span className="hesc-muted-copy">当前应用：{appStatus.app_config_ref ?? '已配置'}</span> : null}
    </div>
    {notice ? <p className="hesc-success-copy" role="status">{notice}</p> : null}
    {error ? <div className="hesc-error" role="status"><div><strong>提醒机器人未保存</strong><span>{error}</span></div></div> : null}
  </article>
}
