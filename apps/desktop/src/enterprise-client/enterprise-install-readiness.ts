import { atom } from 'nanostores'

export interface EnterpriseInstallActivity {
  blocker(): string | null
  flush?(): Promise<void>
  stopPlayback?(): Promise<void>
}

export interface EnterpriseInstallReadiness {
  ready: boolean
  reasons: string[]
  revision: number
}

export const $enterprisePackageInstallFrozen = atom(false)
export const $enterpriseInstallActivityRevision = atom(0)
const activities = new Set<EnterpriseInstallActivity>()
let transaction: { id: string; cancel(): void } | null = null

function changed(): void {
  $enterpriseInstallActivityRevision.set($enterpriseInstallActivityRevision.get() + 1)
}

export function registerEnterpriseInstallActivity(activity: EnterpriseInstallActivity) {
  activities.add(activity)
  changed()

  return {
    changed,
    dispose() {
      if (activities.delete(activity)) {changed()}
    }
  }
}

export function releaseEnterprisePackageInstall(transactionId?: string): void {
  if (transactionId !== undefined && transaction?.id !== transactionId) {return}
  const previous = transaction
  transaction = null
  $enterprisePackageInstallFrozen.set(false)
  previous?.cancel()
}

/** This is a content-preservation barrier, not a product permission check. */
export async function prepareEnterprisePackageInstall(transactionId: string): Promise<EnterpriseInstallReadiness> {
  if (transaction) {return { ready: false, reasons: ['另一次客户端更新正在准备安装。'], revision: $enterpriseInstallActivityRevision.get() }}
  let cancel!: () => void
  const cancelled = new Promise<never>((_resolve, reject) => { cancel = () => reject(new Error('更新准备已取消，当前内容仍保留。')) })
  const current = { id: transactionId, cancel }
  transaction = current
  $enterprisePackageInstallFrozen.set(true)
  const owners = [...activities]

  const check = () => {
    if (transaction !== current || owners.length !== activities.size || owners.some(owner => !activities.has(owner))) {
      throw new Error('工作区或登录状态已变化，请重新尝试更新。')
    }

    const reasons = [...new Set(owners.map(owner => owner.blocker()).filter((reason): reason is string => Boolean(reason)))]

    if (reasons.length) {throw new Error(reasons.join('\n'))}
  }

  const timer = setTimeout(cancel, 15_000)

  try {
    await Promise.race([cancelled, (async () => {
      check()
      await Promise.all(owners.map(owner => owner.flush?.()))
      check()
      await Promise.all(owners.map(owner => owner.stopPlayback?.()))
      check()
    })()])

    return { ready: true, reasons: [], revision: $enterpriseInstallActivityRevision.get() }
  } catch (reason) {
    if (transaction === current) {releaseEnterprisePackageInstall(transactionId)}

    return { ready: false, reasons: [reason instanceof Error ? reason.message : '当前工作尚未保存，暂不能安装更新。'], revision: $enterpriseInstallActivityRevision.get() }
  } finally {
    clearTimeout(timer)
  }
}
