import { expect, it, vi } from 'vitest'
import {
  assistantSessionFor,
  createAssistantChatThread,
  deleteAssistantChatThread,
  preserveAssistantSessionForPageReload,
  releaseAssistantSession,
  renameAssistantChatThread,
  restartAssistantMode
} from './assistant-session'

const choice = { backend_id: 'tenant_model' as const, configuration_id: 'owned', configuration_version: 4,
  model: 'model', runtime_protocol: 'openai_chat_completions', reasoning_effort: null, availability: 'available' as const }

it('retains an in-flight choice and uncertainty across reload without restoring submitting state', () => {
  const runtime = { get: vi.fn(), disconnect: vi.fn() }
  const first = assistantSessionFor(runtime, 'pending-tenant', 'pending-seat', true)
  first.conversations.chat.backendChoice.set(choice)
  first.conversations.chat.outcomeUnknown.set(true)
  first.conversations.chat.work.set({ ...first.conversations.chat.work.get(), submitting: true })
  preserveAssistantSessionForPageReload(runtime)
  const nextRuntime = { get: vi.fn(), disconnect: vi.fn() }
  const next = assistantSessionFor(nextRuntime, 'pending-tenant', 'pending-seat', true)
  expect(next.conversations.chat.backendChoice.get()).toEqual(choice)
  expect(next.conversations.chat.outcomeUnknown.get()).toBe(true)
  expect(next.conversations.chat.work.get().submitting).toBe(false)
  releaseAssistantSession(nextRuntime)
})

it('starts a fresh text operation and preserves its unknown record using existing chat history', () => {
  const runtime = { get: vi.fn(), disconnect: vi.fn() }
  const session = assistantSessionFor(runtime, 'restart-tenant', 'restart-seat')
  const operation = session.conversations.summarize
  operation.messages.set([{ id: 'unconfirmed', role: 'user', text: '旧文本' }])
  operation.backendChoice.set(choice)
  operation.outcomeUnknown.set(true)
  restartAssistantMode(session, 'summarize')
  expect(operation.backendChoice.get()).toBeNull()
  expect(operation.outcomeUnknown.get()).toBe(false)
  expect(operation.messages.get()).toEqual([])
  expect(session.chatThreads.get().at(-1)?.outcomeUnknown.get()).toBe(true)
  expect(session.chatThreads.get().at(-1)?.messages.get()[0]?.text).toBe('旧文本')
  releaseAssistantSession(runtime)
})

it('restores each customer binding only to its matching customer within the same identity', () => {
  const runtime = { get: vi.fn(), disconnect: vi.fn() }
  const first = assistantSessionFor(runtime, 'customer-tenant', 'customer-seat', true)
  const customer = first.customerReply.get().customers[0]!
  customer.reply.set({ ...customer.reply.get(), backendChoice: choice, outcomeUnknown: true })
  preserveAssistantSessionForPageReload(runtime)
  const nextRuntime = { get: vi.fn(), disconnect: vi.fn() }
  const next = assistantSessionFor(nextRuntime, 'customer-tenant', 'customer-seat', true)
  const replacement = next.customerReply.get().customers[0]!
  expect(replacement.reply.get().backendChoice).toBeUndefined()
  next.customerReply.set({ ...next.customerReply.get(), customers: [{ ...replacement, id: customer.id }] })
  expect(replacement.reply.get().backendChoice).toEqual(choice)
  expect(replacement.reply.get().outcomeUnknown).toBe(true)
  releaseAssistantSession(nextRuntime)
})

it('keeps mode drafts and transcripts separate, retains same-session navigation, and clears logout', () => {
  const runtime = { get: vi.fn(), disconnect: vi.fn() }
  const session = assistantSessionFor(runtime, 'tenant', 'operator')
  session.conversations.chat.messages.set([{id:'one', role:'assistant', text:'普通问答'}])
  session.conversations.knowledge_question.work.set({...session.conversations.knowledge_question.work.get(),composer:'知识问题'})
  expect(session.conversations.knowledge_question.messages.get()).toEqual([])
  expect(session.conversations.chat.work.get().composer).toBe('')
  expect(assistantSessionFor(runtime,'tenant','operator')).toBe(session)
  releaseAssistantSession(runtime)
  expect(session.conversations.chat.messages.get()).toEqual([])
  expect(assistantSessionFor(runtime,'tenant','operator').conversations.knowledge_question.work.get().composer).toBe('')
})

it('keeps separately named chat threads within the authenticated client session only', () => {
  const runtime = { get: vi.fn(), disconnect: vi.fn() }
  const session = assistantSessionFor(runtime, 'tenant', 'operator')
  const first = session.chatThreads.get()[0]!
  first.messages.set([{ id: 'one', role: 'user', text: '第一条问题' }])
  renameAssistantChatThread(session, first.id, '退款处理')
  const second = createAssistantChatThread(session)

  expect(session.chatThreads.get()).toHaveLength(2)
  expect(session.activeChatThreadId.get()).toBe(second.id)
  expect(session.chatThreads.get()[0]?.title).toBe('退款处理')

  releaseAssistantSession(runtime)
  expect(first.messages.get()).toEqual([])
  expect(second.messages.get()).toEqual([])
})

it('deletes a selected chat record and leaves one blank record when the last one is removed', () => {
  const runtime = { get: vi.fn(), disconnect: vi.fn() }
  const session = assistantSessionFor(runtime, 'tenant-delete', 'operator-delete')
  const first = session.chatThreads.get()[0]!
  first.messages.set([{ id: 'one', role: 'user', text: '删除的对话' }])
  const second = createAssistantChatThread(session)

  deleteAssistantChatThread(session, second.id)
  expect(session.chatThreads.get()).toEqual([first])
  expect(session.activeChatThreadId.get()).toBe(first.id)

  deleteAssistantChatThread(session, first.id)
  expect(session.chatThreads.get()).toHaveLength(1)
  expect(session.chatThreads.get()[0]?.messages.get()).toEqual([])
  releaseAssistantSession(runtime)
})

it('keeps chat records for a page reload, scoped to the same tenant and employee', () => {
  const firstRuntime = { get: vi.fn(), disconnect: vi.fn() }
  const firstSession = assistantSessionFor(firstRuntime, 'tenant-refresh', 'operator-refresh', true)
  const firstThread = firstSession.chatThreads.get()[0]!
  firstThread.messages.set([{ id: 'refresh-message', role: 'user', text: '刷新后仍可继续的问题' }])
  renameAssistantChatThread(firstSession, firstThread.id, '需要跟进的客户')

  preserveAssistantSessionForPageReload(firstRuntime)

  const refreshedRuntime = { get: vi.fn(), disconnect: vi.fn() }
  const refreshedSession = assistantSessionFor(refreshedRuntime, 'tenant-refresh', 'operator-refresh', true)
  expect(refreshedSession.chatThreads.get()[0]?.title).toBe('需要跟进的客户')
  expect(refreshedSession.chatThreads.get()[0]?.messages.get()).toEqual([
    { id: 'refresh-message', role: 'user', text: '刷新后仍可继续的问题' }
  ])
  expect(assistantSessionFor({ get: vi.fn(), disconnect: vi.fn() }, 'another-tenant', 'another-operator').chatThreads.get()[0]?.messages.get()).toEqual([])

  releaseAssistantSession(refreshedRuntime)
})
