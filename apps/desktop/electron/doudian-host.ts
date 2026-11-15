import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { StringDecoder } from 'node:string_decoder'

import type { DoudianReply, DoudianRequest, DoudianTask } from './doudian-types'

const id = () => randomBytes(16).toString('hex')
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')

const bad = (code: string): never => {
  throw new Error(code)
}

const isolationCapability = 'hermes-task-isolation-v1'
const foregroundGuardedHostSha256 = '62aca5f5e23fca7b6120959b9c41a23051cadf341415f5cc1150d422be7b52da'
export const allowForegroundLocalDoudian = (packaged: boolean, local: boolean, optIn: string | undefined): boolean =>
  !packaged && local && optIn === '1'
export const doudianWorkbookExtensions = ['xlsx', 'xls', 'xlsm']
const validId = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value)
const validAmount = (value: unknown) => {
  if (typeof value !== 'string' || value.length > 16000) return false
  let input = value.trim()
  let sign = ''
  if (/^[+-]/.test(input)) { sign = input[0]; input = input.slice(1) }
  if (/[+-]$/.test(input)) {
    if (sign) return false
    sign = input.slice(-1); input = input.slice(0, -1)
  }
  if (sign === '-') return false
  const match = /^(\d[\d,]*)?(?:\.(\d*))?$/.exec(input)
  if (!match || !/\d/.test(input)) return false
  const integer = (match[1] ?? '').replaceAll(',', '').replace(/^0+/, '') || '0'
  const fraction = match[2] ?? ''
  if (integer.length > 6 || (integer.length === 6 && integer > '100000')) return false
  // Match Decimal.TryParse's 96-bit, scale-28, midpoint-to-even rounding before comparing limits.
  const maxDecimal = 79228162514264337593543950335n
  for (let scale = Math.min(fraction.length, 28); scale >= 0; scale--) {
    let coefficient = BigInt(integer + fraction.slice(0, scale))
    const remainder = fraction.slice(scale)
    if (remainder && (remainder[0] > '5' ||
        (remainder[0] === '5' && (/[1-9]/.test(remainder.slice(1)) || coefficient % 2n === 1n)))) coefficient++
    if (coefficient <= maxDecimal) return coefficient > 0n && coefficient <= 100000n * 10n ** BigInt(scale)
  }
  return false
}
const validRow = (value: unknown, minimum: number) =>
  typeof value === 'string' && /^\d+$/.test(value) && Number(value) >= minimum && Number(value) <= 2147483647

export function doudianScope(origin: string, identity: unknown): string {
  const value = identity as { role?: string; tenant_id?: string; principal_id?: string; must_change_password?: boolean }

  if (
    !value ||
    !['tenant_admin', 'supervisor', 'operator'].includes(value.role ?? '') ||
    value.must_change_password ||
    !value.tenant_id?.trim() ||
    !value.principal_id?.trim()
  ) {
    return bad('DOUDIAN_FORBIDDEN')
  }

  // Same tools permission policy as the enterprise shell; platform admins have no tenant scope.
  return hash(JSON.stringify([new URL(origin).origin, value.tenant_id, value.principal_id]))
}

export function assertDoudianCapability(identity: unknown, action: DoudianRequest['action']): void {
  const capabilities = (identity as { product_capabilities?: Record<string, { enabled?: boolean; status?: string }> } | null)?.product_capabilities
  const review = capabilities?.doudian_review
  const payment = capabilities?.doudian_payment
  const enabled = (value: typeof review) => value?.enabled === true && value.status === 'LIVE'
  const allowed = ['openReview', 'shops', 'manageShops', 'prepare', 'start', 'shopManagementList', 'shopManagementAdd', 'shopManagementRename', 'shopManagementPin', 'shopManagementMove', 'shopManagementPrepareDelete', 'shopManagementDelete', 'shopLoginStart', 'shopCheckStart', 'shopOperationStatus', 'shopLoginConfirm', 'shopLoginFinishFeige', 'shopOperationCancel'].includes(action) ? enabled(review)
    : ['openPayment', 'preparePayment', 'startPayment', 'pausePayment', 'resumePayment'].includes(action) ? enabled(payment)
      : ['capabilities', 'chooseWorkbook', 'status'].includes(action) ? enabled(review) || enabled(payment)
        : false
  if (!allowed) bad('DOUDIAN_FORBIDDEN')
}

export async function verifiedDoudianExecutable(root: string): Promise<string> {
  let manifest: { protocol: number; integration: string; version: string; files: Record<string, string> }

  try {
    manifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'))
  } catch {
    return bad('DOUDIAN_MODULE_MISSING')
  }

  if (
    manifest.protocol !== 1 ||
    manifest.integration !== 'hermes-review-v1' ||
    manifest.version !== '1.0.54' ||
    !manifest.files ||
    !manifest.files['外呼订单自动化.exe'] ||
    Object.keys(manifest.files).length > 500
  ) {
    return bad('DOUDIAN_MODULE_INVALID')
  }

  const realRoot = await fs.realpath(root)

  for (const [name, digest] of Object.entries(manifest.files)) {
    if (
      !/^[a-f0-9]{64}$/.test(digest) ||
      path.isAbsolute(name) ||
      name.includes('..') ||
      name.includes('\\') ||
      name.includes(':')
    ) {
      return bad('DOUDIAN_MODULE_INVALID')
    }

    const target = await fs.realpath(path.join(root, name))
    const relative = path.relative(realRoot, target)

    if (relative.startsWith('..') || path.isAbsolute(relative) || hash(await fs.readFile(target)) !== digest) {
      return bad('DOUDIAN_MODULE_INVALID')
    }
  }

  async function checkExtra(dir: string) {
    for (const item of await fs.readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, item.name)

      if (item.isSymbolicLink()) {
        return bad('DOUDIAN_MODULE_INVALID')
      }

      if (item.isDirectory()) {
        await checkExtra(file)
      } else {
        const name = path.relative(root, file).replaceAll('\\', '/')

        if (name !== 'manifest.json' && !Object.hasOwn(manifest.files, name)) {
          return bad('DOUDIAN_MODULE_INVALID')
        }
      }
    }
  }

  await checkExtra(root)

  return path.join(root, '外呼订单自动化.exe')
}

/** Only this fixed, verified process receives the private pipe. Never retries a mutation. */
export class DoudianHost {
  private child: ChildProcessWithoutNullStreams
  private pending = new Map<
    string,
    { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }
  >()
  private buffer = ''
  private decoder = new StringDecoder('utf8')
  private closed = false
  constructor(private readonly executable: string, spawnHost: typeof spawn = spawn, private readonly spawnForeground: typeof spawn = spawn) {
    this.child = spawnHost(executable, ['--hermes-review-host'], {
      shell: false,
      // The host creates the original WinForms windows in this process.
      windowsHide: false,
      cwd: path.dirname(executable),
      stdio: 'pipe'
    }) as ChildProcessWithoutNullStreams
    this.child.stderr.resume()
    this.child.stdout.on('data', data => this.receive(this.decoder.write(data)))
    this.child.on('error', () => this.fail('DOUDIAN_HOST_LOST'))
    this.child.on('exit', () => this.fail('DOUDIAN_HOST_LOST'))
    this.child.stdin.on('error', () => this.fail('DOUDIAN_HOST_LOST'))
  }
  private receive(chunk: string) {
    this.buffer += chunk

    if (this.buffer.length > 262144) {
      this.protocolFailure()

      return
    }

    let end: number

    while ((end = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, end)
      this.buffer = this.buffer.slice(end + 1)

      try {
        const message = JSON.parse(line)

        if (!message || typeof message !== 'object' || Array.isArray(message)) {
          this.protocolFailure()
          return
        }

        if (message.event === 'paymentAuthorization') {
          // A legacy host is not allowed to request an obsolete grant or proceed.
          this.protocolFailure()
          return
        }

        if (!validId(message.id) || typeof message.ok !== 'boolean' ||
            (message.ok === false && typeof message.error !== 'string')) {
          this.protocolFailure()
          return
        }

        const pending = this.pending.get(message.id)

        if (!pending) {
          continue
        }

        this.pending.delete(message.id)
        clearTimeout(pending.timer)

        if (message.ok === true) {
          pending.resolve(message.result)
        } else {
          pending.reject(
            new Error(typeof message.error === 'string' ? message.error.slice(0, 500) : 'DOUDIAN_PROTOCOL_ERROR')
          )
        }
      } catch {
        this.protocolFailure()

        return
      }
    }
  }
  private protocolFailure() {
    this.fail('DOUDIAN_PROTOCOL_ERROR')
    this.child.stdin.end()
    this.child.kill()
  }
  async request(method: string, params: Record<string, string> = {}, dispatch?: { before(): void; after?(): void; foreground?: boolean }): Promise<unknown> {
    if (this.closed) {
      throw new Error('DOUDIAN_HOST_LOST')
    }

    if ((method === 'startPayment' || method === 'resumePayment') && dispatch?.foreground !== false) {
      await this.grantPaymentForeground()
      if (this.closed) throw new Error('DOUDIAN_HOST_LOST')
    }
    dispatch?.before()
    const requestId = id()

    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => {
          this.pending.delete(requestId)
          reject(new Error('DOUDIAN_RESULT_UNKNOWN'))
        },
        method === 'manageShops' ? 30 * 60_000 : 60_000
      )

      this.pending.set(requestId, { resolve, reject, timer })
      this.child.stdin.write(JSON.stringify({ id: requestId, method, params }) + '\n')
      dispatch?.after?.()
    })
  }
  private grantPaymentForeground(): Promise<void> {
    const pid = this.child.pid
    if (!pid || this.closed) return Promise.reject(new Error('DOUDIAN_HOST_LOST'))
    return new Promise((resolve, reject) => {
      const helper = this.spawnForeground(this.executable, ['--hermes-grant-foreground', String(pid)], {
        shell: false, windowsHide: true, cwd: path.dirname(this.executable), stdio: 'ignore'
      })
      const timer = setTimeout(() => {
        helper.kill()
        reject(new Error('DOUDIAN_FOREGROUND_UNAVAILABLE'))
      }, 5000)
      helper.once('error', () => { clearTimeout(timer); reject(new Error('DOUDIAN_FOREGROUND_UNAVAILABLE')) })
      helper.once('exit', code => {
        clearTimeout(timer)
        if (code === 0 && !this.closed && this.child.pid === pid) resolve()
        else reject(new Error('DOUDIAN_FOREGROUND_UNAVAILABLE'))
      })
    })
  }
  private fail(code: string) {
    this.closed = true

    for (const request of this.pending.values()) {
      clearTimeout(request.timer)
      request.reject(new Error(code))
    }

    this.pending.clear()
  }
  close() {
    // EOF requests graceful cancellation and queue drain, not a forced Excel termination.
    this.child.stdin.end()
    this.fail('DOUDIAN_HOST_LOST')
  }
}

export interface DoudianDependencies {
  platform: string
  root: string
  localVerification?: boolean
  localForeground?: boolean
  verifyForegroundHost?(executable: string): Promise<boolean>
  authorize(action: DoudianRequest['action']): Promise<string>
  isCurrent(): boolean
  chooseWorkbook(): Promise<string | null>
  createHost?(executable: string): Pick<DoudianHost, 'request' | 'close'>
  verify?(root: string): Promise<string>
  /** @deprecated Ignored; payment controls use the host protocol. */
  acquirePaymentShortcut?(stop: () => void): () => void
}

export class DoudianController {
  private host?: Pick<DoudianHost, 'request' | 'close'>
  private owner?: string
  private files = new Map<string, string>()
  private exclusive = false
  private lost = false
  private taskId?: string
  private taskKind?: DoudianTask['kind']
  private taskState?: DoudianTask['state']
  private paymentTransport?: DoudianRequest['transport']
  private shopOperation?: { taskId: string; shopId: string; kind: 'shop-login' | 'shop-check' }
  constructor(private deps: DoudianDependencies) {}
  close() {
    this.lost = true
    this.host?.close()
    this.files.clear()
    this.shopOperation = undefined
  }
  private current() {
    if (this.lost || !this.deps.isCurrent()) {
      this.close()

      throw new Error('DOUDIAN_OWNER_CHANGED')
    }
  }
  async operate(request: DoudianRequest): Promise<DoudianReply> {
    try {
      // Foreground developer testing is explicit; packaged local builds remain blocked.
      if (this.deps.localVerification && !this.deps.localForeground) return bad('DOUDIAN_LOCAL_ISOLATION_UNAVAILABLE')
      this.current()

      if (this.deps.platform !== 'win32') {
        return bad('DOUDIAN_WINDOWS_REQUIRED')
      }

      const fields: Record<string, string[]> = {
        capabilities: [],
        openPayment: [],
        openReview: [],
        openFeige: [],
        shops: [],
        manageShops: [],
        shopManagementList: [],
        shopManagementAdd: [],
        shopManagementRename: ['shopId', 'alias'],
        shopManagementPin: ['shopId', 'pinned'],
        shopManagementMove: ['shopId', 'direction'],
        shopManagementPrepareDelete: ['shopId'],
        shopManagementDelete: ['shopId', 'confirmation'],
        shopLoginStart: ['shopId'],
        shopCheckStart: ['shopId'],
        shopOperationStatus: ['taskId'],
        shopLoginConfirm: ['taskId', 'decision'],
        shopLoginFinishFeige: ['taskId'],
        shopOperationCancel: ['taskId'],
        chooseWorkbook: [],
        prepare: ['shopId', 'workbookId'],
        preparePayment: ['workbookId', 'amount', 'startRow', 'maxRows', 'mode'],
        start: ['taskId'],
        startPayment: ['taskId'],
        pausePayment: ['taskId'],
        resumePayment: ['taskId'],
        status: [],
        stop: ['taskId']
      }

      const allowed = Object.hasOwn(fields, request?.action ?? '') ? fields[request.action] : undefined
      const reviewOptions = ['startRow', 'maxRows', 'concurrency'] as const
      const optional = request.action === 'prepare' ? reviewOptions : request.action === 'preparePayment' ? ['transport'] as const : []

      if (
        !allowed ||
        Object.keys(request).some(key => !['sessionId', 'action', ...allowed, ...optional].includes(key)) ||
        allowed.some(key => typeof request[key as keyof DoudianRequest] !== 'string') ||
        optional.some(key => Object.hasOwn(request, key) && typeof request[key] !== 'string') ||
        ['shopId', 'workbookId', 'taskId', 'confirmation'].some(key => allowed.includes(key) && !validId(request[key as keyof DoudianRequest])) ||
        (request.action === 'shopManagementRename' && (request.alias!.length > 80 || /[\x00-\x1f\x7f]/.test(request.alias!))) ||
        (request.action === 'shopManagementPin' && !['true', 'false'].includes(request.pinned!)) ||
        (request.action === 'shopManagementMove' && !['up', 'down'].includes(request.direction!)) ||
        (request.action === 'shopLoginConfirm' && !['confirm', 'reject'].includes(request.decision!))
      ) {
        return bad('DOUDIAN_INVALID_REQUEST')
      }
      if (request.action === 'preparePayment' && request.transport !== undefined &&
          request.transport !== 'desktop' && request.transport !== 'cdp') return bad('INVALID_TRANSPORT')

      // Cancellation remains available to the same fenced session during an enterprise network outage.
      if (request.action !== 'stop' && request.action !== 'shopOperationCancel') {
        const owner = await this.deps.authorize(request.action)
        this.current()

        if (this.owner && this.owner !== owner) {
          this.close()

          return bad('DOUDIAN_OWNER_CHANGED')
        }

        this.owner = owner
      }

      if (request.action === 'stop' && (!this.host || !this.taskId || request.taskId !== this.taskId)) {
        return bad('TASK_NOT_FOUND')
      }
      if (request.action === 'shopOperationCancel' && (!this.host || !this.shopOperation || request.taskId !== this.shopOperation.taskId)) return bad('TASK_NOT_FOUND')

      if (this.exclusive) {
        return bad('TASK_BUSY')
      }
      if (['preparing', 'awaiting_confirmation', 'running', 'pausing', 'paused', 'stopping', 'unknown'].includes(this.taskState ?? '') &&
          ['chooseWorkbook', 'prepare', 'preparePayment', 'openPayment', 'openReview', 'openFeige', 'manageShops', 'shopLoginStart', 'shopCheckStart', 'shopManagementDelete'].includes(request.action)) {
        return bad('TASK_BUSY')
      }

      this.exclusive = true

      try {
        if (!this.host) {
          const executable = await (this.deps.verify ?? verifiedDoudianExecutable)(this.deps.root)
          this.current()

          if (this.deps.localVerification && this.deps.localForeground) {
            const allowed = this.deps.verifyForegroundHost
              ? await this.deps.verifyForegroundHost(executable)
              : hash(await fs.readFile(executable)) === foregroundGuardedHostSha256
            if (!allowed) return bad('DOUDIAN_TEST_HOST_UNSAFE')
            this.current()
          }

          this.host = this.deps.createHost?.(executable) ?? new DoudianHost(executable)

          const init = (await this.host.request('initialize', { scope: this.owner! })) as {
            protocol?: number
            integration?: string
            version?: string
            taskIsolation?: string
            authorizationMode?: string
          }

          if (init.protocol !== 1 || init.integration !== 'hermes-review-v1' || init.version !== '1.0.54') {
            this.close()

            return bad('DOUDIAN_MODULE_INVALID')
          }
          if (init.taskIsolation !== isolationCapability || init.authorizationMode !== 'enterprise-session-v1') {
            this.close()
            return bad('DOUDIAN_MODULE_INCOMPATIBLE')
          }
        }

        this.current()

        let checkedCapabilities: DoudianReply['capabilities']
        if (request.action.startsWith('shopManagement') || ['shopLoginStart', 'shopCheckStart', 'shopLoginConfirm', 'shopLoginFinishFeige', 'manageShops', 'prepare', 'start', 'preparePayment', 'startPayment', 'pausePayment', 'resumePayment', 'openReview', 'openPayment'].includes(request.action)) {
          checkedCapabilities = (await this.host.request('capabilities')) as DoudianReply['capabilities']
          this.current()
          if (checkedCapabilities?.authorized !== true || checkedCapabilities.authorizationMode !== 'enterprise-session-v1') {
            return bad('DOUDIAN_MODULE_INCOMPATIBLE')
          }
          if (request.action.startsWith('shopManagement') && checkedCapabilities.shopManagement !== 1) return bad('SHOP_MANAGEMENT_UNSUPPORTED')
          if (['shopLoginStart', 'shopCheckStart', 'shopLoginConfirm', 'shopLoginFinishFeige'].includes(request.action) && checkedCapabilities.shopOperations !== 1) return bad('SHOP_OPERATION_UNSUPPORTED')
          if (['pausePayment', 'resumePayment'].includes(request.action) && checkedCapabilities.paymentControls !== 1) return bad('PAYMENT_CONTROLS_UNSUPPORTED')
          const cdpPayment = request.action === 'preparePayment' ? request.transport === 'cdp' :
            ['startPayment', 'resumePayment'].includes(request.action) && this.paymentTransport === 'cdp'
          if (cdpPayment && checkedCapabilities.paymentCdp !== 1) return bad('PAYMENT_CDP_UNSUPPORTED')
        }

        if (request.action === 'openPayment') {
          const capabilities = checkedCapabilities
          this.current()
          if (capabilities?.protocol !== 1 || capabilities.version !== '1.0.54' || capabilities.paymentUi !== 1) {
            return bad('PAYMENT_MODULE_MISSING')
          }
        }

        if (request.action === 'openReview' || request.action === 'openFeige') {
          const capabilities = checkedCapabilities ?? (await this.host.request('capabilities')) as DoudianReply['capabilities']
          this.current()
          const capability = request.action === 'openReview' ? capabilities?.reviewUi : capabilities?.feigeUi
          if (capabilities?.protocol !== 1 || capabilities.version !== '1.0.54' || capability !== 1) {
            return bad('DOUDIAN_MODULE_MISSING')
          }
        }

        if (request.action === 'chooseWorkbook') {
          const selected = await this.deps.chooseWorkbook()
          this.current()

          if (!selected) {
            return { ok: true }
          }

          const canonical = await fs.realpath(selected)

          if (
            !path.isAbsolute(canonical) ||
            canonical.startsWith('\\\\') ||
            !doudianWorkbookExtensions.includes(path.extname(canonical).slice(1).toLowerCase()) ||
            !(await fs.stat(canonical)).isFile()
          ) {
            return bad('INVALID_WORKBOOK')
          }

          this.current()
          const workbookId = id()
          this.files.clear()
          this.files.set(workbookId, canonical)

          return { ok: true, workbook: { id: workbookId, name: path.basename(canonical) } }
        }

        let args: Record<string, string> = {}

        if (request.action.startsWith('shopManagement') || ['shopLoginStart', 'shopCheckStart', 'shopOperationStatus', 'shopLoginConfirm', 'shopLoginFinishFeige', 'shopOperationCancel'].includes(request.action)) {
          if (['shopOperationStatus', 'shopLoginConfirm', 'shopLoginFinishFeige', 'shopOperationCancel'].includes(request.action) &&
              (!this.shopOperation || request.taskId !== this.shopOperation.taskId || request.taskId !== this.taskId || this.taskKind !== this.shopOperation.kind)) return bad('TASK_NOT_FOUND')
          for (const key of allowed) args[key] = request[key as keyof DoudianRequest] as string
        } else if (request.action === 'prepare') {
          const file = this.files.get(request.workbookId!)

          if (!file) {
            return bad('INVALID_WORKBOOK')
          }

          args = { shopId: request.shopId!, workbook: file }
          const present = reviewOptions.filter(key => Object.hasOwn(request, key))
          if (present.length) {
            if ((request.startRow !== undefined && (!validRow(request.startRow, 1) || Number(request.startRow) > 1000000)) ||
                (request.maxRows !== undefined && (!validRow(request.maxRows, 0) || Number(request.maxRows) > 1000000))) {
              return bad('INVALID_RANGE')
            }
            if (request.concurrency !== undefined && !['1', '2', '4', '8'].includes(request.concurrency)) {
              return bad('INVALID_CONCURRENCY')
            }
            const capabilities = (await this.host.request('capabilities')) as DoudianReply['capabilities']
            this.current()
            if (capabilities?.reviewOptions !== 1) {
              return bad('REVIEW_OPTIONS_UNSUPPORTED')
            }
            for (const key of present) {
              args[key] = request[key]!
            }
          }
        } else if (request.action === 'preparePayment') {
          const file = this.files.get(request.workbookId!)
          const amount = request.amount
          const startRow = request.startRow!
          const maxRows = request.maxRows!

          if (!file) {
            return bad('INVALID_WORKBOOK')
          }

          if (!validAmount(amount)) {
            return bad('INVALID_AMOUNT')
          }
          if (!validRow(startRow, 1) || !validRow(maxRows, 0)) {
            return bad('INVALID_RANGE')
          }

          if (request.mode !== 'standard' && request.mode !== 'new-order') {
            return bad('INVALID_MODE')
          }
          if (request.transport === 'cdp' && request.mode !== 'standard') return bad('INVALID_MODE')

          args = { amount: amount!, maxRows, mode: request.mode, startRow, workbook: file }
          if (request.transport !== undefined) args.transport = request.transport
        } else if (['start', 'startPayment', 'pausePayment', 'resumePayment', 'stop'].includes(request.action)) {
          if (request.taskId !== this.taskId) {
            return bad('TASK_NOT_FOUND')
          }
          if (['start', 'startPayment'].includes(request.action) &&
              (this.taskState !== 'awaiting_confirmation' || this.taskKind !== (request.action === 'start' ? 'review' : 'payment'))) {
            return bad('NOT_PREPARED')
          }
          if (request.action === 'pausePayment' || request.action === 'resumePayment') {
            if (this.taskKind !== 'payment') return bad('NOT_PAYMENT_TASK')
            if (request.action === 'pausePayment' && this.taskState !== 'running') return bad('NOT_RUNNING')
            if (request.action === 'resumePayment' && this.taskState !== 'paused' && this.taskState !== 'pausing') return bad('NOT_PAUSED')
          }

          args = { taskId: request.taskId! }
        }

        const result = request.action === 'startPayment' || request.action === 'resumePayment'
          ? await this.host.request(request.action, args, { before: () => this.current(), foreground: this.paymentTransport !== 'cdp' })
          : await this.host.request(request.action, args)
        this.current()

        if (request.action === 'capabilities') {
          const capabilities = result as DoudianReply['capabilities']
          return { ok: true, capabilities: capabilities && {
            ...capabilities,
            authorized: capabilities.authorized === true && capabilities.authorizationMode === 'enterprise-session-v1'
          } }
        }

        if (request.action === 'shops') {
          return { ok: true, shops: result as DoudianReply['shops'] }
        }

        if (request.action === 'manageShops') {
          return { ok: true }
        }

        if (request.action === 'shopManagementList') {
          if (!Array.isArray(result)) return bad('DOUDIAN_PROTOCOL_ERROR')
          const managedShops: NonNullable<DoudianReply['managedShops']> = []
          for (const item of result) {
            if (!item || !validId(item.id) || typeof item.name !== 'string' ||
              !(item.alias === null || typeof item.alias === 'string') || typeof item.pinned !== 'boolean' ||
              !Number.isSafeInteger(item.sortOrder) || typeof item.pendingLogin !== 'boolean' ||
              typeof item.pendingDeletion !== 'boolean' || !(item.status === null || typeof item.status === 'string')) return bad('DOUDIAN_PROTOCOL_ERROR')
            if (['verifiedName', 'platformId', 'feigeStatus', 'checkedAt', 'feigeCheckedAt'].some(key => !(item[key] === null || typeof item[key] === 'string'))) return bad('DOUDIAN_PROTOCOL_ERROR')
            managedShops.push({ id: item.id, name: item.name, alias: item.alias, pinned: item.pinned,
              sortOrder: item.sortOrder, pendingLogin: item.pendingLogin, pendingDeletion: item.pendingDeletion, status: item.status,
              verifiedName: item.verifiedName, platformId: item.platformId, feigeStatus: item.feigeStatus, checkedAt: item.checkedAt, feigeCheckedAt: item.feigeCheckedAt })
          }
          return { ok: true, managedShops }
        }
        if (['shopManagementAdd', 'shopManagementRename', 'shopManagementPin', 'shopManagementMove'].includes(request.action)) {
          const mutation = result as { id?: unknown; updated?: unknown } | null
          if (request.action === 'shopManagementAdd') {
            if (!validId(mutation?.id)) return bad('DOUDIAN_PROTOCOL_ERROR')
            return { ok: true, shopMutation: { id: mutation!.id as string } }
          }
          if (mutation?.updated !== true) return bad('DOUDIAN_PROTOCOL_ERROR')
          return { ok: true, shopMutation: { updated: true } }
        }
        if (request.action === 'shopManagementPrepareDelete') {
          const token = result as { confirmation?: unknown; expiresSeconds?: unknown; effect?: unknown } | null
          if (!validId(token?.confirmation) || token?.expiresSeconds !== 120 || token.effect !== 'delete_local_profiles_and_list_keep_history') return bad('DOUDIAN_PROTOCOL_ERROR')
          return { ok: true, shopDeleteConfirmation: { confirmation: token.confirmation as string, expiresSeconds: 120, effect: token.effect } }
        }
        if (['shopLoginStart', 'shopCheckStart', 'shopOperationStatus', 'shopLoginConfirm', 'shopLoginFinishFeige', 'shopOperationCancel'].includes(request.action)) {
          const value = result as DoudianReply['shopOperation']
          const textOrNull = (v: unknown) => v === null || typeof v === 'string'
          const identity = (v: unknown): v is { name: string | null; platformId: string | null } => !!v && typeof v === 'object' && textOrNull((v as { name?: unknown }).name) && textOrNull((v as { platformId?: unknown }).platformId)
          if (!value || !validId(value.taskId) || !validId(value.shopId) || !['shop-login', 'shop-check'].includes(value.kind) ||
              !['running', 'awaiting_confirmation', 'stopping', 'completed', 'stopped', 'failed'].includes(value.state) ||
              !['opening_browser', 'waiting_for_login', 'confirm_identity', 'verifying_identity', 'feige', 'checking', 'closing', 'rejected', 'done'].includes(value.phase) ||
              !(value.candidate === null || identity(value.candidate)) || !identity(value.bound) || !textOrNull(value.merchantStatus) ||
              !textOrNull(value.feigeStatus) || !textOrNull(value.error) || typeof value.bindingSaved !== 'boolean') return bad('DOUDIAN_PROTOCOL_ERROR')
          if (request.action === 'shopLoginStart' || request.action === 'shopCheckStart') {
            if (value.shopId !== request.shopId || value.kind !== (request.action === 'shopLoginStart' ? 'shop-login' : 'shop-check')) return bad('DOUDIAN_PROTOCOL_ERROR')
            this.shopOperation = { taskId: value.taskId, shopId: value.shopId, kind: value.kind }
          } else if (!this.shopOperation || value.taskId !== this.shopOperation.taskId || value.shopId !== this.shopOperation.shopId || value.kind !== this.shopOperation.kind) return bad('DOUDIAN_PROTOCOL_ERROR')
          this.taskId = value.taskId
          this.taskKind = value.kind
          this.taskState = value.state
          return { ok: true, shopOperation: { taskId: value.taskId, shopId: value.shopId, kind: value.kind, state: value.state, phase: value.phase,
            candidate: value.candidate && { name: value.candidate.name, platformId: value.candidate.platformId }, bound: { name: value.bound.name, platformId: value.bound.platformId },
            merchantStatus: value.merchantStatus, feigeStatus: value.feigeStatus, bindingSaved: value.bindingSaved, error: value.error } }
        }

        const task = result as DoudianTask

        if (
          !task ||
          !([
            'idle',
            'preparing',
            'awaiting_confirmation',
            'running',
            'stopping',
            'stopped',
            'completed',
            'failed'
          ].includes(task.state) || (['payment', 'payment-window'].includes(task.kind ?? '') &&
            ['pausing', 'paused', 'paused_balance', 'paused_review'].includes(task.state))) ||
          !Number.isSafeInteger(task.saved) ||
          task.saved < 0 ||
          !Array.isArray(task.messages)
        ) {
          this.taskState = 'unknown'

          return bad('DOUDIAN_PROTOCOL_ERROR')
        }

        const expectedKind = request.action === 'prepare' || request.action === 'start' ? 'review' :
          ['preparePayment', 'startPayment', 'pausePayment', 'resumePayment'].includes(request.action) ? 'payment' :
          request.action === 'openPayment' ? 'payment-window' : request.action === 'openReview' ? 'review-window' :
          request.action === 'openFeige' ? 'feige-window' : request.action === 'shopManagementDelete' ? 'shop-delete' :
          request.action === 'stop' ? this.taskKind : undefined
        const kindValid = ['review', 'payment', 'payment-window', 'review-window', 'feige-window', 'shop-delete', 'shop-login', 'shop-check'].includes(task.kind ?? '')
        const wrongStatusOwner = request.action === 'status' && this.taskId &&
          (task.taskId !== this.taskId || task.kind !== this.taskKind)
        if (!kindValid || (task.state !== 'idle' && !validId(task.taskId)) ||
            (expectedKind && task.kind !== expectedKind) || wrongStatusOwner ||
            (['start', 'startPayment', 'pausePayment', 'resumePayment', 'stop'].includes(request.action) && task.taskId !== request.taskId)) {
          this.close()
          return bad('DOUDIAN_PROTOCOL_ERROR')
        }

        this.taskId = task.taskId ?? undefined
        this.taskKind = task.kind
        this.taskState = task.state
        if (request.action === 'preparePayment') this.paymentTransport = request.transport ?? 'desktop'
        else if (task.kind !== 'payment') this.paymentTransport = undefined

        return { ok: true, task }
      } finally {
        this.exclusive = false
      }
    } catch (error) {
      const rawCode = error instanceof Error ? error.message : 'DOUDIAN_FAILED'
      const code = rawCode

      if (code === 'DOUDIAN_HOST_LOST' || code === 'DOUDIAN_FORBIDDEN') {
        this.close()
      }

      return { ok: false, error: code.slice(0, 500) }
    }
  }
}
