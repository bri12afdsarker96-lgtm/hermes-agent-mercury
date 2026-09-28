import { expect, it, vi } from 'vitest'
import {
  assistantSessionFor,
  createAssistantChatThread,
  deleteAssistantChatThread,
  preserveAssistantSessionForPageReload,
  releaseAssistantSession,
  renameAssistantChatThread
} from './assistant-session'

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
