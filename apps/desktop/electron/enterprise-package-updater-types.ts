/** Public UI contract. No Electron, Node, updater, or server imports. */
export type EnterprisePackageUpdatePhase =
  | 'unsupported' | 'idle' | 'checking' | 'available' | 'downloading'
  | 'downloaded' | 'scheduled' | 'preparing' | 'installing' | 'blocked' | 'error'

export interface EnterprisePackageUpdateState {
  supported: boolean
  phase: EnterprisePackageUpdatePhase
  currentVersion: string
  targetVersion?: string
  progress?: number
  message: string
  nextLaunchScheduled: boolean
  reasons?: string[]
}

export type EnterprisePackageUpdateAction = 'check' | 'install-now' | 'download-for-next-launch' | 'cancel-scheduled'

export interface EnterprisePackageReadinessLease {
  ready: boolean
  reasons?: string[]
  isStillReady(): boolean
  release(): void
}
