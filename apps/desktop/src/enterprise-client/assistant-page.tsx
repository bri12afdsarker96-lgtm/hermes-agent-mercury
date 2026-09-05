import { useStore } from '@nanostores/react'
import { atom } from 'nanostores'
import { type ChangeEvent, type FormEvent, useCallback, useEffect, useRef, useState } from 'react'

import type { EnterpriseClientRuntime } from './runtime'

type AssistantMode = 'chat' | 'extract_action_items' | 'knowledge_question' | 'rewrite' | 'summarize'

interface ConversationMessage {
  id: string
  role: 'assistant' | 'user'
  text: string
}

interface TenantModel {
  configuration_id: string
  is_default: boolean
  model: string
  provider: string
}

interface TenantModelPool {
  configured?: boolean
  default_model_id?: string | null
  models?: TenantModel[]
}

interface AssistantResponse {
  configuration_id: string
  knowledge_grounded: boolean
  model: string
  provider: string
  text: string
}

interface AssistantPageProps {
  principalId?: string
  runtime: EnterpriseClientRuntime | null
}

const $messages = atom<ConversationMessage[]>([])
const $messageScope = atom<string | null>(null)

const MODE_COPY: Record<AssistantMode, { label: string; placeholder: string }> = {
  chat: { label: '企业对话', placeholder: '输入需要协作、分析或解释的问题…' },
  summarize: { label: '文本摘要', placeholder: '粘贴需要摘要的文本，或选择本地文本文件…' },
  rewrite: { label: '文本改写', placeholder: '粘贴需要润色或改写的文本，或选择本地文本文件…' },
  extract_action_items: { label: '提取待办', placeholder: '粘贴会议记录、沟通记录或工作文本…' },
  knowledge_question: { label: '知识库问答', placeholder: '提出问题，系统只检索当前企业已入库的知识…' }
}

const ACCEPTED_LOCAL_TEXT = /\.(?:csv|json|log|md|txt)$/i
const MAX_LOCAL_TEXT_BYTES = 512 * 1024
const MAX_REQUEST_CHARS = 24_000

function messageForError(reason: unknown): string {
  if (reason instanceof Error && reason.message) {
    return reason.message
  }

  return '企业 AI 服务暂时不可用，请稍后重试。'
}

function transcriptForChat(messages: ConversationMessage[], current: string): string {
  const history = messages.slice(-8).map(message => `${message.role === 'user' ? '成员' : '助手'}：${message.text}`)

  return [...history, `成员：${current}`].join('\n\n')
}

function modelLabel(model: TenantModel): string {
  return `${model.provider} · ${model.model}${model.is_default ? '（企业默认）' : ''}`
}

export function AssistantPage({ principalId, runtime }: AssistantPageProps) {
  const messages = useStore($messages)
  const [composer, setComposer] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [fileText, setFileText] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [loadingModels, setLoadingModels] = useState(true)
  const [mode, setMode] = useState<AssistantMode>('chat')
  const [models, setModels] = useState<TenantModel[]>([])
  const [selectedConfigurationId, setSelectedConfigurationId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const scope = principalId ?? null

    if ($messageScope.get() !== scope) {
      $messageScope.set(scope)
      $messages.set([])
      setComposer('')
      setFileText(null)
      setFileName(null)
    }
  }, [principalId])

  useEffect(() => {
    let active = true

    if (!runtime) {
      setLoadingModels(false)
      setModels([])
      setError('企业服务连接恢复后即可加载本企业 AI 模型。')
      return () => {
        active = false
      }
    }

    setLoadingModels(true)
    setError(null)
    void runtime.get<TenantModelPool>('/api/tenant-ai-models')
      .then(pool => {
        if (!active) {
          return
        }

        const nextModels = Array.isArray(pool.models) ? pool.models : []
        setModels(nextModels)
        setSelectedConfigurationId(current => (
          nextModels.some(model => model.configuration_id === current)
            ? current
            : ''
        ))
        if (!pool.configured || nextModels.length === 0) {
          setError('企业管理员尚未配置可用的 AI 模型。')
        }
      })
      .catch(reason => {
        if (active) {
          setModels([])
          setError(messageForError(reason))
        }
      })
      .finally(() => {
        if (active) {
          setLoadingModels(false)
        }
      })

    return () => {
      active = false
    }
  }, [runtime])

  const clearAttachment = useCallback(() => {
    setFileText(null)
    setFileName(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }, [])

  const chooseLocalText = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) {
      return
    }
    const textLike = file.type.startsWith('text/') || ACCEPTED_LOCAL_TEXT.test(file.name)
    if (!textLike) {
      setError('仅可在此处理 TXT、MD、CSV、JSON 或 LOG 文本文件；DOC/DOCX/PDF 请先上传到企业知识库。')
      return
    }
    if (file.size > MAX_LOCAL_TEXT_BYTES) {
      setError('本地文本文件不能超过 512 KB。较大的资料请先上传到企业知识库。')
      return
    }
    try {
      const text = (await file.text()).trim()
      if (!text) {
        setError('所选文件没有可处理的文本内容。')
        return
      }
      setFileText(text.slice(0, MAX_REQUEST_CHARS))
      setFileName(file.name)
      setError(null)
      if (mode === 'chat' || mode === 'knowledge_question') {
        setMode('summarize')
      }
    } catch {
      setError('无法读取所选本地文件。')
    }
  }, [mode])

  const submit = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const instruction = composer.trim()
    const selectedText = fileText?.trim() ?? ''
    const rawContent = selectedText
      ? `${instruction ? `处理要求：${instruction}\n\n` : ''}【用户明确选择的本地文件：${fileName ?? '文本文件'}】\n${selectedText}`
      : instruction
    const content = mode === 'chat' && !selectedText ? transcriptForChat(messages, rawContent) : rawContent

    if (!runtime?.post || !rawContent || submitting || loadingModels || models.length === 0) {
      return
    }
    if (content.length > MAX_REQUEST_CHARS) {
      setError('本次内容超过 24000 个字符，请缩短文本后再处理。')
      return
    }

    const visibleUserText = selectedText
      ? `${instruction || '处理所选本地文本'} · ${fileName ?? '本地文本文件'}`
      : instruction
    const requestModelId = selectedConfigurationId || undefined
    setComposer('')
    clearAttachment()
    setError(null)
    setSubmitting(true)
    $messages.set([...messages, { id: `user-${Date.now()}`, role: 'user', text: visibleUserText }])

    try {
      const result = await runtime.post<AssistantResponse>('/api/tenant-ai-assist', {
        configuration_id: requestModelId,
        content,
        mode
      })
      $messages.set([
        ...$messages.get(),
        { id: `assistant-${Date.now()}`, role: 'assistant', text: result.text }
      ])
    } catch (reason) {
      setError(messageForError(reason))
    } finally {
      setSubmitting(false)
    }
  }, [clearAttachment, composer, fileName, fileText, loadingModels, messages, mode, models.length, runtime, selectedConfigurationId, submitting])

  const defaultModel = models.find(item => item.is_default)
  const selectedModel = models.find(item => item.configuration_id === selectedConfigurationId)

  return (
    <section className="hesc-page hesc-assistant-page" data-testid="enterprise-client-assistant">
      <header className="hesc-page-header">
        <div>
          <h1>企业 AI 助理</h1>
          <p>使用本企业保存的 AI 模型。密钥仅保存在服务器；每次调用均按当前账号和租户范围校验。</p>
        </div>
        <span className="hesc-status" data-tone={models.length > 0 ? 'success' : error ? 'error' : 'warning'}>
          {loadingModels ? '正在加载模型' : models.length > 0 ? '企业模型已就绪' : '等待企业配置'}
        </span>
      </header>

      <div className="hesc-assistant-layout hesc-tenant-ai-layout">
        <aside aria-label="AI 处理方式" className="hesc-card hesc-assistant-sessions hesc-ai-tools">
          <div className="hesc-section-heading">
            <div>
              <h2 className="hesc-section-title">处理方式</h2>
              <p className="hesc-muted-copy">对话、文本处理、知识检索与提醒协作均使用服务端权限。</p>
            </div>
          </div>
          <div className="hesc-agent-session-list" role="list">
            {(Object.keys(MODE_COPY) as AssistantMode[]).map(item => (
              <button
                aria-current={mode === item ? 'true' : undefined}
                key={item}
                onClick={() => setMode(item)}
                type="button"
              >
                <strong>{MODE_COPY[item].label}</strong>
                <span>{item === 'knowledge_question' ? '仅检索本企业已入库知识' : '由企业选定模型完成'}</span>
              </button>
            ))}
          </div>

          <label className="hesc-ai-select-label" htmlFor="tenant-ai-model">
            当前使用模型
            <select
              disabled={loadingModels || models.length === 0}
              id="tenant-ai-model"
              onChange={event => setSelectedConfigurationId(event.target.value)}
              value={selectedConfigurationId}
            >
              {defaultModel ? (
                <option value="">企业默认 · {defaultModel.provider} · {defaultModel.model}</option>
              ) : null}
              {models.map(model => (
                <option key={model.configuration_id} value={model.configuration_id}>{modelLabel(model)}</option>
              ))}
            </select>
          </label>
          <p className="hesc-muted-copy">
            {!selectedConfigurationId || selectedModel?.is_default
              ? '未另行选择时，服务端会使用企业默认模型。'
              : '本次将使用你选择的企业授权模型。'}
          </p>

          <div className="hesc-ai-reminder-note">
            <strong>定时提醒</strong>
            <span>提醒已在“我的任务 / 团队任务 / 业务运营”中执行。AI 只协助整理内容，不会未经确认创建提醒。</span>
          </div>
        </aside>

        <article className="hesc-card hesc-agent-transcript">
          <div className="hesc-section-heading">
            <div>
              <h2 className="hesc-section-title">{MODE_COPY[mode].label}</h2>
              <p className="hesc-muted-copy">
                {mode === 'knowledge_question'
                  ? '答案仅依据当前企业已入库的匹配知识；未找到依据会明确说明。'
                  : '你可以直接对话，或提交文本进行摘要、改写和待办提取。'}
              </p>
            </div>
            {submitting ? <span className="hesc-status" data-tone="warning">正在处理</span> : null}
          </div>

          <div aria-live="polite" className="hesc-agent-messages">
            {messages.length === 0 ? <p className="hesc-muted-copy">选择处理方式后输入内容即可开始。对话仅保留在当前已登录客户端会话中。</p> : null}
            {messages.map(message => (
              <div className="hesc-agent-message" data-role={message.role} key={message.id}>
                <span>{message.role === 'user' ? '你' : '企业 AI 助理'}</span>
                <p>{message.text}</p>
              </div>
            ))}
          </div>

          <form className="hesc-agent-composer" onSubmit={event => void submit(event)}>
            <label htmlFor="enterprise-ai-composer">{fileText ? '可补充处理要求' : '输入内容'}</label>
            <textarea
              disabled={submitting || loadingModels || models.length === 0}
              id="enterprise-ai-composer"
              onChange={event => setComposer(event.target.value)}
              placeholder={MODE_COPY[mode].placeholder}
              value={composer}
            />
            <div className="hesc-ai-file-row">
              <input
                accept=".txt,.md,.csv,.json,.log,text/plain,text/markdown,text/csv,application/json"
                aria-label="选择本地文本文件"
                className="hesc-visually-hidden"
                onChange={event => void chooseLocalText(event)}
                ref={fileInputRef}
                type="file"
              />
              <button className="hesc-action hesc-action-secondary" onClick={() => fileInputRef.current?.click()} type="button">
                选择本地文本文件
              </button>
              {fileName ? <span>已选择：{fileName}</span> : <span>仅在你选择并提交后读取；不扫描电脑目录。</span>}
              {fileName ? <button className="hesc-text-action" onClick={clearAttachment} type="button">移除</button> : null}
            </div>
            <div>
              <span>DOC、DOCX、PDF 请先上传企业知识库；模型密钥不会写入客户端或日志。</span>
              <button className="hesc-action" disabled={submitting || loadingModels || models.length === 0 || (!composer.trim() && !fileText)} type="submit">
                {submitting ? '正在处理' : '提交处理'}
              </button>
            </div>
          </form>
        </article>
      </div>

      {error ? (
        <div className="hesc-error" role="status">
          <div>
            <strong>企业 AI 助理暂不可用</strong>
            <span>{error}</span>
          </div>
        </div>
      ) : null}
    </section>
  )
}
