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
  const allowed = ['openReview', 'shops', 'manageShops', 'prepare', 'start'].includes(action) ? enabled(review)
    : ['openPayment', 'preparePayment', 'startPayment'].includes(action) ? enabled(payment)
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
  constructor(executable: string) {
    this.child = spawn(executable, ['--hermes-review-host'], {
      shell: false,
      // The host creates the original WinForms windows in this process.
      windowsHide: false,
      cwd: path.dirname(executable),
      stdio: 'pipe'
    })
    this.child.stderr.resume()
    this.child.stdout.on('data', data => this.receive(this.decoder.write(data)))
    this.child.on('error', () => this.fail('DOUDIAN_HOST_LOST'))
    this.child.on('exit', () => this.fail('DOUDIAN_HOST_LOST'))
    this.child.stdin.on('error', () => this.fail('DOUDIAN_HOST_LOST'))
  }
  private receive(chunk: string) {
    this.buffer += chunk

    if (this.buffer.length > 262144) {
      this.close()

      return
    }

    let end: number

    while ((end = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, end)
      this.buffer = this.buffer.slice(end + 1)

      try {
        const message = JSON.parse(line)

        if (message.event === 'paymentAuthorization') {
          // A legacy host is not allowed to request an obsolete grant or proceed.
          this.close()
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
        this.close()

        return
      }
    }
  }
  request(method: string, params: Record<string, string> = {}): Promise<unknown> {
    if (this.closed) {
      return Promise.reject(new Error('DOUDIAN_HOST_LOST'))
    }

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
  authorize(action: DoudianRequest['action']): Promise<string>
  isCurrent(): boolean
  chooseWorkbook(): Promise<string | null>
  createHost?(executable: string): Pick<DoudianHost, 'request' | 'close'>
  verify?(root: string): Promise<string>
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
  constructor(private deps: DoudianDependencies) {}
  close() {
    this.lost = true
    this.host?.close()
    this.files.clear()
  }
  private current() {
    if (this.lost || !this.deps.isCurrent()) {
      this.close()

      return bad('DOUDIAN_OWNER_CHANGED')
    }
  }
  async operate(request: DoudianRequest): Promise<DoudianReply> {
    try {
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
        chooseWorkbook: [],
        prepare: ['shopId', 'workbookId'],
        preparePayment: ['workbookId', 'amount', 'startRow', 'maxRows', 'mode'],
        start: ['taskId'],
        startPayment: ['taskId'],
        status: [],
        stop: ['taskId']
      }

      const allowed = Object.hasOwn(fields, request?.action ?? '') ? fields[request.action] : undefined

      if (
        !allowed ||
        Object.keys(request).some(key => !['sessionId', 'action', ...allowed].includes(key)) ||
        allowed.some(key => typeof request[key as keyof DoudianRequest] !== 'string') ||
        ['shopId', 'workbookId', 'taskId'].some(key => allowed.includes(key) && !validId(request[key as keyof DoudianRequest]))
      ) {
        return bad('DOUDIAN_INVALID_REQUEST')
      }

      // Stop is always available to the same fenced session, even during an enterprise network outage.
      if (request.action !== 'stop') {
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

      if (this.exclusive) {
        return bad('TASK_BUSY')
      }

      this.exclusive = true

      try {
        if (!this.host) {
          const executable = await (this.deps.verify ?? verifiedDoudianExecutable)(this.deps.root)
          this.current()

          this.host = this.deps.createHost?.(executable) ?? new DoudianHost(executable)

          const init = (await this.host.request('initialize', { scope: this.owner! })) as {
            protocol?: number
            integration?: string
            version?: string
            taskIsolation?: string
          }

          if (init.protocol !== 1 || init.integration !== 'hermes-review-v1' || init.version !== '1.0.54') {
            this.close()

            return bad('DOUDIAN_MODULE_INVALID')
          }
          if (init.taskIsolation !== isolationCapability) {
            this.close()
            return bad('DOUDIAN_MODULE_INCOMPATIBLE')
          }
        }

        this.current()

        if (request.action === 'openPayment') {
          const capabilities = (await this.host.request('capabilities')) as DoudianReply['capabilities']
          this.current()
          if (capabilities?.protocol !== 1 || capabilities.version !== '1.0.54' || capabilities.paymentUi !== 1) {
            return bad('PAYMENT_MODULE_MISSING')
          }
        }

        if (request.action === 'openReview' || request.action === 'openFeige') {
          const capabilities = (await this.host.request('capabilities')) as DoudianReply['capabilities']
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
            !['.xlsx', '.xls'].includes(path.extname(canonical).toLowerCase()) ||
            !(await fs.stat(canonical)).isFile()
          ) {
            return bad('INVALID_WORKBOOK')
          }

          const workbookId = id()
          this.files.clear()
          this.files.set(workbookId, canonical)

          return { ok: true, workbook: { id: workbookId, name: path.basename(canonical) } }
        }

        let args: Record<string, string> = {}

        if (request.action === 'prepare') {
          const file = this.files.get(request.workbookId!)

          if (!file) {
            return bad('INVALID_WORKBOOK')
          }

          args = { shopId: request.shopId!, workbook: file }
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

          args = { amount: amount!, maxRows, mode: request.mode, startRow, workbook: file }
        } else if (request.action === 'start' || request.action === 'startPayment' || request.action === 'stop') {
          if (request.taskId !== this.taskId) {
            return bad('TASK_NOT_FOUND')
          }
          if (request.action !== 'stop' &&
              (this.taskState !== 'awaiting_confirmation' || this.taskKind !== (request.action === 'start' ? 'review' : 'payment'))) {
            return bad('NOT_PREPARED')
          }

          args = { taskId: request.taskId! }
        }

        const result = await this.host.request(request.action, args)
        this.current()

        if (request.action === 'capabilities') {
          return { ok: true, capabilities: result as DoudianReply['capabilities'] }
        }

        if (request.action === 'shops') {
          return { ok: true, shops: result as DoudianReply['shops'] }
        }

        if (request.action === 'manageShops') {
          return { ok: true }
        }

        const task = result as DoudianTask

        if (
          !task ||
          ![
            'idle',
            'preparing',
            'awaiting_confirmation',
            'running',
            'stopping',
            'stopped',
            'completed',
            'failed'
          ].includes(task.state) ||
          !Number.isSafeInteger(task.saved) ||
          task.saved < 0 ||
          !Array.isArray(task.messages)
        ) {
          return bad('DOUDIAN_PROTOCOL_ERROR')
        }

        const expectedKind = request.action === 'prepare' || request.action === 'start' ? 'review' :
          request.action === 'preparePayment' || request.action === 'startPayment' ? 'payment' :
          request.action === 'openPayment' ? 'payment-window' : request.action === 'openReview' ? 'review-window' :
          request.action === 'openFeige' ? 'feige-window' : undefined
        const kindValid = ['review', 'payment', 'payment-window', 'review-window', 'feige-window'].includes(task.kind ?? '')
        const wrongStatusOwner = request.action === 'status' && this.taskId &&
          (task.taskId !== this.taskId || task.kind !== this.taskKind)
        if (!kindValid || (task.state !== 'idle' && !validId(task.taskId)) ||
            (expectedKind && task.kind !== expectedKind) || wrongStatusOwner ||
            (['start', 'startPayment', 'stop'].includes(request.action) && task.taskId !== request.taskId)) {
          this.close()
          return bad('DOUDIAN_PROTOCOL_ERROR')
        }

        this.taskId = task.taskId ?? undefined
        this.taskKind = task.kind
        this.taskState = task.state

        return { ok: true, task }
      } finally {
        this.exclusive = false
      }
    } catch (error) {
      const code = error instanceof Error ? error.message : 'DOUDIAN_FAILED'

      if (code === 'DOUDIAN_HOST_LOST' || code === 'DOUDIAN_FORBIDDEN') {
        this.close()
      }

      return { ok: false, error: code.slice(0, 500) }
    }
  }
}
