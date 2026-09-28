import { atom, type WritableAtom } from 'nanostores'

import {
  createCustomerReplyWorkspace,
  type CustomerReplyWorkspaceStore,
  invalidateCustomerReplies,
  retireCustomerReplyWorkspace
} from './customer-reply'
import { retireCustomerReplyFeedback } from './customer-reply-feedback'
import { stopCustomerDraftSync } from './customer-reply-persistence'
import { bindCustomerReplyPreferences } from './enterprise-reply-preferences'
import type { EnterpriseClientRuntime } from './runtime'
import type { CustomerReplyOption, KnowledgeTrace } from './assistant-response'

export type AssistantMode =
  'customer_reply' | 'chat' | 'extract_action_items' | 'knowledge_question' | 'rewrite' | 'summarize'

export interface ConversationMessage {
  customerReplyOptions?: CustomerReplyOption[]
  id: string
  knowledgeTrace?: KnowledgeTrace
  reasoningSummary?: string
  role: 'assistant' | 'user'
  text: string
}

export interface AssistantConversation {
  id: string
  messages: WritableAtom<ConversationMessage[]>
  title: string
  work: WritableAtom<AssistantLocalWork>
}

export interface AssistantSession {
  customerReply: CustomerReplyWorkspaceStore
  activeChatThreadId: WritableAtom<string>
  chatThreads: WritableAtom<AssistantConversation[]>
  disposeChatPersistence?: () => void
  id: number
  messages: WritableAtom<ConversationMessage[]>
  conversations: Record<AssistantMode, AssistantConversation>
  mode: WritableAtom<AssistantMode>
  scope: string
}

export interface AssistantLocalWork {
  composer: string
  fileName: string | null
  fileText: string | null
  readingFile: boolean
  submitting: boolean
}

// Runtime identity is one authenticated main-process session. Navigation may
// reuse it; another login, principal or tenant must never reuse its drafts.
const sessions = new WeakMap<EnterpriseClientRuntime, AssistantSession>()
let nextSessionId = 0
let nextConversationId = 0
const CHAT_SESSION_STORAGE_PREFIX = 'hermes.enterprise.assistant.chat.v1:'
const MAX_STORED_CHAT_THREADS = 50
const MAX_STORED_CHAT_MESSAGES = 300

const MODE_TITLES: Record<Exclude<AssistantMode, 'chat'>, string> = {
  customer_reply: '客户回复建议',
  extract_action_items: '提取待办',
  knowledge_question: '知识库问答',
  rewrite: '文本改写',
  summarize: '文本摘要'
}

interface StoredAssistantConversation {
  id: string
  messages: ConversationMessage[]
  title: string
}

interface StoredAssistantChatState {
  activeThreadId: string | null
  threads: StoredAssistantConversation[]
}

function sessionStorageForChats(): Storage | null {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

function chatStorageKey(scope: string): string {
  return `${CHAT_SESSION_STORAGE_PREFIX}${scope}`
}

function normalizeStoredMessage(value: unknown): ConversationMessage | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const candidate = value as Partial<ConversationMessage>
  if ((candidate.role !== 'assistant' && candidate.role !== 'user') ||
      typeof candidate.id !== 'string' || !candidate.id ||
      typeof candidate.text !== 'string') {
    return null
  }

  const trace = candidate.knowledgeTrace
  const resultCount = trace?.resultCount
  const candidateCount = trace?.candidateCount
  const bestSimilarity = trace?.bestSimilarity
  const similarityThreshold = trace?.similarityThreshold
  const traceStatus = trace?.status
  const reasoningSummary = typeof candidate.reasoningSummary === 'string'
    ? candidate.reasoningSummary.slice(0, 800)
    : ''
  const customerReplyOptions = Array.isArray(candidate.customerReplyOptions)
    ? candidate.customerReplyOptions.slice(0, 3).flatMap(option => {
      if (!option || typeof option !== 'object') {
        return []
      }
      const item = option as Partial<CustomerReplyOption>
      return (item.kind === 'current_reply' || item.kind === 'follow_up' || item.kind === 'alternative_reply') &&
        typeof item.text === 'string' && item.text.trim()
        ? [{ kind: item.kind, text: item.text.trim().slice(0, 2000) }]
        : []
    })
    : []
  return {
    id: candidate.id.slice(0, 128),
    role: candidate.role,
    text: candidate.text.slice(0, 80_000),
    ...(reasoningSummary ? { reasoningSummary } : {}),
    ...(customerReplyOptions.length ? { customerReplyOptions } : {}),
    ...(typeof resultCount === 'number' && Number.isFinite(resultCount)
      ? { knowledgeTrace: {
        resultCount: Math.max(0, Math.floor(resultCount)),
        candidateCount: typeof candidateCount === 'number' && Number.isFinite(candidateCount)
          ? Math.max(0, Math.floor(candidateCount)) : 0,
        ...(typeof bestSimilarity === 'number' && Number.isFinite(bestSimilarity)
          ? { bestSimilarity: Math.max(0, Math.min(1, bestSimilarity)) } : {}),
        ...(typeof similarityThreshold === 'number' && Number.isFinite(similarityThreshold)
          ? { similarityThreshold: Math.max(0, Math.min(1, similarityThreshold)) } : {}),
        ...(typeof traceStatus === 'string' ? { status: traceStatus.slice(0, 48) } : {})
      } }
      : {})
  }
}

function loadStoredChatState(scope: string): StoredAssistantChatState {
  const storage = sessionStorageForChats()
  if (!storage) {
    return { activeThreadId: null, threads: [] }
  }

  try {
    const parsed: unknown = JSON.parse(storage.getItem(chatStorageKey(scope)) ?? 'null')
    if (!parsed || typeof parsed !== 'object') {
      return { activeThreadId: null, threads: [] }
    }

    const candidate = parsed as { activeThreadId?: unknown; threads?: unknown }
    const threads = Array.isArray(candidate.threads) ? candidate.threads.slice(0, MAX_STORED_CHAT_THREADS).flatMap(raw => {
      if (!raw || typeof raw !== 'object') {
        return []
      }

      const thread = raw as { id?: unknown; messages?: unknown; title?: unknown }
      if (typeof thread.id !== 'string' || !thread.id || typeof thread.title !== 'string') {
        return []
      }

      const messages = Array.isArray(thread.messages)
        ? thread.messages.slice(-MAX_STORED_CHAT_MESSAGES)
          .map(normalizeStoredMessage)
          .filter((message): message is ConversationMessage => message !== null)
        : []
      return [{ id: thread.id.slice(0, 128), messages, title: thread.title.slice(0, 64) || '新对话' }]
    }) : []

    return {
      activeThreadId: typeof candidate.activeThreadId === 'string' ? candidate.activeThreadId : null,
      threads
    }
  } catch {
    return { activeThreadId: null, threads: [] }
  }
}

function persistChatState(session: AssistantSession): void {
  const storage = sessionStorageForChats()
  if (!storage) {
    return
  }

  const state: StoredAssistantChatState = {
    activeThreadId: session.activeChatThreadId.get(),
    threads: session.chatThreads.get().slice(0, MAX_STORED_CHAT_THREADS).map(thread => ({
      id: thread.id,
      messages: thread.messages.get().slice(-MAX_STORED_CHAT_MESSAGES),
      title: thread.title
    }))
  }

  try {
    storage.setItem(chatStorageKey(session.scope), JSON.stringify(state))
  } catch {
    // Storage is a convenience only. A privacy mode or full quota must never
    // stop the authenticated assistant from answering.
  }
}

function bindChatPersistence(session: AssistantSession): () => void {
  const unlistenMessages = new Map<AssistantConversation, () => void>()
  const sync = () => {
    const current = new Set(session.chatThreads.get())
    for (const [thread, dispose] of unlistenMessages) {
      if (!current.has(thread)) {
        dispose()
        unlistenMessages.delete(thread)
      }
    }
    for (const thread of current) {
      if (!unlistenMessages.has(thread)) {
        unlistenMessages.set(thread, thread.messages.listen(() => {persistChatState(session)}))
      }
    }
    persistChatState(session)
  }

  const unlistenThreads = session.chatThreads.listen(sync)
  const unlistenActiveThread = session.activeChatThreadId.listen(() => {persistChatState(session)})
  sync()

  return () => {
    unlistenThreads()
    unlistenActiveThread()
    for (const dispose of unlistenMessages.values()) {
      dispose()
    }
  }
}

function updateConversationCounter(id: string): void {
  const match = /^conversation-(\d+)$/.exec(id)
  if (match) {
    nextConversationId = Math.max(nextConversationId, Number(match[1]))
  }
}

function createConversation(title = '新对话', restored?: StoredAssistantConversation): AssistantConversation {
  const id = restored?.id || `conversation-${++nextConversationId}`
  updateConversationCounter(id)
  return {
    id,
    messages: atom<ConversationMessage[]>(restored?.messages ?? []),
    title,
    work: atom<AssistantLocalWork>({ composer: '', fileName: null, fileText: null, readingFile: false, submitting: false })
  }
}

export function createAssistantChatThread(session: AssistantSession): AssistantConversation {
  const thread = createConversation()
  session.chatThreads.set([...session.chatThreads.get(), thread])
  session.activeChatThreadId.set(thread.id)
  return thread
}

export function renameAssistantChatThread(session: AssistantSession, threadId: string, title: string): void {
  const normalized = title.trim().replace(/\s+/g, ' ').slice(0, 64)

  if (!normalized) {
    return
  }

  session.chatThreads.set(session.chatThreads.get().map(thread => (
    thread.id === threadId ? { ...thread, title: normalized } : thread
  )))
}

export function deleteAssistantChatThread(session: AssistantSession, threadId: string): void {
  const target = session.chatThreads.get().find(thread => thread.id === threadId)
  if (!target) {
    return
  }

  target.messages.set([])
  const remaining = session.chatThreads.get().filter(thread => thread.id !== threadId)
  const nextThreads = remaining.length ? remaining : [createConversation()]
  session.chatThreads.set(nextThreads)

  if (session.activeChatThreadId.get() === threadId) {
    session.activeChatThreadId.set(nextThreads[0]!.id)
  }
}

function releaseAssistantSessionInternal(
  runtime: EnterpriseClientRuntime | null,
  preserveChatHistoryForPageReload: boolean
): void {
  if (!runtime) {
    return
  }

  const existing = sessions.get(runtime)

  if (existing) {
    existing.disposeChatPersistence?.()
    if (!preserveChatHistoryForPageReload) {
      try {
        sessionStorageForChats()?.removeItem(chatStorageKey(existing.scope))
      } catch {
        // Nothing to clear when storage is unavailable.
      }
    }
    retireCustomerReplyFeedback(existing.customerReply)
    stopCustomerDraftSync(existing.customerReply)
    invalidateCustomerReplies(existing.customerReply)
    existing.messages.set([])
    const conversations = new Set([
      ...Object.values(existing.conversations),
      ...existing.chatThreads.get()
    ])
    for (const conversation of conversations) {
      conversation.messages.set([])
      conversation.work.set({ composer: '', fileName: null, fileText: null, readingFile: false, submitting: false })
    }
    sessions.delete(runtime)
  }
}

/** Explicit sign-out/login switch: do not retain prior employee messages. */
export function releaseAssistantSession(runtime: EnterpriseClientRuntime | null): void {
  releaseAssistantSessionInternal(runtime, false)
}

/** Browser reload preserves records only for the authenticated scope in this tab. */
export function preserveAssistantSessionForPageReload(runtime: EnterpriseClientRuntime | null): void {
  releaseAssistantSessionInternal(runtime, true)
}

export function assistantSessionFor(
  runtime: EnterpriseClientRuntime | null,
  tenantId?: string,
  principalId?: string,
  persistChatHistory = false
): AssistantSession {
  const scope = JSON.stringify([tenantId ?? null, principalId ?? null])
  const existing = runtime ? sessions.get(runtime) : undefined

  if (existing?.scope === scope) {
    return existing
  }

  // Session selection can run during render. Revoke pending work immediately
  // without notifying subscribers on the old, about-to-unmount surface.
  if (existing) {
    retireCustomerReplyFeedback(existing.customerReply)
    stopCustomerDraftSync(existing.customerReply)
    retireCustomerReplyWorkspace(existing.customerReply)
  }

  const customerReply = createCustomerReplyWorkspace()
  bindCustomerReplyPreferences(customerReply, runtime?.serverOrigin, tenantId, principalId)

  const restoredChatState = runtime && persistChatHistory
    ? loadStoredChatState(scope)
    : { activeThreadId: null, threads: [] }
  const restoredChats = restoredChatState.threads.map(thread => createConversation(thread.title, thread))
  const chat = restoredChats[0] ?? createConversation()
  const chatThreads = restoredChats.length ? restoredChats : [chat]
  const activeChatThreadId = chatThreads.some(thread => thread.id === restoredChatState.activeThreadId)
    ? restoredChatState.activeThreadId as string
    : chat.id
  const conversations = Object.fromEntries(
    (['customer_reply', 'summarize', 'rewrite', 'extract_action_items', 'knowledge_question'] as const).map(mode => [mode, createConversation(MODE_TITLES[mode])])
  ) as Omit<AssistantSession['conversations'], 'chat'>
  const session: AssistantSession = {
    activeChatThreadId: atom(activeChatThreadId),
    chatThreads: atom<AssistantConversation[]>(chatThreads),
    customerReply,
    id: ++nextSessionId,
    messages: chat.messages,
    conversations: { ...conversations, chat },
    mode: atom<AssistantMode>('chat'),
    scope
  }

  if (runtime) {
    if (persistChatHistory) {
      session.disposeChatPersistence = bindChatPersistence(session)
    }
    sessions.set(runtime, session)
  }

  return session
}
