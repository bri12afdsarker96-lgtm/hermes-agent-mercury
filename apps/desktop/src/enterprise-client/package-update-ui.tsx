import { useStore } from '@nanostores/react'
import { type ReactNode, useEffect } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

import { $enterprisePackageInstallFrozen } from './enterprise-install-readiness'
import {
  $enterprisePackageUpdate,
  $enterprisePackageUpdateBusy,
  $enterprisePackageUpdateError,
  $enterprisePackageUpdateOpen,
  commandEnterprisePackageUpdate,
  connectEnterprisePackageUpdates
} from './package-update-store'

function browserDownloadUrl(): string | null {
  if (typeof document === 'undefined' || document.documentElement.dataset.hermesSurface !== 'web') {
    return null
  }

  const url = document.documentElement.dataset.hermesDesktopDownloadUrl

  // The web bootstrap owns this value. Keep the shared desktop component from
  // ever becoming a general external-link sink.
  return url?.startsWith('/desktop-updates/windows/x64/Hermes-') ? url : null
}

function isBrowserSurface(): boolean {
  return typeof document !== 'undefined' && document.documentElement.dataset.hermesSurface === 'web'
}

export function EnterprisePackageUpdateButton() {
  const state = useStore($enterprisePackageUpdate)
  const downloadUrl = browserDownloadUrl()

  if (downloadUrl) {
    return (
      <Button asChild className="hesc-package-update-trigger" size="sm" variant="ghost">
        <a download href={downloadUrl}>客户端下载</a>
      </Button>
    )
  }

  // A web page cannot apply an Electron update.  Until the signed installer is
  // actually published, keep this deliberately non-clickable rather than
  // offering either a broken download or a desktop-only update dialog.
  if (isBrowserSurface()) {
    return <Button className="hesc-package-update-trigger" disabled size="sm" type="button" variant="ghost">客户端安装包准备中</Button>
  }

  return (
    <Button className="hesc-package-update-trigger" onClick={() => $enterprisePackageUpdateOpen.set(true)} size="sm" type="button" variant="ghost">
      {state?.nextLaunchScheduled ? '更新已就绪' : state?.targetVersion ? '有新版本' : '客户端更新'}
    </Button>
  )
}

export function EnterprisePackageUpdateBoundary({ children }: { children: ReactNode }) {
  const frozen = useStore($enterprisePackageInstallFrozen)
  const state = useStore($enterprisePackageUpdate)
  const busy = useStore($enterprisePackageUpdateBusy)
  const open = useStore($enterprisePackageUpdateOpen)
  const error = useStore($enterprisePackageUpdateError)
  useEffect(connectEnterprisePackageUpdates, [])

  return (
    <>
      <div className="hesc-update-content" inert={frozen}>{children}</div>
      {frozen ? <div className="hesc-update-freeze hesc-update-dialog" role="status">正在确认工作已保存并准备安装…</div> : null}
      <Dialog onOpenChange={value => $enterprisePackageUpdateOpen.set(value)} open={open}>
        <DialogContent className="hesc-update-dialog" fitContent>
          <DialogHeader>
            <DialogTitle>客户端更新</DialogTitle>
            <DialogDescription>管理员、主管和坐席均可在本机更新。</DialogDescription>
          </DialogHeader>
          <div className="hesc-update-body">
            <p>当前版本 <strong>{state?.currentVersion ?? '正在读取'}</strong>{state?.targetVersion ? <> · 新版本 <strong>{state.targetVersion}</strong></> : null}</p>
            <p aria-live="polite">{state?.message ?? (window.hermesDesktop?.enterprise?.packageUpdate ? '正在读取更新状态…' : '当前运行方式不支持自动更新，请安装最新的 Windows 客户端。')}</p>
            {state?.reasons?.length ? <ul>{state.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul> : null}
            {typeof state?.progress === 'number' ? (
              <label className="hesc-update-progress">下载进度 {Math.round(state.progress)}%<progress max={100} value={state.progress} /></label>
            ) : null}
            {error ? <p className="hesc-update-error" role="alert">{error}</p> : null}
            <p className="hesc-update-help">选择下次启动时更新后，会先在后台下载。下载完成后即可继续工作，下一次打开客户端时安装。</p>
            <div className="hesc-update-actions">
              <Button disabled={busy || !state?.supported} onClick={() => void commandEnterprisePackageUpdate('check')} type="button" variant="outline">检查更新</Button>
              <Button disabled={busy || !state?.supported || !state.targetVersion} onClick={() => void commandEnterprisePackageUpdate('install-now')} type="button">立即更新</Button>
              <Button disabled={busy || !state?.supported || !state.targetVersion || state.nextLaunchScheduled} onClick={() => void commandEnterprisePackageUpdate('download-for-next-launch')} type="button" variant="outline">下次启动时更新</Button>
              {state?.nextLaunchScheduled ? <Button disabled={busy} onClick={() => void commandEnterprisePackageUpdate('cancel-scheduled')} type="button" variant="ghost">取消自动安装</Button> : null}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
