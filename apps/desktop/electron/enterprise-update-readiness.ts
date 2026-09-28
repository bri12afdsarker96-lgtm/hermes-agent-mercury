/** Main-owned install transaction. A renderer acknowledgement is a short lease,
 * invalidated by later edits, navigation, a lost window, or another window. */
export interface UpdateReadinessWindow {
  id: number
  isDestroyed(): boolean
  send(channel: string, payload: unknown): void
}

export interface UpdateReadinessLease {
  ready: boolean
  reasons: string[]
  isStillReady(): boolean
  release(): void
}

interface ReadinessOptions {
  getWindow(): UpdateReadinessWindow | null
  blockers(): string[]
  timeoutMs?: number
}

interface Pending {
  transactionId: string
  window: UpdateReadinessWindow
  acknowledged: boolean
  revision: number | null
  invalidated: boolean
  timer: ReturnType<typeof setTimeout>
  resolve(lease: UpdateReadinessLease): void
}

export function createEnterpriseUpdateReadiness(options: ReadinessOptions) {
  let pending: Pending | null = null

  const blocked = (reasons: string[]): UpdateReadinessLease => ({
    ready: false, reasons, isStillReady: () => false, release: () => undefined
  })

  function release() {
    const current = pending

    if (!current) {return}
    pending = null
    current.invalidated = true
    clearTimeout(current.timer)

    if (!current.window.isDestroyed()) {
      current.window.send('hermes:enterprise:package-update-release', { transactionId: current.transactionId })
    }

    current.resolve(blocked(['更新准备已取消，原有工作已保留']))
  }

  function prepare(transactionId: string): Promise<UpdateReadinessLease> {
    release()
    const window = options.getWindow()
    const reasons = options.blockers()

    if (!window || window.isDestroyed()) {reasons.push('客户端窗口尚未准备好，请稍后重试')}

    if (reasons.length) {return Promise.resolve(blocked(reasons))}

    return new Promise(resolve => {
      const current: Pending = {
        transactionId, window: window!, acknowledged: false, revision: null, invalidated: false,
        resolve,
        timer: setTimeout(() => {
          if (pending !== current) {return}
          resolve(blocked(['保存工作超时，请检查草稿保存状态后重试']))
          release()
        }, options.timeoutMs ?? 35_000)
      }

      pending = current

      try {
        current.window.send('hermes:enterprise:package-update-prepare', { transactionId })
      } catch {
        resolve(blocked(['客户端窗口未响应，暂时无法安装']))
        release()
      }
    })
  }

  function reply(senderId: number, payload: unknown) {
    const current = pending

    if (!current || current.window.id !== senderId || current.acknowledged || !payload || typeof payload !== 'object') {return}
    const data = payload as Record<string, unknown>

    if (Object.keys(data).some(key => !['transactionId', 'ready', 'reasons', 'revision'].includes(key))) {return}

    if (data.transactionId !== current.transactionId || typeof data.ready !== 'boolean' ||
      !Number.isSafeInteger(data.revision) || (data.revision as number) < 0) {return}

    const reasons = Array.isArray(data.reasons)
      ? data.reasons.filter((reason): reason is string => typeof reason === 'string').slice(0, 6).map(reason => reason.slice(0, 180))
      : []

    if (!data.ready || current.invalidated || (current.revision !== null && current.revision !== data.revision)) {
      current.resolve(blocked(reasons.length ? reasons : ['工作状态发生变化，请完成保存后重试']))
      release()

      return
    }

    clearTimeout(current.timer)
    current.acknowledged = true
    current.revision = data.revision as number
    current.resolve({
      ready: true, reasons: [],
      isStillReady: () => pending === current && !current.invalidated && !current.window.isDestroyed() &&
        options.getWindow()?.id === current.window.id && options.blockers().length === 0,
      release: () => { if (pending === current) {release()} }
    })
  }

  function changed(senderId: number, payload: unknown) {
    if (!pending || pending.window.id !== senderId || !payload || typeof payload !== 'object') {return}
    const data = payload as Record<string, unknown>

    if (Object.keys(data).length !== 1 || !Number.isSafeInteger(data.revision) || (data.revision as number) < 0) {return}

    if (pending.acknowledged && pending.revision !== data.revision) {pending.invalidated = true}
    pending.revision = data.revision as number
  }

  function invalidate(senderId: number) {
    if (pending?.window.id === senderId) {
      pending.resolve(blocked(['窗口或登录身份已变化，请重新检查更新']))
      release()
    }
  }

  return { prepare, reply, changed, invalidate, release }
}
