import { atom } from 'nanostores'

import type { EnterprisePackageUpdateState } from '../../electron/enterprise-package-updater-types'

import {
  $enterpriseInstallActivityRevision,
  prepareEnterprisePackageInstall,
  releaseEnterprisePackageInstall
} from './enterprise-install-readiness'

export const $enterprisePackageUpdate = atom<EnterprisePackageUpdateState | null>(null)
export const $enterprisePackageUpdateOpen = atom(false)
export const $enterprisePackageUpdateError = atom('')
export const $enterprisePackageUpdateBusy = atom(false)

type UpdateAction = 'check' | 'install-now' | 'download-for-next-launch' | 'cancel-scheduled'

/** This store is machine-scoped and contains no tenant or customer content. */
export function connectEnterprisePackageUpdates() {
  const bridge = window.hermesDesktop?.enterprise?.packageUpdate

  if (!bridge) {return () => undefined}
  let active = true
  let pushRevision = 0

  const removeStatus = bridge.onStatus(state => {
    pushRevision += 1
    $enterprisePackageUpdate.set(state)
  })

  const startRevision = pushRevision
  void bridge.status().then(state => {
    if (active && pushRevision === startRevision) {$enterprisePackageUpdate.set(state)}
  }).catch(() => {
    if (active) {$enterprisePackageUpdateError.set('暂时无法读取客户端版本，请重试')}
  })

  const removePrepare = bridge.onPrepare(({ transactionId }) => {
    void prepareEnterprisePackageInstall(transactionId).then(result => {
      if (active) {bridge.ready({ transactionId, ...result })}
    }).catch(() => {
      releaseEnterprisePackageInstall(transactionId)

      if (active) {bridge.ready({ transactionId, ready: false, reasons: ['工作尚未保存，请检查后重试'], revision: $enterpriseInstallActivityRevision.get() })}
    })
  })

  const removeRelease = bridge.onRelease(({ transactionId }) => releaseEnterprisePackageInstall(transactionId))
  const removeRevision = $enterpriseInstallActivityRevision.subscribe(revision => bridge.changed({ revision }))

  return () => {
    active = false
    removeStatus()
    removePrepare()
    removeRelease()
    removeRevision()
    releaseEnterprisePackageInstall()
  }
}

export async function commandEnterprisePackageUpdate(action: UpdateAction) {
  const bridge = window.hermesDesktop?.enterprise?.packageUpdate

  if (!bridge || $enterprisePackageUpdateBusy.get()) {return}
  $enterprisePackageUpdateBusy.set(true)
  $enterprisePackageUpdateError.set('')

  try {
    $enterprisePackageUpdate.set(await bridge.command({ action }))
  } catch {
    $enterprisePackageUpdateError.set('更新操作未完成，客户端仍可继续使用，请重试')
  } finally {
    $enterprisePackageUpdateBusy.set(false)
  }
}
