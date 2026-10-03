import { useStore } from '@nanostores/react'
import { useWebPresentation } from './web-presentation'
import { type ChangeEvent, type FormEvent, type UIEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { AssistantReplyCard } from './assistant-reply-card'
import { assistantPresentationFrom } from './assistant-response'
import { AssistantResponseDetails } from './assistant-response-details'
import { supplementaryReplyOptions } from './assistant-response'
import {
  type AssistantMode,
  type AssistantSession,
  assistantSessionFor,
  createAssistantChatThread,
  deleteAssistantChatThread,
  type ConversationMessage,
  renameAssistantChatThread
} from './assistant-session'
import { CustomerReplyWorkspace } from './customer-reply-panel'
import { submitComposerOnEnter } from './composer-keyboard'
import { $enterprisePackageInstallFrozen, registerEnterpriseInstallActivity } from './enterprise-install-readiness'
import type { EnterpriseClientRuntime } from './runtime'

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

interface TenantPersona {
  description: string
  is_default?: boolean
  name: string
  persona_id: string
}

interface TenantPersonaPool {
  personas?: TenantPersona[]
}

interface AssistantResponse {
  answer_text?: string
  agent_trace?: Array<{
    best_similarity?: number | null
    candidate_count?: number
    result_count: number
    similarity_threshold?: number | null
    status: string
    tool: string
  }>
  customer_reply_options?: Array<{ kind?: string; text?: string }>
  configuration_id: string
  knowledge_grounded: boolean
  model: string
  provider: string
  persona_id?: string
  persona_name?: string
  reasoning_summary?: string
  retrieval_meta?: {
    best_similarity?: number | null
    candidate_count?: number
    matched_count?: number
    similarity_threshold?: number | null
    status?: string
  }
  text: string
}

interface AssistantPageProps {
  onRemind?: (request: string) => void
  separatedNavigation?: boolean
  principalId?: string
  runtime: EnterpriseClientRuntime | null
  tenantId?: string
}

const MODE_COPY: Record<AssistantMode, { label: string; placeholder: string }> = {
  customer_reply: { label: '客户回复建议', placeholder: '' },
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

export function AssistantPage({ principalId, runtime, tenantId, separatedNavigation, onRemind }: AssistantPageProps) {
  const session = useMemo(() => assistantSessionFor(runtime, tenantId, principalId), [runtime, tenantId, principalId])

  return (
    <AssistantSessionPage
      key={session.id}
      runtime={runtime}
      session={session}
      separatedNavigation={separatedNavigation}
      onRemind={onRemind}
    />
  )
}

function AssistantSessionPage({
  runtime,
  session,
  separatedNavigation,
  onRemind
}: {
  onRemind?: (request: string) => void
  separatedNavigation?: boolean
  runtime: EnterpriseClientRuntime | null
  session: AssistantSession
}) {
  const web = useWebPresentation()
  const mode = useStore(session.mode)
  const chatThreads = useStore(session.chatThreads)
  const activeChatThreadId = useStore(session.activeChatThreadId)
  const activeChatThread = chatThreads.find(thread => thread.id === activeChatThreadId) ?? chatThreads[0] ?? session.conversations.chat
  const activeConversation = mode === 'chat' ? activeChatThread : session.conversations[mode]
  const $messages = activeConversation.messages
  const messages = useStore($messages)
  const $localWork = activeConversation.work
  const { composer, fileName, fileText, submitting } = useStore($localWork)
  const frozen = useStore($enterprisePackageInstallFrozen)

  const setComposer = useCallback((value: string | ((current: string) => string)) => {
    const current = $localWork.get()
    $localWork.set({ ...current, composer: typeof value === 'function' ? value(current.composer) : value })
  }, [$localWork])

  const setFileText = useCallback((fileText: string | null) => $localWork.set({ ...$localWork.get(), fileText }), [$localWork])
  const setFileName = useCallback((fileName: string | null) => $localWork.set({ ...$localWork.get(), fileName }), [$localWork])
  const setSubmitting = useCallback((submitting: boolean) => $localWork.set({ ...$localWork.get(), submitting }), [$localWork])
  const [error, setError] = useState<string | null>(null)
  const [loadingModels, setLoadingModels] = useState(true)
  const [modelLoadFailed, setModelLoadFailed] = useState(false)
  const [modelReloadVersion, setModelReloadVersion] = useState(0)
  const setMode = useCallback((value: AssistantMode) => session.mode.set(value), [session])
  const [models, setModels] = useState<TenantModel[]>([])
  const [personas, setPersonas] = useState<TenantPersona[]>([])
  const [selectedConfigurationId, setSelectedConfigurationId] = useState('')
  const [selectedPersonaId, setSelectedPersonaId] = useState('')
  const [renamingThreadId, setRenamingThreadId] = useState<string | null>(null)
  const [renamingTitle, setRenamingTitle] = useState('')
  const [threadMenuId, setThreadMenuId] = useState<string | null>(null)
  const activeRequest = useRef<Record<AssistantMode, number>>({ chat: 0, customer_reply: 0, summarize: 0, rewrite: 0, extract_action_items: 0, knowledge_question: 0 })
  const fileInputRef = useRef<HTMLInputElement>(null)
  const messagesRef = useRef<HTMLDivElement>(null)
  const shouldStickToLatestMessage = useRef(true)

  useEffect(() => {
    const activity = registerEnterpriseInstallActivity({ blocker: () => {
      for (const conversation of Object.values(session.conversations)) {
      const work = conversation.work.get()

      if (work.submitting) {return '企业 AI 正在处理问题，请等待回答完成后更新。'}

      if (work.readingFile) {return '正在读取本地文件，请等待完成后更新。'}

      if (work.composer.trim() || work.fileText !== null) {return 'AI 输入区有未提交文字或附件，请先提交处理或复制保存后更新。'}

      }
      return null
    } })

    const unsubscribes = Object.values(session.conversations).map(conversation => conversation.work.listen(activity.changed))

    return () => { unsubscribes.forEach(unsubscribe => unsubscribe()); activity.dispose() }
  }, [session])

  useEffect(() => {
    if (messagesRef.current && shouldStickToLatestMessage.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight
    }
  }, [messages])

  const updateTranscriptScrollIntent = useCallback((event: UIEvent<HTMLDivElement>) => {
    const { clientHeight, scrollHeight, scrollTop } = event.currentTarget
    shouldStickToLatestMessage.current = scrollHeight - scrollTop - clientHeight < 32
  }, [])

  useEffect(
    () => () => {
      for (const item of Object.keys(activeRequest.current) as AssistantMode[]) {++activeRequest.current[item]}
    },
    []
  )

  useEffect(() => {
    let active = true
    let retryTimer: number | undefined

    if (!runtime) {
      setLoadingModels(false)
      setModelLoadFailed(false)
      setModels([])
      setError('企业服务连接恢复后即可加载本企业 AI 模型。')

      return () => {
        active = false
      }
    }

    setLoadingModels(true)
    setModelLoadFailed(false)
    setError(null)
    void runtime
      .get<TenantModelPool>('/api/tenant-ai-models')
      .then(pool => {
        if (!active) {
          return
        }

        const nextModels = Array.isArray(pool.models) ? pool.models : []
        setModels(nextModels)
        setSelectedConfigurationId(current =>
          nextModels.some(model => model.configuration_id === current) ? current : ''
        )

        if (!pool.configured || nextModels.length === 0) {
          setError('企业管理员尚未配置可用的 AI 模型。')
        }
      })
      .catch(reason => {
        if (active) {
          setModels([])
          setModelLoadFailed(true)
          setError(messageForError(reason))
          // Network hiccups used to leave the composer permanently disabled
          // until the member manually reconnected. A model read is safe to
          // retry and is scoped to the already authenticated enterprise.
          retryTimer = window.setTimeout(() => {
            if (active) {
              setModelReloadVersion(current => current + 1)
            }
          }, 4_000)
        }
      })
      .finally(() => {
        if (active) {
          setLoadingModels(false)
        }
      })

    return () => {
      active = false
      if (retryTimer !== undefined) {
        window.clearTimeout(retryTimer)
      }
    }
  }, [modelReloadVersion, runtime])

  useEffect(() => {
    let active = true

    if (!runtime) {
      setPersonas([])
      setSelectedPersonaId('')
      return () => {active = false}
    }

    void runtime.get<TenantPersonaPool>('/api/tenant-ai-personas')
      .then(pool => {
        if (!active) {return}
        const next = Array.isArray(pool.personas) ? pool.personas : []
        setPersonas(next)
        setSelectedPersonaId(current => next.some(persona => persona.persona_id === current)
          ? current
          : next.find(persona => persona.is_default)?.persona_id ?? '')
      })
      .catch(() => {
        if (active) {setPersonas([])}
      })

    return () => {active = false}
  }, [runtime])

  const clearAttachment = useCallback(() => {
    setFileText(null)
    setFileName(null)

    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }, [setFileName, setFileText])

  const chooseLocalText = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      if ($enterprisePackageInstallFrozen.get()) {return}
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

      $localWork.set({ ...$localWork.get(), readingFile: true })

      try {
        const text = (await file.text()).trim()

        if (!text) {
          setError('所选文件没有可处理的文本内容。')

          return
        }

        if (text.length > MAX_REQUEST_CHARS) {
          setError('文件文本超过 24000 个字符，请缩短文本或上传企业知识库。')

          return
        }

        setFileText(text)
        setFileName(file.name)
        setError(null)
        if (mode === 'chat' || mode === 'knowledge_question') {
          session.conversations.summarize.work.set({ ...session.conversations.summarize.work.get(), fileText: text, fileName: file.name })
          setFileText(null)
          setFileName(null)
          setMode('summarize')
        }

      } catch {
        setError('无法读取所选本地文件。')
      } finally {
        $localWork.set({ ...$localWork.get(), readingFile: false })
      }
    },
    [$localWork, mode, setFileName, setFileText, setMode]
  )

  const submit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()

      if ($enterprisePackageInstallFrozen.get()) {return}
      const instruction = composer.trim()
      const selectedText = fileText?.trim() ?? ''

      const rawContent = selectedText
        ? `${instruction ? `处理要求：${instruction}\n\n` : ''}【用户明确选择的本地文件：${fileName ?? '文本文件'}】\n${selectedText}`
        : instruction

      const content = mode === 'chat' && !selectedText ? transcriptForChat(messages, rawContent) : rawContent

      if (!runtime?.post || !rawContent || submitting || loadingModels || models.length === 0) {
        return
      }
      if ((mode === 'chat' || mode === 'knowledge_question') && !selectedText && onRemind && /(?:提醒我|提醒一下|到时提醒|定时提醒|帮我.*提醒|创建.{0,6}(?:任务|提醒)|\/提醒)/.test(instruction)) {
        onRemind(instruction)
        setComposer('')
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
      const requestVersion = ++activeRequest.current[mode]
      shouldStickToLatestMessage.current = true
      setComposer('')
      clearAttachment()
      setError(null)
      setSubmitting(true)
      $messages.set([...messages, { id: `user-${Date.now()}`, role: 'user', text: visibleUserText }])
      if (mode === 'chat' && messages.length === 0 && activeChatThread.title === '新对话') {
        renameAssistantChatThread(session, activeChatThread.id, visibleUserText)
      }

      try {
        const result = await runtime.post<AssistantResponse>('/api/tenant-ai-assist', {
          configuration_id: requestModelId,
          persona_id: selectedPersonaId || undefined,
          content,
          mode: mode === 'knowledge_question' ? 'knowledge_answer' : mode === 'chat' ? 'enterprise_question' : mode,
          ...(mode === 'chat' ? { knowledge_query: rawContent.slice(0, 1000) } : {})
        })

        if (activeRequest.current[mode] !== requestVersion) {
          return
        }

        const presentation = assistantPresentationFrom(result)
        if (!presentation.text) {
          throw new Error('未收到完整的 AI 回答，请重试。')
        }
        const answerId = `assistant-${Date.now()}`
        $messages.set([...$messages.get(), {
          id: answerId,
          ...(presentation.knowledgeTrace ? { knowledgeTrace: presentation.knowledgeTrace } : {}),
          ...(presentation.reasoningSummary ? { reasoningSummary: presentation.reasoningSummary } : {}),
          ...(presentation.customerReplyOptions.length ? { customerReplyOptions: presentation.customerReplyOptions } : {}),
          role: 'assistant',
          text: presentation.text
        }])

      } catch (reason) {
        if (activeRequest.current[mode] !== requestVersion) {
          return
        }

        // Keep a failed question editable instead of losing it after a 429,
        // transient connection failure, or unavailable tenant model.
        setComposer(instruction)
        setFileText(selectedText || null)
        setFileName(fileName)
        setError(messageForError(reason))
      } finally {
        if (activeRequest.current[mode] === requestVersion) {
          setSubmitting(false)
        }
      }
    },
    [
      $messages,
      activeChatThread,
      clearAttachment,
      composer,
      fileName,
      fileText,
      loadingModels,
      messages,
      mode,
      models.length,
      runtime,
      selectedConfigurationId,
      selectedPersonaId,
      setComposer,
      setFileName,
      setFileText,
      setSubmitting,
      session,
      submitting
    ]
  )

  const defaultModel = models.find(item => item.is_default)
  const selectedModel = models.find(item => item.configuration_id === selectedConfigurationId)
  const selectedPersona = personas.find(item => item.persona_id === selectedPersonaId)
  // Personas are tenant-managed guidance, not a second model prerequisite.
  // A tenant without one intentionally uses the configured model's baseline
  // behavior; employees must still be able to start a normal conversation.
  const personaReady = personas.length === 0 || Boolean(selectedPersonaId)
  const startNewConversation = useCallback(() => {
    if ($enterprisePackageInstallFrozen.get() || submitting) {
      return
    }
    createAssistantChatThread(session)
    setRenamingThreadId(null)
    setThreadMenuId(null)
    setMode('chat')
    setError(null)
  }, [session, setMode, submitting])
  const selectConversation = useCallback((threadId: string) => {
    if (submitting) {
      return
    }
    session.activeChatThreadId.set(threadId)
    setRenamingThreadId(null)
    setThreadMenuId(null)
    setMode('chat')
  }, [session, setMode, submitting])
  const beginRename = useCallback((thread: typeof activeChatThread) => {
    setRenamingThreadId(thread.id)
    setRenamingTitle(thread.title)
    setThreadMenuId(null)
  }, [])
  const commitRename = useCallback((threadId: string) => {
    renameAssistantChatThread(session, threadId, renamingTitle)
    setRenamingThreadId(null)
  }, [renamingTitle, session])
  const deleteConversation = useCallback((threadId: string) => {
    if (submitting) {
      return
    }
    deleteAssistantChatThread(session, threadId)
    setRenamingThreadId(null)
    setThreadMenuId(null)
    setMode('chat')
  }, [session, setMode, submitting])

  return (
    <section className="hesc-page hesc-assistant-page" data-layout={separatedNavigation ? 'conversation-workspace' : 'tools-workspace'} data-mode={mode} data-testid="enterprise-client-assistant">
      <div className={separatedNavigation ? 'hesc-ai-workbench' : undefined}>
        {separatedNavigation ? (
          <aside aria-label="企业 AI 对话记录" className="hesc-ai-conversation-sidebar">
            <header className="hesc-ai-conversation-intro">
              <h1>企业 AI 助手</h1>
              <p>结合企业知识库进行问答、分析与工作协作。</p>
            </header>
            <button className="hesc-action hesc-ai-new-chat" disabled={frozen || submitting} onClick={startNewConversation} type="button">
              ＋ 新建对话
            </button>
            <div className="hesc-ai-history-heading">
              <strong>对话记录</strong>
              <span>当前登录会话 · 刷新保持</span>
            </div>
            <div aria-label="当前登录会话的对话记录" className="hesc-ai-history-list" role="list">
              {chatThreads.map(thread => (
                <div aria-current={thread.id === activeChatThread.id ? 'true' : undefined} className="hesc-ai-history-row" key={thread.id} role="listitem">
                  {renamingThreadId === thread.id ? (
                    <form className="hesc-ai-history-rename" onSubmit={event => { event.preventDefault(); commitRename(thread.id) }}>
                      <input aria-label="对话名称" autoFocus maxLength={64} onChange={event => setRenamingTitle(event.target.value)} value={renamingTitle} />
                      <button className="hesc-text-action" type="submit">保存</button>
                      <button className="hesc-text-action" onClick={() => setRenamingThreadId(null)} type="button">取消</button>
                    </form>
                  ) : (
                    <>
                      <button className="hesc-ai-history-select" onClick={() => selectConversation(thread.id)} type="button">
                        <span>{thread.title}</span>
                        <small>{thread.messages.get().length ? `${Math.ceil(thread.messages.get().length / 2)} 轮对话` : '尚未开始'}</small>
                      </button>
                      <div className="hesc-ai-history-menu-wrap">
                        <button
                          aria-expanded={threadMenuId === thread.id}
                          aria-label={`打开${thread.title}操作`}
                          className="hesc-text-action hesc-ai-history-menu-trigger"
                          onClick={() => setThreadMenuId(current => current === thread.id ? null : thread.id)}
                          type="button"
                        >
                          ⋯
                        </button>
                        {threadMenuId === thread.id ? (
                          <div aria-label={`${thread.title}操作`} className="hesc-ai-history-menu" role="menu">
                            <button onClick={() => beginRename(thread)} role="menuitem" type="button">重命名</button>
                            <button className="hesc-ai-history-delete-action" onClick={() => deleteConversation(thread.id)} role="menuitem" type="button">删除</button>
                          </div>
                        ) : null}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </aside>
        ) : (
          <header className="hesc-page-header">
            <div>
              <h1>{mode === 'knowledge_question' ? '知识库问答' : mode === 'customer_reply' ? '客户接待' : '企业 AI 助手'}</h1>
              <p>直接提问或上传文本，AI 结合企业知识给出答案；也可安排个人提醒。</p>
            </div>
            {onRemind ? <button className="hesc-action" type="button" onClick={() => onRemind(composer)}>定时提醒</button> : null}
            <span className="hesc-status" data-tone={models.length > 0 ? 'success' : error ? 'error' : 'warning'}>
              {loadingModels ? '正在加载模型' : models.length > 0 ? '企业模型已就绪' : modelLoadFailed ? '正在恢复模型连接' : '等待企业配置'}
            </span>
          </header>
        )}

        <main className={separatedNavigation ? 'hesc-ai-chat-column' : undefined}>
          {separatedNavigation ? (
            <div className="hesc-ai-chat-toolbar">
              <label className="hesc-ai-select-label" htmlFor="assistant-active-model">当前模型
                <select id="assistant-active-model" disabled={loadingModels || models.length === 0} value={selectedConfigurationId} onChange={event => setSelectedConfigurationId(event.target.value)}>
                  {defaultModel ? <option value="">企业默认 · {defaultModel.model}</option> : null}
                  {models.map(model => <option key={model.configuration_id} value={model.configuration_id}>{modelLabel(model)}</option>)}
                </select>
              </label>
              <label className="hesc-ai-select-label" htmlFor="assistant-active-persona">当前人设
                <select id="assistant-active-persona" disabled={personas.length === 0} value={selectedPersonaId} onChange={event => setSelectedPersonaId(event.target.value)}>
                  {personas.map(persona => <option key={persona.persona_id} value={persona.persona_id}>{persona.name}</option>)}
                </select>
              </label>
              <span className="hesc-status" data-tone={models.length > 0 ? 'success' : error ? 'error' : 'warning'}>
                {loadingModels ? '正在加载模型' : models.length > 0 ? '企业模型已就绪' : modelLoadFailed ? '正在恢复模型连接' : '等待企业配置'}
              </span>
              {onRemind ? <button className="hesc-action" type="button" onClick={() => onRemind(composer)}>定时提醒</button> : null}
            </div>
          ) : null}
          <div className="hesc-assistant-layout hesc-tenant-ai-layout" style={separatedNavigation ? { gridTemplateColumns: 'minmax(0, 1fr)' } : undefined}>
        {!separatedNavigation ? <>
        <aside aria-label="AI 处理方式" className="hesc-card hesc-assistant-sessions hesc-ai-tools">
          <div className="hesc-section-heading">
            <div>
              <h2 className="hesc-section-title">处理方式</h2>
              <p className="hesc-muted-copy">对话、文本处理、知识检索与提醒协作均使用服务端权限。</p>
            </div>
          </div>
          <div className="hesc-agent-session-list" role="list">
            {(Object.keys(MODE_COPY) as AssistantMode[]).filter(item => !separatedNavigation || (mode === 'customer_reply' || mode === 'knowledge_question' ? item === mode : item !== 'customer_reply' && item !== 'knowledge_question')).map(item => (
              <button
                aria-current={mode === item ? 'true' : undefined}
                  disabled={frozen || submitting}
                key={item}
                  onClick={() => {
                    if ($enterprisePackageInstallFrozen.get()) {return}
                  setMode(item)
                }}
                type="button"
              >
                <strong>{MODE_COPY[item].label}</strong>
                <span>
                  {item === 'customer_reply'
                    ? '客户上下文＋企业知识，人工发送'
                    : item === 'knowledge_question'
                      ? '仅检索本企业已入库知识'
                      : '由企业选定模型完成'}
                </span>
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
                <option value="">
                  企业默认 · {defaultModel.provider} · {defaultModel.model}
                </option>
              ) : null}
              {models.map(model => (
                <option key={model.configuration_id} value={model.configuration_id}>
                  {modelLabel(model)}
                </option>
              ))}
            </select>
          </label>
          <p className="hesc-muted-copy">
            {!selectedConfigurationId || selectedModel?.is_default
              ? '未另行选择时，服务端会使用企业默认模型。'
              : '本次将使用你选择的企业授权模型。'}
          </p>

          <label className="hesc-ai-select-label" htmlFor="tenant-ai-persona">
            当前人设
            <select
              disabled={personas.length === 0}
              id="tenant-ai-persona"
              onChange={event => setSelectedPersonaId(event.target.value)}
              value={selectedPersonaId}
            >
              {personas.map(persona => <option key={persona.persona_id} value={persona.persona_id}>{persona.name}</option>)}
            </select>
          </label>
          <p className="hesc-muted-copy">{selectedPersona?.description ?? (personas.length ? '请选择企业管理员维护的人设。' : '企业管理员尚未设置默认人设，请先在“人设设置”中创建并指定。')}</p>

          <div className="hesc-ai-reminder-note">
            <strong>企业微信接入</strong>
            <span>保留坐席好友私聊入口。粘贴当前客户上下文、生成并审核建议，再到企业微信发送。</span>
          </div>

          <div className="hesc-ai-reminder-note">
            <strong>定时提醒</strong>
            <span>点击“定时提醒”，或输入“明天九点提醒我……”；核对 AI 整理的事项和时间后创建。</span>
          </div>
        </aside></> : null}

        {mode === 'customer_reply' ? (
          <CustomerReplyWorkspace
            configurationId={selectedConfigurationId || undefined}
            ready={!loadingModels && models.length > 0}
            runtime={runtime}
            workspace={session.customerReply}
          />
        ) : (
          <article className="hesc-card hesc-agent-transcript">
            <div className="hesc-section-heading">
              <div>
                <h2 className="hesc-section-title">{MODE_COPY[mode].label}</h2>
                <p className="hesc-muted-copy">
                  {mode === 'knowledge_question'
                    ? '直接描述遇到的问题，AI 会结合企业知识给出答案和处理步骤。'
                    : '直接提问，AI 会结合企业知识帮助你分析、解答和处理工作问题。'}
                </p>
              </div>
              {submitting ? (
                <span className="hesc-status" data-tone="warning">
                  正在处理
                </span>
              ) : null}
            </div>

            <div aria-live="polite" className="hesc-agent-messages" onScroll={updateTranscriptScrollIntent} ref={messagesRef}>
              {messages.length === 0 ? (
                <p className="hesc-muted-copy">{web.enabled ? web.words.session : '直接输入问题即可开始，也可以让 AI 摘要、改写或整理待办。对话仅保留在当前已登录客户端会话中。'}</p>
              ) : null}
              {messages.map(message => (
                <div className="hesc-agent-message" data-role={message.role} key={message.id}>
                  <span>{message.role === 'user' ? '你' : '企业 AI 助理'}</span>
                  {message.role === 'assistant' ? (
                    <>
                      <AssistantResponseDetails
                        knowledgeTrace={message.knowledgeTrace}
                        reasoningSummary={message.reasoningSummary}
                      />
                      <AssistantReplyCard text={message.text} />
                      <AssistantResponseDetails customerReplyOptions={supplementaryReplyOptions(message.text, message.customerReplyOptions)} />
                    </>
                  ) : (
                    <p>{message.text}</p>
                  )}
                </div>
              ))}
            </div>

            <form className="hesc-agent-composer" onSubmit={event => void submit(event)}>
              <label htmlFor="enterprise-ai-composer">{fileText ? '可补充处理要求' : '输入内容'}</label>
              <textarea
                disabled={frozen || submitting || loadingModels || models.length === 0 || !personaReady}
                id="enterprise-ai-composer"
                onChange={event => { if (!$enterprisePackageInstallFrozen.get()) {setComposer(event.target.value)} }}
                onKeyDown={submitComposerOnEnter}
                placeholder={`${MODE_COPY[mode].placeholder}（Enter 发送，Shift+Enter 换行）`}
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
                <button
                  className="hesc-action hesc-action-secondary"
                  onClick={() => fileInputRef.current?.click()}
                  type="button"
                >
                  选择本地文本文件
                </button>
                {fileName ? <span>已选择：{fileName}</span> : <span>选择后在本机读取，提交后交由企业 AI 处理。</span>}
                {fileName ? (
                  <button className="hesc-text-action" onClick={clearAttachment} type="button">
                    移除
                  </button>
                ) : null}
              </div>
              <div>
                <span>{web.enabled ? 'DOC、DOCX、PDF 请先上传企业知识库。' : 'DOC、DOCX、PDF 请先上传企业知识库；模型密钥不会写入客户端或日志。'}</span>
                <button
                  className="hesc-action"
                  disabled={
                    submitting || loadingModels || models.length === 0 || !personaReady || (!composer.trim() && !fileText)
                  }
                  type="submit"
                >
                  {submitting ? '正在处理' : '提交处理'}
                </button>
              </div>
            </form>
          </article>
        )}
          </div>
        </main>
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
