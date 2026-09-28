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

interface TenantEmbeddingStatus {
  base_url?: string
  configured?: boolean
  dimension?: number
  encryption_ready?: boolean
  model?: string
  model_change_requires_reindex?: boolean
  profiles?: TenantEmbeddingProfile[]
  provider?: string
  provider_label?: string
  providers?: TenantEmbeddingProvider[]
  reindex_error?: string
  reindex_required?: boolean
  reindex_started_ts?: number | null
  reindex_state?: 'failed' | 'interrupted' | 'ready' | 'running'
}

interface TenantEmbeddingProvider {
  default_base_url?: string
  default_model?: string
  key?: string
  label?: string
}

interface TenantEmbeddingProfile {
  base_url?: string
  configured?: boolean
  model?: string
  provider?: string
  provider_label?: string
}

function errorText(reason: unknown): string {
  return reason instanceof Error && reason.message ? reason.message : 'AI 配置服务暂时不可用。'
}

export function TenantAiConfigPanel({ runtime }: { runtime: EnterpriseClientRuntime | null }) {
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [embeddingApiKey, setEmbeddingApiKey] = useState('')
  const [embeddingBaseUrl, setEmbeddingBaseUrl] = useState('')
  const [embeddingError, setEmbeddingError] = useState<string | null>(null)
  const [embeddingModel, setEmbeddingModel] = useState('')
  const [embeddingNotice, setEmbeddingNotice] = useState<string | null>(null)
  const [embeddingProvider, setEmbeddingProvider] = useState('')
  const [embeddingStatus, setEmbeddingStatus] = useState<TenantEmbeddingStatus | null>(null)
  const [embeddingSubmitting, setEmbeddingSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [model, setModel] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [provider, setProvider] = useState('')
  const [reindexConfirming, setReindexConfirming] = useState(false)
  const [reindexSubmitting, setReindexSubmitting] = useState(false)
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

    const [next, nextEmbedding] = await Promise.all([
      runtime.get<TenantAiStatus>('/api/tenant-ai-config'),
      runtime.get<TenantEmbeddingStatus>('/api/tenant-embedding-config')
    ])
    setStatus(next)
    setEmbeddingStatus(nextEmbedding)
    setEmbeddingProvider(current => current || nextEmbedding.provider || '')
    setEmbeddingModel(current => current || nextEmbedding.model || '')
    setEmbeddingBaseUrl(current => current || nextEmbedding.base_url || '')
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

  useEffect(() => {
    if (embeddingStatus?.reindex_state !== 'running') {
      return
    }

    const timer = window.setInterval(() => {
      void load().catch(reason => setEmbeddingError(errorText(reason)))
    }, 3_000)

    return () => window.clearInterval(timer)
  }, [embeddingStatus?.reindex_state, load])

  const saveEmbedding = useCallback(async () => {
    const hasSavedKey = embeddingStatus?.profiles?.some(profile => profile.provider === embeddingProvider && profile.configured) ?? false
    if (!runtime?.post || !embeddingProvider || !embeddingModel || !embeddingBaseUrl || (!embeddingApiKey && !hasSavedKey) || embeddingSubmitting) {
      return
    }

    const submittedKey = embeddingApiKey
    setEmbeddingApiKey('')
    setEmbeddingSubmitting(true)
    setEmbeddingError(null)
    setEmbeddingNotice(null)

    try {
      const next = await runtime.post<TenantEmbeddingStatus>('/api/tenant-embedding-config', {
        api_key: submittedKey || undefined,
        base_url: embeddingBaseUrl,
        model: embeddingModel,
        provider: embeddingProvider
      })
      setEmbeddingStatus(next)
      setReindexConfirming(false)
      setEmbeddingProvider(next.provider ?? embeddingProvider)
      setEmbeddingModel(next.model ?? embeddingModel)
      setEmbeddingBaseUrl(next.base_url ?? embeddingBaseUrl)
      setEmbeddingNotice(next.reindex_required
        ? '向量配置已验证并加密保存。当前索引仍是旧模型，请确认后全量重建，重建完成前不会混用新旧向量。'
        : '向量配置已验证并加密保存。知识库检索和后续上传会立即使用它。')
    } catch (reason) {
      setEmbeddingError(errorText(reason))
    } finally {
      setEmbeddingSubmitting(false)
    }
  }, [embeddingApiKey, embeddingBaseUrl, embeddingModel, embeddingProvider, embeddingStatus, embeddingSubmitting, runtime])

  const startReindex = useCallback(async () => {
    if (!runtime?.post || reindexSubmitting || embeddingSubmitting || embeddingStatus?.reindex_state === 'running') {
      return
    }

    setReindexSubmitting(true)
    setEmbeddingError(null)
    setEmbeddingNotice(null)
    try {
      const next = await runtime.post<TenantEmbeddingStatus>('/api/tenant-embedding-reindex', { confirm: true })
      setEmbeddingStatus(next)
      setReindexConfirming(false)
      setEmbeddingNotice(next.reindex_state === 'running'
        ? '已开始全量重建已发布知识切片；完成前不会混用新旧向量，页面会自动刷新状态。'
        : '当前知识库索引已与所选向量模型一致。')
    } catch (reason) {
      setEmbeddingError(errorText(reason))
    } finally {
      setReindexSubmitting(false)
    }
  }, [embeddingStatus?.reindex_state, embeddingSubmitting, reindexSubmitting, runtime])

  const selectEmbeddingProvider = useCallback((nextProvider: string) => {
    const currentProvider = embeddingProvider
    const saved = embeddingStatus?.profiles?.find(profile => profile.provider === nextProvider)
    const preset = embeddingStatus?.providers?.find(provider => provider.key === nextProvider)
    setEmbeddingProvider(nextProvider)
    setEmbeddingModel(saved?.model ?? preset?.default_model ?? '')
    setEmbeddingBaseUrl(saved?.base_url ?? preset?.default_base_url ?? '')
    setEmbeddingApiKey('')
    setEmbeddingError(null)
    setEmbeddingNotice(currentProvider && currentProvider !== nextProvider
      ? '已恢复该厂商上次保存的模型与接口地址；密钥不会回显，如需替换可重新输入。'
      : null)
  }, [embeddingProvider, embeddingStatus])

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
          <p className="hesc-muted-copy">同一厂商、模型和地址可重复添加不同密钥；额度不足或限流时自动尝试备用密钥（每次最多四个）。密钥加密保存在服务器。同一账户的多把密钥可能共享额度。</p>
        </div>
        <span className="hesc-status" data-tone={status?.configured ? 'success' : status?.encryption_ready === false ? 'error' : 'warning'}>
          {status?.configured ? `${models.length} 个已配置模型` : '尚未配置'}
        </span>
      </div>

      <div className="hesc-ai-config-grid">
        <section aria-label="企业 AI 模型配置" className="hesc-ai-config-section">
          <div className="hesc-provisioning-form">
            <label>AI 厂商
              <select disabled={!runtime || submitting} onChange={event => {
                const next = event.target.value
                setProvider(next)
                const entry = catalog.find(item => item.key === next)

                if (!editingId && entry?.default_model) {setModel(entry.default_model)}
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
        </section>

        <section aria-labelledby="tenant-embedding-config-title" className="hesc-embedding-config" data-testid="tenant-embedding-config-panel">
          <div className="hesc-section-heading">
            <div>
              <h3 className="hesc-section-title" id="tenant-embedding-config-title">知识库向量检索配置</h3>
              <p className="hesc-muted-copy">向量检索密钥独立于 MiniMax 对话密钥。保存时会真实验证；密钥加密保存在服务器且不会回显。</p>
            </div>
            <span className="hesc-status" data-tone={embeddingStatus?.reindex_state === 'running' || embeddingStatus?.reindex_required ? 'warning' : embeddingStatus?.configured ? 'success' : embeddingStatus?.encryption_ready === false ? 'error' : 'warning'}>
              {embeddingStatus?.reindex_state === 'running' ? '重建中' : embeddingStatus?.reindex_required ? '待重建' : embeddingStatus?.configured ? '已验证' : '待配置'}
            </span>
          </div>
          <div className="hesc-provisioning-form">
            <label>向量厂商
              <select disabled={!runtime || embeddingSubmitting || reindexSubmitting || embeddingStatus?.reindex_state === 'running'} onChange={event => selectEmbeddingProvider(event.target.value)} value={embeddingProvider}>
                {(embeddingStatus?.providers ?? []).map(item => <option key={item.key} value={item.key}>{item.label ?? item.key}</option>)}
              </select>
            </label>
            <label>向量模型
              <input disabled={!runtime || embeddingSubmitting || reindexSubmitting || embeddingStatus?.reindex_state === 'running'} onChange={event => setEmbeddingModel(event.target.value)} value={embeddingModel} />
            </label>
            <label>接口地址
              <input disabled={!runtime || embeddingSubmitting || reindexSubmitting || embeddingStatus?.reindex_state === 'running'} onChange={event => setEmbeddingBaseUrl(event.target.value)} value={embeddingBaseUrl} />
            </label>
            <label>Embedding API Key
              <input autoComplete="off" disabled={!runtime || embeddingSubmitting || reindexSubmitting || embeddingStatus?.reindex_state === 'running'} onChange={event => setEmbeddingApiKey(event.target.value)} placeholder="首次或替换密钥时填写；不会回显" type="password" value={embeddingApiKey} />
            </label>
            <div className="hesc-inline-actions">
              <button className="hesc-action" disabled={!runtime || embeddingSubmitting || reindexSubmitting || embeddingStatus?.reindex_state === 'running' || !embeddingProvider || !embeddingModel || !embeddingBaseUrl || (!embeddingApiKey && !(embeddingStatus?.profiles?.some(profile => profile.provider === embeddingProvider && profile.configured)))} onClick={() => void saveEmbedding()} type="button">
                {embeddingSubmitting ? '正在验证…' : (embeddingStatus?.profiles?.some(profile => profile.provider === embeddingProvider && profile.configured) ? '保存并验证配置' : '验证并安全保存')}
              </button>
            </div>
          </div>
          <p className="hesc-muted-copy hesc-embedding-note">当前索引固定为 {embeddingStatus?.dimension ?? 768} 维。厂商预设可编辑，切换回来会恢复该厂商已保存的模型和接口地址；接口地址只能使用所选厂商的 HTTPS embeddings 域名。</p>
          {embeddingStatus?.reindex_state === 'running' ? <p className="hesc-warning-copy">正在后台全量重建已发布知识切片。完成前企业知识检索不会混用新旧向量，页面会自动刷新状态。</p> : null}
          {embeddingStatus?.reindex_required && embeddingStatus?.reindex_state !== 'running' ? <div className="hesc-warning-copy">
            <p>{embeddingStatus.reindex_error ?? '已验证的新向量模型等待全量重建索引后生效；在此之前系统不会把新旧向量混合检索。'}</p>
            {!reindexConfirming ? <button className="hesc-action hesc-action-secondary" disabled={!runtime || embeddingSubmitting || reindexSubmitting} onClick={() => setReindexConfirming(true)} type="button">全量重建现有索引</button> : <div className="hesc-inline-actions">
              <span>将重新生成全部已发布知识切片的向量，不删除原始文档；重建期间企业知识检索暂停。</span>
              <button className="hesc-action" disabled={reindexSubmitting} onClick={() => void startReindex()} type="button">{reindexSubmitting ? '正在启动…' : '确认全量重建'}</button>
              <button className="hesc-action hesc-action-secondary" disabled={reindexSubmitting} onClick={() => setReindexConfirming(false)} type="button">取消</button>
            </div>}
          </div> : null}
          {embeddingNotice ? <p className="hesc-success-copy" role="status">{embeddingNotice}</p> : null}
          {embeddingError ? <div className="hesc-error" role="status"><div><strong>知识库向量配置未完成</strong><span>{embeddingError}</span></div></div> : null}
        </section>
      </div>

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
