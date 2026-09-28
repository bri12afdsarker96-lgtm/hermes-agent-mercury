import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { assistantSessionFor, releaseAssistantSession } from './assistant-session'
import {
  addCustomerReply,
  confirmCustomerMemory,
  createCustomerReplyWorkspace,
  type CustomerReplyWorkspaceStore,
  updateCustomerMemoryDraft,
  updateCustomerReplyInput
} from './customer-reply'
import {
  customerDraftSyncFor,
  flushCustomerDrafts,
  flushCustomerDraftsForRequest,
  reloadCustomerDrafts,
  saveCustomerDrafts,
  startCustomerDraftSync,
  stopCustomerDraftSync
} from './customer-reply-persistence'
import { prepareEnterprisePackageInstall, releaseEnterprisePackageInstall } from './enterprise-install-readiness'
import type { EnterpriseClientRuntime } from './runtime'
import { enterpriseClientErrorForStatus } from './runtime-errors'

interface Row {
  revision: number
  workspace: unknown
  updated_at: number | null
}

function server() {
  const rows = new Map<string, Row>()

  return {
    runtime(identity: string) {
      return {
        disconnect: vi.fn(),
        get: vi.fn(async () =>
          structuredClone(rows.get(identity) ?? { revision: 0, workspace: null, updated_at: null })
        ),
        post: vi.fn(async (_path: string, body: { expected_revision: number; workspace: unknown }) => {
          const revision = rows.get(identity)?.revision ?? 0

          if (revision !== body.expected_revision) {
            throw enterpriseClientErrorForStatus(409)
          }

          const row = { revision: revision + 1, workspace: structuredClone(body.workspace), updated_at: 1 }
          rows.set(identity, row)

          return structuredClone(row)
        })
      } as unknown as EnterpriseClientRuntime
    },
    rows
  }
}

const workspaces: CustomerReplyWorkspaceStore[] = []

function workspace() {
  const value = createCustomerReplyWorkspace()
  workspaces.push(value)

  return value
}

async function start(value: CustomerReplyWorkspaceStore, runtime: EnterpriseClientRuntime) {
  startCustomerDraftSync(value, runtime)
  await Promise.resolve()
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  releaseEnterprisePackageInstall()
  workspaces.forEach(stopCustomerDraftSync)
  workspaces.length = 0
  vi.useRealTimers()
})

describe('customer draft durability', () => {
  it('keeps an unconfirmed memory local across customer switches and blocks installation without storing it', async () => {
    const remote = server()
    const value = workspace()
    await start(value, remote.runtime('tenant/seat'))
    const first = value.get().customers[0]
    updateCustomerMemoryDraft(first.reply, '尚未确认的客户资料')
    addCustomerReply(value)
    await flushCustomerDraftsForRequest(value)
    expect(JSON.stringify(remote.rows.get('tenant/seat'))).not.toContain('尚未确认')
    expect(first.reply.get().memoryDraft).toContain('尚未确认')
    const install = await prepareEnterprisePackageInstall('unconfirmed-memory')
    expect(install.ready).toBe(false)
    expect(install.reasons.join('')).toContain('记忆尚未确认')
  })

  it('acknowledges only the confirmed note and restores it after restart, including explicit deletion', async () => {
    const remote = server()
    const value = workspace()
    await start(value, remote.runtime('tenant/seat'))
    const reply = value.get().customers[0].reply
    updateCustomerMemoryDraft(reply, '客户明确要求称呼李老师')
    await confirmCustomerMemory(value, reply)
    expect(reply.get().memoryPending).toBe(false)
    expect(reply.get().memoryConfirmedAt).toMatch(/Z$/)
    const restored = workspace()
    await start(restored, remote.runtime('tenant/seat'))
    const next = restored.get().customers[0].reply
    expect(next.get()).toMatchObject({ memoryNote: '客户明确要求称呼李老师', memoryDraft: '客户明确要求称呼李老师', memoryPending: false })
    await confirmCustomerMemory(restored, next, true)
    const deleted = workspace()
    await start(deleted, remote.runtime('tenant/seat'))
    expect(deleted.get().customers[0].reply.get()).toMatchObject({ memoryNote: '', memoryDraft: '', memoryConfirmedAt: null, memoryPending: false })
  })

  it('fails a legacy server ack that drops memory and keeps pending text for an explicit retry', async () => {
    const runtime = server().runtime('tenant/seat')
    vi.mocked(runtime.post!).mockImplementationOnce(async (_path, body) => {
      const submitted = body as { workspace: { customers: Array<Record<string, unknown>> } }
      const legacy = structuredClone(submitted.workspace)

      for (const customer of legacy.customers) { delete customer.memoryNote; delete customer.memoryConfirmedAt }

      return { revision: 1, workspace: legacy, updated_at: 1 }
    })
    const value = workspace()
    await start(value, runtime)
    const reply = value.get().customers[0].reply
    updateCustomerMemoryDraft(reply, '不能丢失的确认内容')
    await confirmCustomerMemory(value, reply)
    expect(reply.get()).toMatchObject({ memoryDraft: '不能丢失的确认内容', memoryPending: true })
    expect(customerDraftSyncFor(value).get().phase).toBe('error')
    await expect(flushCustomerDraftsForRequest(value)).rejects.toThrow()
    await saveCustomerDrafts(value)
    expect(reply.get().memoryPending).toBe(false)
  })

  it('leaves edits made during confirmation unconfirmed and does not replace them with the old ack', async () => {
    const runtime = server().runtime('tenant/seat')
    const original = vi.mocked(runtime.post!).getMockImplementation()!
    let release!: () => Promise<void>
    vi.mocked(runtime.post!).mockImplementationOnce((path, body) => new Promise(resolve => { release = async () => resolve(await original(path, body)) }))
    const value = workspace()
    await start(value, runtime)
    const reply = value.get().customers[0].reply
    updateCustomerMemoryDraft(reply, '本次确认')
    const pending = confirmCustomerMemory(value, reply)
    expect(reply.get().memoryPending).toBe(true)
    updateCustomerMemoryDraft(reply, '确认过程中继续编辑')
    await release()
    await pending
    expect(reply.get()).toMatchObject({ memoryNote: '本次确认', memoryDraft: '确认过程中继续编辑', memoryPending: false })
    expect((await prepareEnterprisePackageInstall('late-memory-edit')).ready).toBe(false)
  })

  it('hydrates the legacy schema as empty memory and accepts the server UTC timestamp contract', async () => {
    const remote = server()
    const first = workspace()
    await start(first, remote.runtime('tenant/seat'))
    await saveCustomerDrafts(first)
    const row = remote.rows.get('tenant/seat')!
    const stored = row.workspace as { customers: Array<Record<string, unknown>> }
    delete stored.customers[0].memoryNote
    delete stored.customers[0].memoryConfirmedAt
    const restored = workspace()
    await start(restored, remote.runtime('tenant/seat'))
    expect(restored.get().customers[0].reply.get().memoryNote).toBe('')
    stored.customers[0].memoryNote = '合法 UTC 来源'
    stored.customers[0].memoryConfirmedAt = '2026-09-06T00:00:00.123456789+00:00'
    await reloadCustomerDrafts(restored)
    expect(customerDraftSyncFor(restored).get().loaded).toBe(true)
    expect(restored.get().customers[0].reply.get().memoryNote).toBe('合法 UTC 来源')
  })

  it('does not claim an unsaved initial workspace exists and honors an explicit reload after server expiry', async () => {
    const remote = server()
    const runtime = remote.runtime('tenant/seat')
    const value = workspace()
    await start(value, runtime)
    await saveCustomerDrafts(value)
    expect(runtime.post).toHaveBeenCalledTimes(1)
    updateCustomerReplyInput(value.get().customers[0].reply, 'context', '稍后服务器保留期结束')
    await saveCustomerDrafts(value)
    remote.rows.delete('tenant/seat')
    await reloadCustomerDrafts(value)
    expect(value.get().customers[0].reply.get().context).toBe('')
    expect(customerDraftSyncFor(value).get().message).toBe('草稿将在修改后自动保存')
  })

  it('restores a hundred independent customers after restart without restarting generation or copied state', async () => {
    const remote = server()
    const first = workspace()
    const runtime = remote.runtime('tenant-a/seat-a')
    await start(first, runtime)

    for (let index = 1; index < 100; index++) {
      addCustomerReply(first)
    }

    first.get().customers.forEach((customer, index) => {
      updateCustomerReplyInput(customer.reply, 'context', `客户私有上下文 ${index}`)
      customer.reply.set({
        ...customer.reply.get(),
        draft: `各自的草稿 ${index}`,
        knowledgeGrounded: true,
        copiedDraft: `各自的草稿 ${index}`,
        requestId: index === 0 ? 'interrupted-request' : null,
        phase: index === 0 ? 'generating' : null
      })
    })
    await vi.advanceTimersByTimeAsync(400)
    expect(runtime.post).toHaveBeenCalledTimes(1)
    expect(customerDraftSyncFor(first).get().phase).toBe('saved')
    stopCustomerDraftSync(first)
    const restored = workspace()
    const reconnected = remote.runtime('tenant-a/seat-a')
    await start(restored, reconnected)
    expect(restored.get().customers).toHaveLength(100)
    restored.get().customers.forEach((customer, index) => {
      expect(customer.reply.get().context).toBe(`客户私有上下文 ${index}`)
      expect(customer.reply.get().draft).toBe(`各自的草稿 ${index}`)
      expect(customer.reply.get().requestId).toBeNull()
      expect(customer.reply.get().copiedDraft).toBeNull()
    })
    expect(restored.get().customers[0].reply.get().error).toContain('上次生成已中断')
    expect(reconnected.post).not.toHaveBeenCalled()
    const otherTenant = workspace()
    const otherSeat = workspace()
    await start(otherTenant, remote.runtime('tenant-b/seat-a'))
    await start(otherSeat, remote.runtime('tenant-a/seat-b'))
    expect(otherTenant.get().customers[0].reply.get().context).toBe('')
    expect(otherSeat.get().customers[0].reply.get().context).toBe('')
  })

  it('keeps local edits on a two-device conflict and requires explicit reload before replacing them', async () => {
    const remote = server()
    const first = workspace()
    const second = workspace()
    const firstRuntime = remote.runtime('tenant/seat')
    const secondRuntime = remote.runtime('tenant/seat')
    await start(first, firstRuntime)
    await start(second, secondRuntime)
    updateCustomerReplyInput(first.get().customers[0].reply, 'context', '第一台设备已保存')
    await saveCustomerDrafts(first)
    updateCustomerReplyInput(second.get().customers[0].reply, 'context', '第二台设备未保存')
    await saveCustomerDrafts(second)
    expect(customerDraftSyncFor(second).get().phase).toBe('conflict')
    expect(second.get().customers[0].reply.get().context).toBe('第二台设备未保存')
    await saveCustomerDrafts(second)
    expect(secondRuntime.post).toHaveBeenCalledTimes(1)
    await reloadCustomerDrafts(second)
    expect(second.get().customers[0].reply.get().context).toBe('第一台设备已保存')
    updateCustomerReplyInput(second.get().customers[0].reply, 'context', '重新读取后编辑')
    await saveCustomerDrafts(second)
    expect(customerDraftSyncFor(second).get().phase).toBe('saved')
    expect(remote.rows.get('tenant/seat')?.revision).toBe(2)
  })

  it('does not overwrite anything when hydration fails and allows a bounded user retry', async () => {
    const runtime = server().runtime('tenant/seat')
    vi.mocked(runtime.get).mockRejectedValueOnce(new Error('网络中断'))
    const value = workspace()
    await start(value, runtime)
    expect(customerDraftSyncFor(value).get()).toMatchObject({ loaded: false, phase: 'error' })
    updateCustomerReplyInput(value.get().customers[0].reply, 'context', '不能盲覆盖服务器')
    await saveCustomerDrafts(value)
    expect(runtime.post).not.toHaveBeenCalled()
    await reloadCustomerDrafts(value)
    expect(customerDraftSyncFor(value).get().loaded).toBe(true)
  })

  it('keeps failed saves dirty and saves the same user content only after retry', async () => {
    const runtime = server().runtime('tenant/seat')
    vi.mocked(runtime.post!).mockRejectedValueOnce(new Error('网络中断'))
    const value = workspace()
    await start(value, runtime)
    updateCustomerReplyInput(value.get().customers[0].reply, 'context', '等待重试的内容')
    await vi.advanceTimersByTimeAsync(400)
    expect(customerDraftSyncFor(value).get().phase).toBe('error')
    expect(value.get().customers[0].reply.get().context).toBe('等待重试的内容')
    await vi.advanceTimersByTimeAsync(5000)
    expect(runtime.post).toHaveBeenCalledTimes(1)
    await saveCustomerDrafts(value)
    expect(customerDraftSyncFor(value).get().phase).toBe('saved')
  })

  it('does not save the empty cleanup on logout or apply a late hydration result to a retired account', async () => {
    const remote = server()
    const runtime = remote.runtime('tenant/seat')
    const value = assistantSessionFor(runtime, 'tenant', 'seat').customerReply
    workspaces.push(value)
    await start(value, runtime)
    updateCustomerReplyInput(value.get().customers[0].reply, 'context', '应该保留的持久草稿')
    await saveCustomerDrafts(value)
    releaseAssistantSession(runtime)
    await vi.advanceTimersByTimeAsync(5000)
    expect(runtime.post).toHaveBeenCalledTimes(1)
    const restored = workspace()
    await start(restored, remote.runtime('tenant/seat'))
    expect(restored.get().customers[0].reply.get().context).toBe('应该保留的持久草稿')

    let resolve!: (row: unknown) => void
    const delayed = remote.runtime('tenant/seat')
    vi.mocked(delayed.get).mockReturnValue(
      new Promise(done => {
        resolve = done
      })
    )
    const old = workspace()
    startCustomerDraftSync(old, delayed)
    stopCustomerDraftSync(old)
    resolve(remote.rows.get('tenant/seat'))
    await Promise.resolve()
    expect(old.get().customers[0].reply.get().context).toBe('')
  })

  it('serializes saves when input changes while a previous save is in flight', async () => {
    const remote = server()
    const runtime = remote.runtime('tenant/seat')
    const originalPost = vi.mocked(runtime.post!).getMockImplementation()!
    let resolve!: (row: unknown) => void
    vi.mocked(runtime.post!).mockImplementationOnce(
      (_path, body) =>
        new Promise(done => {
          resolve = async () => done(await originalPost('/api/customer-reply-workspace', body))
        })
    )
    const value = workspace()
    await start(value, runtime)
    updateCustomerReplyInput(value.get().customers[0].reply, 'context', '第一次保存')
    const saving = saveCustomerDrafts(value)
    updateCustomerReplyInput(value.get().customers[0].reply, 'context', '请求过程中继续编辑')
    const sameSave = saveCustomerDrafts(value)
    expect(sameSave).toBe(saving)
    expect(runtime.post).toHaveBeenCalledTimes(1)
    resolve(undefined)
    await saving
    await vi.advanceTimersByTimeAsync(400)
    expect(runtime.post).toHaveBeenCalledTimes(2)
    expect(remote.rows.get('tenant/seat')?.revision).toBe(2)
    expect(JSON.stringify(remote.rows.get('tenant/seat'))).toContain('请求过程中继续编辑')
  })

  it('flushes the last sub-debounce edit and continues until edits during two saves are acknowledged', async () => {
    const remote = server()
    const runtime = remote.runtime('tenant/seat')
    const post = vi.mocked(runtime.post!)
    const original = post.getMockImplementation()!
    const releases: Array<() => Promise<void>> = []
    post.mockImplementation((path, body) => new Promise(resolve => { releases.push(async () => resolve(await original(path, body))) }))
    const value = workspace()
    await start(value, runtime)
    const reply = value.get().customers[0].reply
    updateCustomerReplyInput(reply, 'context', '最后不到四百毫秒的编辑')
    let ready = false
    const flushed = flushCustomerDrafts(value).then(() => { ready = true })
    expect(post).toHaveBeenCalledTimes(1)
    updateCustomerReplyInput(reply, 'context', '第一次保存中追加')
    await releases[0]()
    await vi.advanceTimersByTimeAsync(0)
    expect(post).toHaveBeenCalledTimes(2)
    expect(ready).toBe(false)
    updateCustomerReplyInput(reply, 'context', '第二次保存中追加的最终内容')
    await releases[1]()
    await vi.advanceTimersByTimeAsync(0)
    expect(post).toHaveBeenCalledTimes(3)
    expect(ready).toBe(false)
    await releases[2]()
    await flushed
    expect(ready).toBe(true)
    expect(JSON.stringify(remote.rows.get('tenant/seat'))).toContain('第二次保存中追加的最终内容')
    expect(customerDraftSyncFor(value).get().phase).toBe('saved')
    await vi.advanceTimersByTimeAsync(400)
    expect(post).toHaveBeenCalledTimes(3)
  })

  it('does not flush a conflict, failed request, or mismatched server acknowledgment', async () => {
    for (const kind of ['conflict', 'failed', 'wrong-ack'] as const) {
      const runtime = server().runtime(kind)

      if (kind === 'wrong-ack') {
        vi.mocked(runtime.post!).mockImplementationOnce(async (_path, body) => {
          const changed = structuredClone(body as { workspace: { customers: Array<{ context: string }> } })
          changed.workspace.customers[0].context = '另一次编辑'

          return { revision: 1, workspace: changed.workspace, updated_at: 1 }
        })
      } else {vi.mocked(runtime.post!).mockRejectedValueOnce(kind === 'conflict' ? enterpriseClientErrorForStatus(409) : enterpriseClientErrorForStatus(401))}

      const value = workspace()
      await start(value, runtime)
      updateCustomerReplyInput(value.get().customers[0].reply, 'context', '必须保留的原文')
      await expect(flushCustomerDrafts(value)).rejects.toThrow()
      expect(value.get().customers[0].reply.get().context).toBe('必须保留的原文')
      expect(customerDraftSyncFor(value).get().phase).toBe(kind === 'conflict' ? 'conflict' : 'error')
      await expect(flushCustomerDrafts(value)).rejects.toThrow()
      expect(runtime.post).toHaveBeenCalledTimes(1)
    }
  })

  it('rejects a late acknowledgment after the account is retired', async () => {
    const runtime = server().runtime('old-account')
    const original = vi.mocked(runtime.post!).getMockImplementation()!
    let release!: () => Promise<void>
    vi.mocked(runtime.post!).mockImplementation((path, body) => new Promise(resolve => { release = async () => resolve(await original(path, body)) }))
    const value = workspace()
    await start(value, runtime)
    updateCustomerReplyInput(value.get().customers[0].reply, 'context', '旧账号最后一笔')
    const flushed = flushCustomerDrafts(value)
    const rejected = expect(flushed).rejects.toThrow('登录状态已变化')
    stopCustomerDraftSync(value)
    await release()
    await rejected
    expect(value.get().customers[0].reply.get().context).toBe('旧账号最后一笔')
  })

  it('blocks a background customer queue, then saves the whole workspace and prevents new edits during handoff', async () => {
    const remote = server()
    const value = workspace()
    await start(value, remote.runtime('tenant/seat'))
    addCustomerReply(value)
    const background = value.get().customers[0].reply
    updateCustomerReplyInput(background, 'context', '后台客户必须保存')
    background.set({ ...background.get(), requestId: 'queued', phase: 'queued' })
    expect((await prepareEnterprisePackageInstall('queued')).ready).toBe(false)
    background.set({ ...background.get(), phase: 'generating' })
    expect((await prepareEnterprisePackageInstall('generating')).ready).toBe(false)
    background.set({ ...background.get(), requestId: null, phase: null, draft: '已生成的后台草稿' })
    expect((await prepareEnterprisePackageInstall('saved')).ready).toBe(true)
    expect(JSON.stringify(remote.rows.get('tenant/seat'))).toContain('已生成的后台草稿')
    updateCustomerReplyInput(background, 'context', '安装中不能修改')
    addCustomerReply(value)
    expect(background.get().context).toBe('后台客户必须保存')
    expect(value.get().customers).toHaveLength(2)
  })
})
