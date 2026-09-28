import { atom, type WritableAtom } from 'nanostores'

import { createCustomerReplyStore, createCustomerReplyWorkspace, type CustomerReplyWorkspaceStore, hasPendingCustomerReplies, hasUnconfirmedCustomerMemory } from './customer-reply'
import { registerEnterpriseInstallActivity } from './enterprise-install-readiness'
import { EnterpriseClientError, type EnterpriseClientRuntime } from './runtime'

interface StoredCustomer {
  id: string
  label: string
  context: string
  instructions: string
  memoryNote?: string
  memoryConfirmedAt?: string | null
  draft: string
  knowledgeGrounded: boolean | null
  interrupted: boolean
}

interface StoredWorkspace {
  activeId: string
  customers: StoredCustomer[]
  nextNumber: number
}

interface WorkspaceResponse {
  revision: number
  workspace: StoredWorkspace | null
  updated_at: number | null
}

export interface CustomerDraftSyncState {
  loaded: boolean
  phase: 'loading' | 'saved' | 'pending' | 'saving' | 'error' | 'conflict'
  message: string
}

interface Persistence {
  state: WritableAtom<CustomerDraftSyncState>
  revision: number
  runtime: EnterpriseClientRuntime | null
  loading: boolean
  started: boolean
  retired: boolean
  saving: boolean
  savingPromise: Promise<void> | null
  activity: ReturnType<typeof registerEnterpriseInstallActivity> | null
  dirty: boolean
  generation: number
  saved: string
  timer: ReturnType<typeof setTimeout> | null
  unsubscribe: (() => void) | null
  customerSubscriptions: Array<() => void>
}

const controllers = new WeakMap<CustomerReplyWorkspaceStore, Persistence>()
const PATH = '/api/customer-reply-workspace'
const MAX_BYTES = 2 * 1024 * 1024

function controllerFor(workspace: CustomerReplyWorkspaceStore): Persistence {
  let controller = controllers.get(workspace)

  if (!controller) {
    controller = {
      state: atom({ loaded: false, phase: 'loading', message: '正在读取已保存的客户草稿…' }),
      revision: 0,
      runtime: null,
      loading: false,
      started: false,
      retired: false,
      saving: false,
      savingPromise: null,
      activity: null,
      dirty: false,
      generation: 0,
      saved: '',
      timer: null,
      unsubscribe: null,
      customerSubscriptions: []
    }
    controllers.set(workspace, controller)
  }

  return controller
}

export function customerDraftSyncFor(workspace: CustomerReplyWorkspaceStore): WritableAtom<CustomerDraftSyncState> {
  return controllerFor(workspace).state
}

function snapshot(workspace: CustomerReplyWorkspaceStore): StoredWorkspace {
  const current = workspace.get()

  return {
    activeId: current.activeId,
    nextNumber: current.nextNumber,
    customers: current.customers.map(customer => {
      const reply = customer.reply.get()

      return {
        id: customer.id,
        label: customer.label,
        context: reply.context,
        instructions: reply.instructions,
        memoryNote: reply.memoryNote,
        memoryConfirmedAt: reply.memoryConfirmedAt,
        draft: reply.draft,
        knowledgeGrounded: reply.knowledgeGrounded,
        interrupted: reply.requestId !== null
      }
    })
  }
}

function validateResponse(response: WorkspaceResponse): void {
  if (
    !response ||
    !Number.isSafeInteger(response.revision) ||
    response.revision < 0 ||
    response.workspace === undefined
  ) {
    throw new Error('未收到完整的客户草稿，已暂停编辑以防覆盖。')
  }

  if (response.workspace === null) {
    return
  }

  const value = response.workspace

  if (
    !Array.isArray(value.customers) ||
    value.customers.length < 1 ||
    value.customers.length > 200 ||
    !Number.isSafeInteger(value.nextNumber) ||
    value.nextNumber < 1
  ) {
    throw new Error('客户草稿格式不完整，请重新读取。')
  }

  const ids = new Set<string>()

  for (const customer of value.customers) {
    if (
      !customer ||
      typeof customer.id !== 'string' ||
      ids.has(customer.id) ||
      ![customer.label, customer.context, customer.instructions, customer.draft].every(
        item => typeof item === 'string'
      ) ||
      ![true, false, null].includes(customer.knowledgeGrounded) ||
      typeof customer.interrupted !== 'boolean'
    ) {
      throw new Error('客户草稿格式不完整，请重新读取。')
    }

    const note = customer.memoryNote === undefined ? '' : customer.memoryNote
    const confirmedAt = customer.memoryConfirmedAt ?? null

    if (typeof note !== 'string' || note.length > 4000 ||
      (note === '' ? confirmedAt !== null : typeof confirmedAt !== 'string' || confirmedAt.length > 40 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|\+00:00)$/.test(confirmedAt) || !Number.isFinite(Date.parse(confirmedAt)))) {
      throw new Error('客户记忆格式不完整，请重新读取。')
    }

    ids.add(customer.id)
  }

  if (!ids.has(value.activeId)) {
    throw new Error('客户草稿缺少当前客户，请重新读取。')
  }
}

function subscribeCustomers(workspace: CustomerReplyWorkspaceStore, controller: Persistence): void {
  controller.customerSubscriptions.forEach(unsubscribe => unsubscribe())
  controller.customerSubscriptions = workspace
    .get()
    .customers.map(customer => customer.reply.listen(() => schedule(workspace)))
}

function schedule(workspace: CustomerReplyWorkspaceStore): void {
  const controller = controllerFor(workspace)
  controller.activity?.changed()

  if (controller.retired || controller.loading || !controller.state.get().loaded) {
    return
  }

  controller.dirty = true

  if (['conflict', 'error'].includes(controller.state.get().phase)) {
    return
  }

  if (!controller.saving) {
    controller.state.set({ loaded: true, phase: 'pending', message: '有未保存的修改…' })
  }

  if (controller.timer) {
    clearTimeout(controller.timer)
  }

  controller.timer = setTimeout(() => void saveCustomerDrafts(workspace), 400)
}

export function startCustomerDraftSync(workspace: CustomerReplyWorkspaceStore, runtime: EnterpriseClientRuntime): void {
  const controller = controllerFor(workspace)

  if (controller.started || controller.retired) {
    return
  }

  controller.started = true
  controller.runtime = runtime
  controller.activity = registerEnterpriseInstallActivity({
    blocker: () => {
      if (hasPendingCustomerReplies(workspace)) {return '有客户回复正在排队或生成，请等待完成后更新。'}

      if (hasUnconfirmedCustomerMemory(workspace)) {return '有客户记忆尚未确认，请先确认保存或恢复已保存内容后更新。'}

      if (controller.loading || !controller.state.get().loaded) {return '客户草稿尚未读取完成，请恢复连接或重新读取后更新。'}

      if (['error', 'conflict'].includes(controller.state.get().phase)) {return controller.state.get().message}

      return null
    },
    flush: () => flushCustomerDrafts(workspace)
  })
  controller.unsubscribe = workspace.listen(() => {
    subscribeCustomers(workspace, controller)
    schedule(workspace)
  })
  subscribeCustomers(workspace, controller)
  void reloadCustomerDrafts(workspace)
}

export async function reloadCustomerDrafts(workspace: CustomerReplyWorkspaceStore): Promise<void> {
  const controller = controllerFor(workspace)

  if (!controller.runtime || controller.retired || controller.loading || controller.saving) {
    return
  }

  const replacing = controller.state.get().loaded
  const generation = ++controller.generation
  controller.loading = true

  if (controller.timer) {
    clearTimeout(controller.timer)
  }

  controller.state.set({ loaded: false, phase: 'loading', message: '正在读取已保存的客户草稿…' })

  try {
    const result = await controller.runtime.get<WorkspaceResponse>(PATH)

    if (controller.retired || generation !== controller.generation) {
      return
    }

    validateResponse(result)

    if (result.workspace || replacing) {
      for (const customer of workspace.get().customers) {
        customer.reply.set({ ...customer.reply.get(), requestId: null, phase: null })
      }
    }

    if (result.workspace) {
      workspace.set({
        activeId: result.workspace.activeId,
        nextNumber: result.workspace.nextNumber,
        customers: result.workspace.customers.map(customer => {
          const reply = createCustomerReplyStore()
          reply.set({
            ...reply.get(),
            context: customer.context,
            instructions: customer.instructions,
            memoryNote: customer.memoryNote ?? '',
            memoryConfirmedAt: customer.memoryConfirmedAt ?? null,
            memoryDraft: customer.memoryNote ?? '',
            memoryPending: false,
            draft: customer.draft,
            knowledgeGrounded: customer.knowledgeGrounded,
            error: customer.interrupted ? '上次生成已中断，请核对上下文后重新生成。' : null
          })

          return { id: customer.id, label: customer.label, reply }
        })
      })
    } else if (replacing) {
      workspace.set(createCustomerReplyWorkspace().get())
    }

    controller.revision = result.revision
    controller.saved = result.workspace ? JSON.stringify(snapshot(workspace)) : ''
    controller.dirty = false
    controller.state.set({
      loaded: true,
      phase: 'saved',
      message: result.workspace ? '已恢复服务器草稿' : '草稿将在修改后自动保存'
    })
  } catch (reason) {
    if (!controller.retired && generation === controller.generation) {
      controller.state.set({
        loaded: false,
        phase: 'error',
        message: reason instanceof Error ? reason.message : '无法读取客户草稿，请重试。'
      })
    }
  } finally {
    if (generation === controller.generation) {
      controller.loading = false
    }
  }
}

export function saveCustomerDrafts(workspace: CustomerReplyWorkspaceStore): Promise<void> {
  const controller = controllerFor(workspace)

  if (controller.savingPromise) {return controller.savingPromise}

  const task = performSave(workspace).finally(() => {
    if (controller.savingPromise === task) {controller.savingPromise = null}
  })

  controller.savingPromise = task

  return task
}

async function performSave(workspace: CustomerReplyWorkspaceStore): Promise<void> {
  const controller = controllerFor(workspace)

  if (
    controller.retired ||
    controller.loading ||
    controller.saving ||
    !controller.state.get().loaded ||
    controller.state.get().phase === 'conflict' ||
    !controller.runtime?.post
  ) {
    return
  }

  if (controller.timer) {
    clearTimeout(controller.timer)
  }

  const content = snapshot(workspace)
  const encoded = JSON.stringify(content)

  if (encoded === controller.saved) {
    controller.dirty = false
    controller.state.set({ loaded: true, phase: 'saved', message: '草稿已保存到企业服务器' })

    return
  }

  if (new TextEncoder().encode(encoded).byteLength > MAX_BYTES) {
    controller.state.set({
      loaded: true,
      phase: 'error',
      message: '草稿总量超过 2 MiB，请结束不再使用的客户后重试保存。'
    })

    return
  }

  const generation = controller.generation
  controller.saving = true
  controller.dirty = false
  controller.state.set({ loaded: true, phase: 'saving', message: '正在保存客户草稿…' })

  try {
    const result = await controller.runtime.post<WorkspaceResponse>(PATH, {
      expected_revision: controller.revision,
      workspace: content
    })

    if (controller.retired || generation !== controller.generation) {
      return
    }

    validateResponse(result)

    if (result.revision <= controller.revision || result.workspace === null) {
      throw new Error('未确认草稿保存成功，请重试。')
    }

    const acknowledged = {
      activeId: result.workspace.activeId,
      nextNumber: result.workspace.nextNumber,
      customers: result.workspace.customers.map(customer => ({
        id: customer.id, label: customer.label, context: customer.context, instructions: customer.instructions,
        memoryNote: customer.memoryNote ?? '', memoryConfirmedAt: customer.memoryConfirmedAt ?? null,
        draft: customer.draft, knowledgeGrounded: customer.knowledgeGrounded, interrupted: customer.interrupted
      }))
    }

    if (JSON.stringify(acknowledged) !== encoded) {throw new Error('服务器未确认本次完整草稿，请重试。')}

    controller.revision = result.revision
    controller.saved = encoded

    // Only this exact acknowledged note may leave the confirmation-pending
    // state. A later edit/confirmation must remain attached to its own save.
    for (const savedCustomer of content.customers) {
      const reply = workspace.get().customers.find(customer => customer.id === savedCustomer.id)?.reply
      const current = reply?.get()

      if (reply && current?.memoryPending && current.memoryNote === savedCustomer.memoryNote && current.memoryConfirmedAt === savedCustomer.memoryConfirmedAt) {
        reply.set({ ...current, memoryPending: false })
      }
    }

    controller.state.set({
      loaded: true,
      phase: controller.dirty ? 'pending' : 'saved',
      message: controller.dirty ? '仍有未保存的修改…' : '草稿已保存到企业服务器'
    })
  } catch (reason) {
    if (!controller.retired && generation === controller.generation) {
      controller.dirty = true
      const conflict = reason instanceof EnterpriseClientError && reason.kind === 'conflict'
      controller.state.set({
        loaded: true,
        phase: conflict ? 'conflict' : 'error',
        message: conflict
          ? '其他设备已更新草稿。本机修改已保留，尚未覆盖服务器；请先复制需要保留的文字，再读取服务器版本。'
          : '草稿尚未保存，本机内容已保留。请保持客户端打开并重试。'
      })
    }
  } finally {
    controller.saving = false
    controller.activity?.changed()

    if (!controller.retired && controller.dirty && controller.state.get().phase === 'pending') {
      schedule(workspace)
    }
  }
}

/** Drain both the active request and any later edits until the server has
 * acknowledged the current snapshot. A conflict never authorizes overwrite. */
export async function flushCustomerDrafts(workspace: CustomerReplyWorkspaceStore): Promise<void> {
  const controller = controllerFor(workspace)
  const generation = controller.generation

  while (true) {
    if (controller.timer) { clearTimeout(controller.timer); controller.timer = null }

    if (controller.retired || generation !== controller.generation || !controller.runtime?.post) {throw new Error('客户工作区或登录状态已变化，草稿未确认保存。')}

    if (controller.loading || !controller.state.get().loaded) {throw new Error('客户草稿尚未读取完成，请稍后重试。')}

    if (['error', 'conflict'].includes(controller.state.get().phase)) {throw new Error(controller.state.get().message)}
    await saveCustomerDrafts(workspace)

    if (controller.retired || generation !== controller.generation) {throw new Error('客户工作区或登录状态已变化，草稿未确认保存。')}

    if (['error', 'conflict'].includes(controller.state.get().phase)) {throw new Error(controller.state.get().message)}

    if (!controller.saving && JSON.stringify(snapshot(workspace)) === controller.saved) {
      if (controller.timer) { clearTimeout(controller.timer); controller.timer = null }

      return
    }
  }
}

/** Shared generation/feedback barrier: a returned revision is a complete
 * server acknowledgement, never a local counter or a queued autosave. */
export async function flushCustomerDraftsForRequest(workspace: CustomerReplyWorkspaceStore): Promise<{ revision: number }> {
  await flushCustomerDrafts(workspace)
  const controller = controllerFor(workspace)

  if (controller.retired || !controller.runtime?.post || JSON.stringify(snapshot(workspace)) !== controller.saved) {
    throw new Error('客户草稿仍有未保存修改，请重试。')
  }

  return { revision: controller.revision }
}

/** Stop before clearing in-memory customer atoms. Logout must never turn the
 * renderer's cleanup into an empty replacement of the server's durable copy. */
export function stopCustomerDraftSync(workspace: CustomerReplyWorkspaceStore): void {
  const controller = controllers.get(workspace)

  if (!controller) {
    return
  }

  controller.retired = true
  controller.activity?.dispose()
  controller.activity = null
  ++controller.generation

  if (controller.timer) {
    clearTimeout(controller.timer)
  }

  controller.unsubscribe?.()
  controller.customerSubscriptions.forEach(unsubscribe => unsubscribe())
  controller.runtime = null
}
