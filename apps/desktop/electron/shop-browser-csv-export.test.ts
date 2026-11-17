import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, expect, it, vi } from 'vitest'

import type { CloudShopRecord, PortableShopSession, ShopProfileCloud } from './shop-browser-cloud'
import { exportShopCsv, isShopCsvExportRequest } from './shop-browser-csv-export'
import type { ShopCsvDependencies, ShopCsvIO } from './shop-browser-csv-export'
import { ShopBrowserRuntime } from './shop-browser-runtime'
import type { ShopBrowserProfile, ShopBrowserReply } from './shop-browser-types'

const roots: string[] = []
afterEach(async () => {for (const root of roots.splice(0)) {await fs.rm(root, {recursive:true, force:true})}})

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hermes-csv-synthetic-'))
  roots.push(root)
  const target = path.join(root, 'out.csv')
  const scope = {origin:'https://enterprise.example', tenantId:'tenant-a', principalId:'person-a', role:'operator'}
  let live = true
  let epoch = 1
  const profiles = [{id:'synthetic-secret-id', tenantId:'tenant-a', principalId:'person-a', displayName:'显示名', shopName:'店铺"A\nB', payoutSettings:{remitAmount:'5'}}] as ShopBrowserProfile[]

  const deps: ShopCsvDependencies = {
    authorize: vi.fn(async () => ({...scope})), current: () => live, epoch: () => epoch,
    list: vi.fn(async (): Promise<ShopBrowserReply> => ({ok:true, profiles, cloud:{state:'synced', checkedAt:'2026-11-17'}})),
    choose: vi.fn(async () => target), now: () => new Date('2026-11-17T00:00:00Z')
  }

  return {root, target, scope, profiles, deps, invalidate:() => {live = false}, changeEpoch:() => {epoch++}}
}

it('accepts only the narrow session action and five locale values', () => {
  for (const locale of ['zh', 'zh-hant', 'en', 'ja', 'ar']) {expect(isShopCsvExportRequest({sessionId:'s', action:'exportCsv', locale})).toBe(true)}

  for (const request of [null, {}, {sessionId:'s', action:'exportCsv', locale:'zh', path:'C:/x'}, {sessionId:'s', action:'exportCsv', locale:'zh', data:'secret'}, {sessionId:'s', action:'exportCsv', locale:'other'}]) {
    expect(isShopCsvExportRequest(request)).toBe(false)
  }
})

it('writes a fresh authorized two-field CSV to the chosen file, preserving encoding and quoting', async () => {
  const f = await fixture()
  const result = await exportShopCsv('zh', f.deps)
  expect(result).toEqual({status:'saved', count:1})
  expect(f.deps.choose).toHaveBeenCalledWith('shops-2026-11-17.csv')
  expect(f.deps.authorize).toHaveBeenCalledTimes(2)
  expect(f.deps.list).toHaveBeenCalledTimes(1)
  const bytes = await fs.readFile(f.target)
  expect(bytes.subarray(0,3)).toEqual(Buffer.from([0xef,0xbb,0xbf]))
  expect(bytes.toString('utf8')).toBe('\uFEFF店铺名,打款金额\r\n"店铺""A\nB","5"')
  expect(bytes.toString('utf8')).not.toContain('synthetic-secret-id')
  expect(await fs.readdir(f.root)).toEqual(['out.csv'])
})

it.each([['zh','店铺名','打款金额'], ['zh-hant','店鋪名','打款金額'], ['en','Shop name','Payment amount'], ['ja','店舗名','支払額'], ['ar','اسم المتجر','مبلغ الدفع']] as const)('writes the original %s locale header', async (locale, shopHeader, amountHeader) => {
  const f = await fixture()
  const source = await fs.readFile(new URL('../src/i18n/native-ui.ts', import.meta.url), 'utf8')
  const start = locale === 'zh' ? source.indexOf('const zh = {') : source.indexOf(locale === 'zh-hant' ? "'zh-hant': {" : `  ${locale}: {`)
  const end = source.indexOf(locale === 'zh' ? '\n}' : '\n  }', start)
  const original = source.slice(start, end)
  expect(start).toBeGreaterThanOrEqual(0)
  expect(original).toContain(`csvShopName: '${shopHeader}'`)
  expect(original).toContain(`amount: '${amountHeader}'`)
  expect(await exportShopCsv(locale, f.deps)).toEqual({status:'saved', count:1})
  expect((await fs.readFile(f.target, 'utf8')).startsWith(`\uFEFF${shopHeader},${amountHeader}\r\n`)).toBe(true)
})

it('handles cancellation, no data and cloud failure without a final file', async () => {
  const f = await fixture()
  f.deps.choose = vi.fn(async () => undefined)
  expect(await exportShopCsv('zh', f.deps)).toEqual({status:'canceled'})
  expect(f.deps.authorize).toHaveBeenCalledTimes(2)
  expect(f.deps.list).not.toHaveBeenCalled()
  f.deps.choose = vi.fn(async () => f.target)
  f.deps.list = vi.fn(async (): Promise<ShopBrowserReply> => ({ok:true, profiles:[], cloud:{state:'synced', checkedAt:''}}))
  expect(await exportShopCsv('zh', f.deps)).toEqual({status:'empty'})
  f.deps.list = vi.fn(async (): Promise<ShopBrowserReply> => ({ok:true, profiles:f.profiles, cloud:{state:'unavailable', checkedAt:''}}))
  expect(await exportShopCsv('zh', f.deps)).toEqual({status:'cloud_unavailable'})
  f.deps.list = vi.fn(async (): Promise<ShopBrowserReply> => ({ok:true, cloud:{state:'synced', checkedAt:''}}))
  expect(await exportShopCsv('zh', f.deps)).toEqual({status:'cloud_unavailable'})
  expect(await fs.readdir(f.root)).toEqual([])
})

it('keeps a same-identity operation gated until the first dialog completes', async () => {
  const f = await fixture()
  let finish!: (value: string | undefined) => void
  f.deps.choose = vi.fn(() => new Promise<string | undefined>(resolve => {finish = resolve}))
  const first = exportShopCsv('zh', f.deps)
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  expect(await exportShopCsv('zh', f.deps)).toEqual({status:'busy'})
  expect(await exportShopCsv('zh', f.deps)).toEqual({status:'busy'})
  finish(undefined)
  expect(await first).toEqual({status:'canceled'})
  expect(f.deps.choose).toHaveBeenCalledTimes(1)
})

it('keeps the identity gate active if its role changes while the dialog is open', async () => {
  const f = await fixture()
  let finish!: (value: string | undefined) => void
  f.deps.choose = vi.fn(() => new Promise<string | undefined>(resolve => {finish = resolve}))
  const first = exportShopCsv('zh', f.deps)
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  f.scope.role = 'tenant_admin'
  expect(await exportShopCsv('zh', f.deps)).toEqual({status:'busy'})
  finish(undefined)
  expect(await first).toEqual({status:'owner_changed'})
  expect(f.deps.choose).toHaveBeenCalledTimes(1)
})

it('rejects identity changes after the dialog and an observed epoch change during listing', async () => {
  const f = await fixture()
  f.deps.choose = vi.fn(async () => {f.scope.principalId = 'person-b';

 return f.target})
  expect(await exportShopCsv('zh', f.deps)).toEqual({status:'owner_changed'})
  expect(f.deps.list).not.toHaveBeenCalled()
  f.scope.principalId = 'person-a'
  f.deps.choose = vi.fn(async () => f.target)
  f.deps.list = vi.fn(async (): Promise<ShopBrowserReply> => {f.changeEpoch();

 return {ok:true, profiles:f.profiles, cloud:{state:'synced', checkedAt:''}}})
  expect(await exportShopCsv('zh', f.deps)).toEqual({status:'owner_changed'})
  expect(await fs.readdir(f.root)).toEqual([])
})

it('fails closed on foreign rows, failed authorization and list rejection', async () => {
  const f = await fixture()
  f.profiles[0].tenantId = 'other-tenant'
  expect(await exportShopCsv('zh', f.deps)).toEqual({status:'owner_changed'})
  f.profiles[0].tenantId = 'tenant-a'
  f.deps.authorize = vi.fn(async () => {throw new Error('credential contents must not escape')})
  expect(await exportShopCsv('zh', f.deps)).toEqual({status:'authorization_unavailable'})
  f.deps.authorize = vi.fn(async () => ({...f.scope}))
  f.deps.list = vi.fn(async () => {throw new Error('secret')})
  expect(await exportShopCsv('zh', f.deps)).toEqual({status:'cloud_unavailable'})
  expect(await fs.readdir(f.root)).toEqual([])
})

it.each([
  ['SHOP_PROFILE_OWNER_CHANGED', 'owner_changed'],
  ['SHOP_PROFILE_FORBIDDEN', 'authorization_unavailable'],
  ['SHOP_PROFILE_ACCESS_UNAVAILABLE', 'authorization_unavailable'],
  ['SHOP_PROFILE_STORE_INVALID', 'cloud_unavailable']
] as const)('maps the existing %s list failure without exposing raw details', async (error, status) => {
  const f = await fixture()
  f.deps.list = vi.fn(async (): Promise<ShopBrowserReply> => ({ok:false, error}))
  expect(await exportShopCsv('zh', f.deps)).toEqual({status})
  expect(await fs.readdir(f.root)).toEqual([])
})

it('removes the temporary file if the local identity epoch changes before commit', async () => {
  const f = await fixture()
  f.deps.io = {
    open: async (file, flags, mode) => {
      const real = await fs.open(file, flags, mode)

      return {writeFile:async (data, encoding) => {await real.writeFile(data, encoding); f.changeEpoch()}, close:() => real.close()}
    },
    rename:(from, to) => fs.rename(from, to), unlink:file => fs.unlink(file)
  }
  expect(await exportShopCsv('zh', f.deps)).toEqual({status:'owner_changed'})
  expect(await fs.readdir(f.root)).toEqual([])
})

it('refuses final placement when a role change is observed before commit', async () => {
  const f = await fixture()
  const rename = vi.fn((from: string, to: string) => fs.rename(from, to))
  f.deps.io = {
    open: async (file, flags, mode) => {
      const real = await fs.open(file, flags, mode)

      return {writeFile:(data, encoding) => real.writeFile(data, encoding), close:async () => {await real.close(); f.scope.role = 'tenant_admin'; f.changeEpoch()}}
    },
    rename, unlink:file => fs.unlink(file)
  }
  expect(await exportShopCsv('zh', f.deps)).toEqual({status:'owner_changed'})
  expect(rename).not.toHaveBeenCalled()
  expect(await fs.readdir(f.root)).toEqual([])
})

it.each(['open', 'write', 'close', 'rename'] as const)('reports %s errors and removes created temporary files', async stage => {
  const f = await fixture()

  const io: ShopCsvIO = {
    open: async (file, flags, mode) => {
      if (stage === 'open') {throw new Error('sensitive path')}
      const real = await fs.open(file, flags, mode)
      let closed = false

      return {writeFile: async (data, encoding) => {if (stage === 'write') {throw new Error('secret')} await real.writeFile(data, encoding)}, close: async () => {if (!closed) {closed = true; await real.close()}

 if (stage === 'close') {throw new Error('secret')}}}
    },
    rename: async (from, to) => {if (stage === 'rename') {throw new Error('secret')} await fs.rename(from, to)},
    unlink: file => fs.unlink(file)
  }

  f.deps.io = io
  expect(await exportShopCsv('zh', f.deps)).toEqual({status:'write_failed'})
  expect(await fs.readdir(f.root)).toEqual([])
})

it('keeps the committed saved result if identity becomes invalid immediately after rename', async () => {
  const f = await fixture()
  f.deps.io = {open: (file, flags, mode) => fs.open(file, flags, mode), unlink:file => fs.unlink(file), rename:async (from, to) => {await fs.rename(from, to); f.invalidate()}}
  expect(await exportShopCsv('zh', f.deps)).toEqual({status:'saved', count:1})
  expect(await fs.readFile(f.target, 'utf8')).toContain('店铺')
})

it('reports the completed save after a role change and rechecks the next export', async () => {
  const f = await fixture()
  const rename = vi.fn(async (from: string, to: string) => {await fs.rename(from, to); f.scope.role = 'tenant_admin'; f.changeEpoch()})
  f.deps.io = {open:(file, flags, mode) => fs.open(file, flags, mode), unlink:file => fs.unlink(file), rename}
  const saved = await exportShopCsv('zh', f.deps)
  expect(saved).toEqual({status:'saved', count:1})

  for (const secret of [f.target, f.profiles[0].id, f.profiles[0].shopName!, 'person-a', 'tenant-a']) {
    expect(JSON.stringify(saved)).not.toContain(secret)
  }

  expect(rename).toHaveBeenCalledTimes(1)
  expect(f.deps.list).toHaveBeenCalledTimes(1)

  const nextList = vi.fn(async (): Promise<ShopBrowserReply> => {
    expect(f.scope.role).toBe('tenant_admin')

    return {ok:true, profiles:[], cloud:{state:'synced', checkedAt:''}}
  })

  f.deps.list = nextList
  expect(await exportShopCsv('zh', f.deps)).toEqual({status:'empty'})
  expect(f.deps.authorize).toHaveBeenCalledTimes(4)
  expect(nextList).toHaveBeenCalledTimes(1)
  expect(rename).toHaveBeenCalledTimes(1)
  expect(await fs.readFile(f.target, 'utf8')).toContain('店铺')
})

it.each(['operator', 'tenant_admin'] as const)('exports the latest list through real shop runtime for a synthetic %s', async role => {
  const f = await fixture()
  const actor = role === 'operator' ? 'person-a' : 'admin-a'
  f.scope.principalId = actor
  f.scope.role = role
  const session: PortableShopSession = {version:1, cookies:[], origins:[]}

  const records: CloudShopRecord[] = [
    {profile_id:'11111111-1111-4111-8111-111111111111', revision:1, deleted:false, updated_at:'2026-11-17', servicing_principal_ids:['person-a'], profile:{display_name:'授权店铺', shop_id:'1001', shop_name:'授权"店铺', created_at:'2026-11-17', checked_at:null}, session, payout_settings:{remitAmount:'5', payoutReviewDays:15, payoutRequireReviewWithinDays:false, payoutGoodReviewMode:0, payoutRefundChannel:'small_remit'}, payout_settings_revision:1},
    {profile_id:'22222222-2222-4222-8222-222222222222', revision:1, deleted:false, updated_at:'2026-11-17', servicing_principal_ids:['person-b'], profile:{display_name:'其他店铺', shop_id:'1002', shop_name:'其他店铺', created_at:'2026-11-17', checked_at:null}, session}
  ]

  let revoked = false
  const visible = () => records.filter(record => !revoked && (role === 'tenant_admin' || record.servicing_principal_ids?.includes(actor)))

  const cloud: ShopProfileCloud = {
    list: async () => ({profiles:visible(), hiddenProfileIds:[]}),
    get: async id => structuredClone(visible().find(item => item.profile_id === id)!),
    save: async () => {throw new Error('unexpected')}, savePayoutSettings: async () => {throw new Error('unexpected')},
    hide: async () => {throw new Error('unexpected')}, assign: async () => {throw new Error('unexpected')}
  }

  const runtime = new ShopBrowserRuntime({
    root:path.join(f.root, 'isolated-userdata'), authorize:f.deps.authorize, isCurrent:f.deps.current, cloud,
    createView: async () => {throw new Error('unexpected view')}, clearStorage:async () => {},
    importSession:async () => {}, exportSession:async () => session,
    createExecution:async () => ({identify:async () => ({shopId:'1001', shopName:'授权"店铺'}), close:async () => {}, command:async () => ({})})
  })

  const observations: {ok:boolean; cloud?:string; count:number; error?:string}[] = []

  f.deps.list = async () => {
    const reply = await runtime.operate({sessionId:'synthetic-session', action:'list'})
    observations.push({ok:reply.ok, cloud:reply.cloud?.state, count:reply.profiles?.length ?? 0, error:reply.error})

    return reply
  }

  try {
    f.deps.choose = async () => f.target
    const result = await exportShopCsv('zh', f.deps)

    if (role === 'tenant_admin') {
      expect(result).toEqual({status:'saved', count:2})
      expect(await fs.readFile(f.target, 'utf8')).toContain('"其他店铺",""')

      // Synthetic server revokes visibility before the next dialog returns.
      f.deps.choose = async () => {revoked = true;

 return path.join(f.root, 'revoked.csv')}

      const revokedResult = await exportShopCsv('zh', f.deps)
      expect({revokedResult, observations}).toEqual({revokedResult:{status:'empty'}, observations:[{ok:true, cloud:'synced', count:2, error:undefined}, {ok:true, cloud:'synced', count:0, error:undefined}]})
      await expect(fs.stat(path.join(f.root, 'revoked.csv'))).rejects.toMatchObject({code:'ENOENT'})
    } else {
      expect(result).toEqual({status:'saved', count:1})
      expect(await fs.readFile(f.target, 'utf8')).toBe('\uFEFF店铺名,打款金额\r\n"授权""店铺","5"')
    }
  } finally {
    runtime.invalidate()
    await runtime.revalidate()
  }
})
