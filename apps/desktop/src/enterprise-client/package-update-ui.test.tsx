import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { EnterprisePackageUpdateState } from '../../electron/enterprise-package-updater-types'

import { $enterprisePackageInstallFrozen, registerEnterpriseInstallActivity } from './enterprise-install-readiness'
import { $enterprisePackageUpdate, $enterprisePackageUpdateError, $enterprisePackageUpdateOpen } from './package-update-store'
import { EnterprisePackageUpdateBoundary, EnterprisePackageUpdateButton } from './package-update-ui'

describe('local package updates', () => {
  const available: EnterprisePackageUpdateState = {
    currentVersion: '0.18.0', targetVersion: '0.19.0', supported: true,
    phase: 'available', message: '发现新版本', nextLaunchScheduled: false
  }

  let prepare!: (value: { transactionId: string }) => void
  let release!: (value: { transactionId: string }) => void
  let status!: (value: EnterprisePackageUpdateState) => void
  const ready = vi.fn()
  const changed = vi.fn()
  const command = vi.fn(async () => available)
  const before = window.hermesDesktop
  const beforeSurface = document.documentElement.dataset.hermesSurface
  const beforeDownloadUrl = document.documentElement.dataset.hermesDesktopDownloadUrl

  beforeEach(() => {
    vi.clearAllMocks()
    $enterprisePackageUpdate.set(null)
    $enterprisePackageUpdateOpen.set(false)
    $enterprisePackageUpdateError.set('')
    window.hermesDesktop = { enterprise: { packageUpdate: {
      status: async () => available,
      command,
      onStatus: (callback: typeof status) => { status = callback;

 return () => undefined },
      onPrepare: (callback: typeof prepare) => { prepare = callback;

 return () => undefined },
      onRelease: (callback: typeof release) => { release = callback;

 return () => undefined },
      ready, changed
    } } } as unknown as typeof window.hermesDesktop
  })
  afterEach(() => {
    window.hermesDesktop = before
    if (beforeSurface === undefined) {delete document.documentElement.dataset.hermesSurface}
    else {document.documentElement.dataset.hermesSurface = beforeSurface}
    if (beforeDownloadUrl === undefined) {delete document.documentElement.dataset.hermesDesktopDownloadUrl}
    else {document.documentElement.dataset.hermesDesktopDownloadUrl = beforeDownloadUrl}
  })

  function mount() {
    return render(<EnterprisePackageUpdateBoundary><main><EnterprisePackageUpdateButton /><textarea aria-label="示例工作输入" /></main></EnterprisePackageUpdateBoundary>)
  }

  it('exposes fixed local commands while logged out, and scheduling does not freeze work', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: '有新版本' }))
    fireEvent.click(screen.getByRole('button', { name: '下次启动时更新' }))
    await waitFor(() => expect(command).toHaveBeenCalledWith({ action: 'download-for-next-launch' }))
    expect(ready).not.toHaveBeenCalled()
    expect($enterprisePackageInstallFrozen.get()).toBe(false)
    expect(screen.getByLabelText('示例工作输入').closest('[inert]')).toBeNull()
  })

  it('acknowledges main only after pending data has been saved and unfreezes on release', async () => {
    let finish!: () => void
    const pendingSave = new Promise<void>(resolve => { finish = resolve })
    const activity = registerEnterpriseInstallActivity({ blocker: () => null, flush: () => pendingSave })
    const view = mount()
    await screen.findByRole('button', { name: '有新版本' })
    act(() => prepare({ transactionId: 'main-attempt' }))
    expect(screen.getByLabelText('示例工作输入').closest('[inert]')).not.toBeNull()
    expect(ready).not.toHaveBeenCalled()
    await act(async () => { finish(); await pendingSave })
    await waitFor(() => expect(ready).toHaveBeenCalledWith(expect.objectContaining({ transactionId: 'main-attempt', ready: true })))
    act(() => release({ transactionId: 'main-attempt' }))
    expect(screen.getByLabelText('示例工作输入').closest('[inert]')).toBeNull()
    view.unmount()
    activity.dispose()
  })

  it('shows why install is blocked and keeps the retry controls available', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: '有新版本' }))
    act(() => status({ ...available, phase: 'blocked', reasons: ['客户草稿存在保存冲突'], message: '请先处理未保存的工作' }))
    expect(screen.getByText('客户草稿存在保存冲突')).toBeTruthy()
    expect((screen.getByRole('button', { name: '立即更新' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('renders a Windows download link instead of updater controls on the web surface', () => {
    document.documentElement.dataset.hermesSurface = 'web'
    document.documentElement.dataset.hermesDesktopDownloadUrl =
      '/desktop-updates/windows/x64/Hermes-企业助手-0.19.6-x64.exe'

    render(<EnterprisePackageUpdateButton />)

    const download = screen.getByRole('link', { name: '客户端下载' })
    expect(download.getAttribute('href')).toBe('/desktop-updates/windows/x64/Hermes-企业助手-0.19.6-x64.exe')
    expect(download.hasAttribute('download')).toBe(true)
    expect(screen.queryByRole('button', { name: '客户端更新' })).toBeNull()
  })

  it('does not expose a broken installer link before the web-first release is signed', () => {
    document.documentElement.dataset.hermesSurface = 'web'
    delete document.documentElement.dataset.hermesDesktopDownloadUrl

    render(<EnterprisePackageUpdateButton />)

    expect((screen.getByRole('button', { name: '客户端安装包准备中' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByRole('link', { name: '客户端下载' })).toBeNull()
  })
})
