import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

import type { ShopBrowserReply, ShopCsvExportResult, ShopCsvLocale } from './shop-browser-types'

// Kept in sync with the existing native-ui CSV headers without importing the renderer into Electron.
const headers: Record<ShopCsvLocale, readonly [string, string]> = {
  zh: ['店铺名', '打款金额'],
  'zh-hant': ['店鋪名', '打款金額'],
  en: ['Shop name', 'Payment amount'],
  ja: ['店舗名', '支払額'],
  ar: ['اسم المتجر', 'مبلغ الدفع']
}

type Scope = { origin: string; tenantId: string; principalId: string; role?: string }
type FileHandle = { writeFile(data: string, encoding: 'utf8'): Promise<void>; close(): Promise<void> }
export type ShopCsvIO = {
  open(file: string, flags: 'wx', mode: number): Promise<FileHandle>
  rename(from: string, to: string): Promise<void>
  unlink(file: string): Promise<void>
}
export type ShopCsvDependencies = {
  authorize(): Promise<Scope>
  current(): boolean
  epoch(): number
  list(): Promise<ShopBrowserReply>
  choose(defaultName: string): Promise<string | undefined>
  io?: ShopCsvIO
  now?: () => Date
}

const locales = new Set(['zh', 'zh-hant', 'en', 'ja', 'ar'])

export function isShopCsvExportRequest(value: unknown): value is { sessionId: string; action: 'exportCsv'; locale: ShopCsvLocale } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {return false}
  const request = value as Record<string, unknown>

  return Object.keys(request).length === 3 && Object.keys(request).every(key => ['sessionId', 'action', 'locale'].includes(key)) &&
    typeof request.sessionId === 'string' && request.sessionId.length > 0 && request.action === 'exportCsv' &&
    typeof request.locale === 'string' && locales.has(request.locale)
}

function scopeKey(scope: Scope): string {
  return JSON.stringify([scope.origin, scope.tenantId, scope.principalId, scope.role])
}

const inflight = new Set<string>()

/** Save only a current, authorized projection. The selected path never reaches the renderer. */
export async function exportShopCsv(locale: ShopCsvLocale, deps: ShopCsvDependencies): Promise<ShopCsvExportResult> {
  let key = ''
  let lockKey = ''
  let temp: string | undefined
  let handle: FileHandle | undefined
  let created = false
  let acquired = false
  let epoch: number | undefined
  let stage: 'authorize' | 'dialog' | 'list' | 'write' = 'authorize'
  const io: ShopCsvIO = deps.io ?? fs

  try {
    const initial = await deps.authorize()
    epoch = deps.epoch()
    key = scopeKey(initial)
    lockKey = JSON.stringify([initial.origin, initial.tenantId, initial.principalId])

    if (!deps.current()) {return {status:'owner_changed'}}

    if (inflight.has(lockKey)) {return {status:'busy'}}
    inflight.add(lockKey)
    acquired = true

    const defaultName = `shops-${(deps.now?.() ?? new Date()).toISOString().slice(0, 10)}.csv`
    stage = 'dialog'
    const destination = await deps.choose(defaultName)

    if (!deps.current() || deps.epoch() !== epoch) {return {status:'owner_changed'}}

    stage = 'authorize'
    const afterDialog = await deps.authorize()

    if (!deps.current() || deps.epoch() !== epoch || scopeKey(afterDialog) !== key) {return {status:'owner_changed'}}

    if (!destination) {return {status:'canceled'}}
    stage = 'list'
    const reply = await deps.list()

    if (!deps.current() || deps.epoch() !== epoch) {return {status:'owner_changed'}}

    if (!reply.ok) {
      if (reply.error === 'SHOP_PROFILE_OWNER_CHANGED') {return {status:'owner_changed'}}

      if (reply.error === 'SHOP_PROFILE_FORBIDDEN' || reply.error === 'SHOP_PROFILE_ACCESS_UNAVAILABLE') {return {status:'authorization_unavailable'}}

      return {status:'cloud_unavailable'}
    }

    if (reply.cloud?.state !== 'synced' || !Array.isArray(reply.profiles)) {return {status:'cloud_unavailable'}}
    const profiles = reply.profiles

    if (!profiles.length) {return {status:'empty'}}

    if (profiles.some(profile => profile.tenantId !== initial.tenantId || profile.principalId !== initial.principalId)) {
      return {status:'owner_changed'}
    }

    const [shopNameHeader, amountHeader] = headers[locale]
    const quote = (value: string) => `"${value.replaceAll('"', '""')}"`
    const rows = profiles.map(profile => [profile.shopName || profile.displayName, profile.payoutSettings?.remitAmount ?? ''].map(quote).join(','))
    const csv = '\uFEFF' + [shopNameHeader + ',' + amountHeader, ...rows].join('\r\n')
    stage = 'write'
    temp = path.join(path.dirname(destination), `.${path.basename(destination)}.${randomUUID()}.tmp`)
    handle = await io.open(temp, 'wx', 0o600)
    created = true
    await handle.writeFile(csv, 'utf8')
    await handle.close()
    handle = undefined

    if (!deps.current() || deps.epoch() !== epoch) {return {status:'owner_changed'}}
    await io.rename(temp, destination)
    created = false

    return {status:'saved', count:profiles.length}
  } catch {
    return {status:!deps.current() || (epoch !== undefined && deps.epoch() !== epoch) ? 'owner_changed' : stage === 'authorize' ? 'authorization_unavailable' : stage === 'list' ? 'cloud_unavailable' : 'write_failed'}
  } finally {
    if (handle) {await handle.close().catch(() => {})}

    if (created && temp) {await io.unlink(temp).catch(() => {})}

    if (acquired) {inflight.delete(lockKey)}
  }
}
