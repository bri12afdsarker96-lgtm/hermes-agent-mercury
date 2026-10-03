import { useCallback, useEffect, useState } from 'react'

import type { EnterpriseClientRuntime } from './runtime'
import { useWebPresentation } from './web-presentation'

interface TenantAiPersona {
  description: string
  is_default?: boolean
  name: string
  persona_id: string
}

interface TenantAiPersonaStatus {
  personas?: TenantAiPersona[]
}

function errorText(reason: unknown): string {
  return reason instanceof Error && reason.message ? reason.message : '人设服务暂时不可用。'
}

export function TenantAiPersonaPanel({ runtime }: { runtime: EnterpriseClientRuntime | null }) {
  const web = useWebPresentation()
  const [description, setDescription] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [instructions, setInstructions] = useState('')
  const [name, setName] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [personas, setPersonas] = useState<TenantAiPersona[]>([])
  const [submitting, setSubmitting] = useState(false)

  const resetEditor = useCallback(() => {
    setDescription('')
    setEditingId(null)
    setInstructions('')
    setName('')
  }, [])

  const load = useCallback(async () => {
    if (!runtime) {
      setPersonas([])
      return
    }
    const response = await runtime.get<TenantAiPersonaStatus>('/api/tenant-ai-personas')
    setPersonas(Array.isArray(response.personas) ? response.personas : [])
  }, [runtime])

  useEffect(() => {
    let active = true
    void load().catch(reason => {
      if (active) {setError(errorText(reason))}
    })
    return () => {active = false}
  }, [load])

  const save = useCallback(async () => {
    if (!runtime?.post || !name.trim() || !instructions.trim() || submitting) {return}
    setSubmitting(true)
    setError(null)
    setNotice(null)
    try {
      const next = await runtime.post<TenantAiPersonaStatus>('/api/tenant-ai-personas', {
        action: 'upsert', description, instructions, name, persona_id: editingId ?? undefined
      })
      setPersonas(Array.isArray(next.personas) ? next.personas : [])
      setNotice(editingId ? '人设已更新，新的回答将从下一次提问开始使用。' : '人设已创建，可在企业 AI 助手中选择。')
      resetEditor()
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setSubmitting(false)
    }
  }, [description, editingId, instructions, name, resetEditor, runtime, submitting])

  const edit = useCallback((persona: TenantAiPersona) => {
    setDescription(persona.description)
    setEditingId(persona.persona_id)
    setInstructions('')
    setName(persona.name)
    setError(null)
    setNotice('请输入完整的人设设定后保存；设定内容不会回显到其他成员。')
  }, [])

  const remove = useCallback(async (personaId: string) => {
    if (!runtime?.post || submitting) {return}
    setSubmitting(true)
    setError(null)
    try {
      const next = await runtime.post<TenantAiPersonaStatus>('/api/tenant-ai-personas', {
        action: 'remove', persona_id: personaId
      })
      setPersonas(Array.isArray(next.personas) ? next.personas : [])
      if (editingId === personaId) {resetEditor()}
      setNotice('人设已移除；已开始的回答不会受到影响。')
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setSubmitting(false)
    }
  }, [editingId, resetEditor, runtime, submitting])

  const setDefault = useCallback(async (personaId: string) => {
    if (!runtime?.post || submitting) {return}
    setSubmitting(true)
    setError(null)
    setNotice(null)
    try {
      const next = await runtime.post<TenantAiPersonaStatus>('/api/tenant-ai-personas', {
        action: 'set_default', persona_id: personaId
      })
      setPersonas(Array.isArray(next.personas) ? next.personas : [])
      setNotice('默认人设已更新，未主动选择人设的成员将从下一次提问开始使用它。')
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setSubmitting(false)
    }
  }, [runtime, submitting])

  return (
    <article className="hesc-card hesc-tenant-ai-config" data-testid="tenant-ai-persona-panel">
      <div className="hesc-section-heading">
        <div>
          <h2 className="hesc-section-title">企业 AI 人设</h2>
          <p className="hesc-muted-copy">{web.enabled ? '设置回复的角色、语气与重点。' : '人设只影响角色、语气、回答重点和结构。模型、租户、权限、外部操作与知识依据始终由服务端规则控制。'}</p>
        </div>
        <span className="hesc-status" data-tone={personas.some(persona => persona.is_default) ? 'success' : 'warning'}>{personas.some(persona => persona.is_default) ? '已设置默认人设' : '请设置默认人设'}</span>
      </div>

      <div className="hesc-provisioning-form">
        <label>人设名称<input disabled={!runtime || submitting} maxLength={48} onChange={event => setName(event.target.value)} placeholder="例如：售后顾问" value={name} /></label>
        <label>适用说明<input disabled={!runtime || submitting} maxLength={180} onChange={event => setDescription(event.target.value)} placeholder="例如：处理售后咨询和工单跟进" value={description} /></label>
        <label>人设设定<textarea disabled={!runtime || submitting} maxLength={2000} onChange={event => setInstructions(event.target.value)} placeholder="例如：先安抚用户，再基于已检索到的企业知识给出分步建议；没有依据时明确待确认。" value={instructions} /></label>
        <div className="hesc-inline-actions">
          <button className="hesc-action" disabled={!runtime || submitting || !name.trim() || !instructions.trim()} onClick={() => void save()} type="button">{editingId ? '更新人设' : '创建人设'}</button>
          {editingId ? <button className="hesc-action hesc-action-secondary" disabled={submitting} onClick={resetEditor} type="button">取消编辑</button> : null}
        </div>
      </div>

      {notice ? <p className="hesc-success-copy" role="status">{notice}</p> : null}
      {error ? <div className="hesc-error" role="status"><div><strong>企业 AI 人设未完成</strong><span>{error}</span></div></div> : null}

      <p className="hesc-muted-copy">{web.enabled ? '仅企业管理员可编辑，请指定默认人设。' : '仅企业管理员维护人设并指定默认值。系统不提供或隐藏任何内置人设；未设置默认人设时，企业 AI 助手不会代替管理员做选择。'}</p>
      <div className="hesc-scroll-region hesc-tenant-model-list">
        <table className="hesc-table">
          <thead><tr><th scope="col">名称</th><th scope="col">说明</th><th scope="col">操作</th></tr></thead>
          <tbody>
            {personas.map(persona => <tr key={persona.persona_id}>
              <td>{persona.name}{persona.is_default ? '（默认）' : ''}</td><td>{persona.description || '—'}</td>
              <td><div className="hesc-inline-actions"><button className="hesc-text-action" disabled={submitting || persona.is_default} onClick={() => void setDefault(persona.persona_id)} type="button">{persona.is_default ? '当前默认' : '设为默认'}</button><button className="hesc-text-action" disabled={submitting} onClick={() => edit(persona)} type="button">编辑</button><button className="hesc-text-action" disabled={submitting} onClick={() => void remove(persona.persona_id)} type="button">删除</button></div></td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </article>
  )
}
