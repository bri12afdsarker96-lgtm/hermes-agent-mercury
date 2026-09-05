import { useCallback, useEffect, useState } from 'react'

import type { EnterpriseClientRuntime } from './runtime'

interface ProviderCatalogItem {
  default_model?: string
  key?: string
  label?: string
}

interface TenantAiModel {
  base_url?: string
  configuration_id: string
  is_default: boolean
  model: string
  provider: string
}

interface TenantAiStatus {
  configured?: boolean
  default_model_id?: string | null
  encryption_ready?: boolean
  models?: TenantAiModel[]
  providers?: ProviderCatalogItem[]
}

function errorText(reason: unknown): string {
  return reason instanceof Error && reason.message ? reason.message : 'AI 配置服务暂时不可用。'
}

export function TenantAiConfigPanel({ runtime }: { runtime: EnterpriseClientRuntime | null }) {
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [model, setModel] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [provider, setProvider] = useState('')
  const [status, setStatus] = useState<TenantAiStatus | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const resetEditor = useCallback((nextStatus: TenantAiStatus | null) => {
    setEditingId(null)
    setApiKey('')
    setBaseUrl('')
    const first = nextStatus?.providers?.[0]
    setProvider(first?.key ?? '')
    setModel(first?.default_model ?? '')
  }, [])

  const load = useCallback(async () => {
    if (!runtime) {
      setStatus(null)
      return
    }
    const next = await runtime.get<TenantAiStatus>('/api/tenant-ai-config')
    setStatus(next)
    setProvider(current => current || next.providers?.[0]?.key || '')
    setModel(current => current || next.providers?.[0]?.default_model || '')
  }, [runtime])

  useEffect(() => {
    let active = true
    setError(null)
    void load().catch(reason => {
      if (active) {
        setStatus(null)
        setError(errorText(reason))
      }
    })
    return () => {
      active = false
    }
  }, [load])

  const save = useCallback(async () => {
    if (!runtime?.post || !provider || !model || submitting) {
      return
    }
    const submittedKey = apiKey
    setApiKey('')
    setSubmitting(true)
    setError(null)
    setNotice(null)
    try {
      const next = await runtime.post<TenantAiStatus>('/api/tenant-ai-config', {
        action: 'upsert_model',
        api_key: submittedKey || undefined,
        base_url: baseUrl || undefined,
        configuration_id: editingId ?? undefined,
        model,
        provider
      })
      setStatus(next)
      resetEditor(next)
      setNotice(editingId ? '模型配置已更新；未重新输入的密钥仍只保留在服务器。' : '新模型配置已加密保存到服务器。')
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setSubmitting(false)
    }
  }, [apiKey, baseUrl, editingId, model, provider, resetEditor, runtime, submitting])

  const setDefault = useCallback(async (configurationId: string) => {
    if (!runtime?.post || submitting) {
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const next = await runtime.post<TenantAiStatus>('/api/tenant-ai-config', {
        action: 'set_default', configuration_id: configurationId
      })
      setStatus(next)
      setNotice('企业默认模型已更新。未选择模型的坐席将从下一次请求开始使用它。')
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setSubmitting(false)
    }
  }, [runtime, submitting])

  const remove = useCallback(async (configurationId: string) => {
    if (!runtime?.post || submitting) {
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const next = await runtime.post<TenantAiStatus>('/api/tenant-ai-config', {
        action: 'remove_model', configuration_id: configurationId
      })
      setStatus(next)
      if (editingId === configurationId) {
        resetEditor(next)
      }
      setNotice('非默认模型配置已从本企业模型池移除。')
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setSubmitting(false)
    }
  }, [editingId, resetEditor, runtime, submitting])

  const edit = useCallback((entry: TenantAiModel) => {
    setEditingId(entry.configuration_id)
    setProvider(entry.provider)
    setModel(entry.model)
    setBaseUrl(entry.base_url ?? '')
    setApiKey('')
    setError(null)
    setNotice('正在更新该模型配置。留空密钥表示保留服务器中已有密钥。')
  }, [])

  const models = status?.models ?? []
  const catalog = status?.providers ?? []

  return (
    <article className="hesc-card hesc-tenant-ai-config" data-testid="tenant-ai-config-panel">
      <div className="hesc-section-heading">
        <div>
          <h2 className="hesc-section-title">企业 AI 模型与密钥</h2>
          <p className="hesc-muted-copy">可保存多个厂商和模型。密钥加密驻留服务器且永不回显；坐席可选择企业授权模型，未选时使用默认模型。</p>
        </div>
        <span className="hesc-status" data-tone={status?.configured ? 'success' : status?.encryption_ready === false ? 'error' : 'warning'}>
          {status?.configured ? `${models.length} 个已配置模型` : '尚未配置'}
        </span>
      </div>

      <div className="hesc-provisioning-form">
        <label>AI 厂商
          <select disabled={!runtime || submitting} onChange={event => {
            const next = event.target.value
            setProvider(next)
            const entry = catalog.find(item => item.key === next)
            if (!editingId && entry?.default_model) setModel(entry.default_model)
          }} value={provider}>
            <option value="">请选择厂商</option>
            {catalog.map(item => <option key={item.key} value={item.key}>{item.label ?? item.key}</option>)}
          </select>
        </label>
        <label>模型<input disabled={!runtime || submitting} onChange={event => setModel(event.target.value)} value={model} /></label>
        <label>Base URL（可选）<input disabled={!runtime || submitting} onChange={event => setBaseUrl(event.target.value)} placeholder="留空使用厂商默认地址" value={baseUrl} /></label>
        <label>API Key{editingId ? '（留空则保留原密钥）' : ''}
          <input autoComplete="off" disabled={!runtime || submitting} onChange={event => setApiKey(event.target.value)} placeholder="仅用于本次安全保存，不会回显" type="password" value={apiKey} />
        </label>
        <div className="hesc-inline-actions">
          <button className="hesc-action" disabled={!runtime || submitting || !provider || !model || (!editingId && !apiKey)} onClick={() => void save()} type="button">
            {editingId ? '更新模型配置' : '安全保存新模型'}
          </button>
          {editingId ? <button className="hesc-action hesc-action-secondary" disabled={submitting} onClick={() => resetEditor(status)} type="button">取消更新</button> : null}
        </div>
      </div>

      {notice ? <p className="hesc-success-copy" role="status">{notice}</p> : null}
      {error ? <div className="hesc-error" role="status"><div><strong>企业 AI 配置未完成</strong><span>{error}</span></div></div> : null}

      <div className="hesc-scroll-region hesc-tenant-model-list">
        <table className="hesc-table">
          <thead><tr><th scope="col">厂商</th><th scope="col">模型</th><th scope="col">默认</th><th scope="col">操作</th></tr></thead>
          <tbody>
            {models.map(entry => (
              <tr key={entry.configuration_id}>
                <td>{entry.provider}</td><td>{entry.model}</td><td>{entry.is_default ? '企业默认' : '—'}</td>
                <td><div className="hesc-inline-actions">
                  <button className="hesc-text-action" disabled={submitting} onClick={() => edit(entry)} type="button">更新</button>
                  <button className="hesc-text-action" disabled={submitting || entry.is_default} onClick={() => void setDefault(entry.configuration_id)} type="button">设为默认</button>
                  <button className="hesc-text-action" disabled={submitting || entry.is_default || models.length <= 1} onClick={() => void remove(entry.configuration_id)} type="button">删除</button>
                </div></td>
              </tr>
            ))}
            {models.length === 0 ? <tr><td colSpan={4}>尚无企业 AI 模型。保存第一项后它将自动成为默认模型。</td></tr> : null}
          </tbody>
        </table>
      </div>
    </article>
  )
}
