/**
 * PermissionGate / CapabilityGate — UI DISPLAY CONTROL ONLY, never a security
 * boundary. They read the server's whoami and decide what the console shows or
 * disables. The Hermes server independently enforces every permission and
 * capability on each request; a gate passing here is never proof of access.
 */

import { useValue } from '@hermes/plugin-sdk'
import type { ReactNode } from 'react'

import { capabilityStatus, hasPermission } from './capabilities'
import { $whoami } from './session'
import type { CapabilityStatus } from './types'

export function usePrincipal() {
  return useValue($whoami)
}

export function useHasPermission(permission: string): boolean {
  return hasPermission(useValue($whoami), permission)
}

export function useCapabilityStatus(capability: string): CapabilityStatus | null {
  return capabilityStatus(useValue($whoami), capability)
}

export function PermissionGate({
  children,
  fallback = null,
  permission
}: {
  children: ReactNode
  fallback?: ReactNode
  permission: string
}) {
  return useHasPermission(permission) ? <>{children}</> : <>{fallback}</>
}

export function CapabilityGate({
  capability,
  children,
  fallback = null,
  require: required = 'LIVE'
}: {
  capability: string
  children: ReactNode
  fallback?: ReactNode
  /** Minimum maturity to render children as live. Default LIVE. */
  require?: CapabilityStatus
}) {
  const status = useCapabilityStatus(capability)

  if (required === 'LIVE') {
    return status === 'LIVE' ? <>{children}</> : <>{fallback}</>
  }

  return status ? <>{children}</> : <>{fallback}</>
}
