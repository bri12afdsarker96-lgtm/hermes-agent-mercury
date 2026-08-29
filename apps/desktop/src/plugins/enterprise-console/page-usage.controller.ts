/**
 * Usage & Budget page — Controller layer.
 *
 * Holds the HermesTransport query for the tenant profile, the queryKey
 * (which is the source of truth for React Query invalidation), and the
 * error normalization step. Nothing here imports JSX or view primitives.
 *
 * This is a Step 3 of the W5-B0 contract freeze. See
 * .hermes/plans/2026-08-29_wave1-contract-freeze.md §3.
 */

import { HermesApiError } from './fetch-transport'
import { useConsoleQuery } from './page-kit'
import { useTransport } from './transport'

/** Tenant profile wire shape, mirroring `/api/tenant-profile`. */
export interface TenantProfileResp {
  fields: { llm?: { daily_budget_tokens?: number } }
  tenant_id: string
  version: number
}

export const USAGE_TENANT_PROFILE_KEY = ['enterprise-console', 'tenant-profile'] as const

/** Human-friendly error after HermesApiError / generic Error → string. */
export function normalizeUsageError(e: unknown): string {
  if (e instanceof HermesApiError) {
    if (e.code === 'forbidden') {
      return 'tenant.profile.read permission required'
    }

    if (e.code === 'not_implemented') {
      return 'tenant profile endpoint is not wired on this server yet'
    }

    return `${e.code}: ${e.message}`
  }

  return String((e as Error).message ?? e)
}

/** Use the tenant profile (read-only). Reuses the shared `useConsoleQuery`
 *  hook so the page benefits from the existing QueryBody rendering and
 *  30s polling cadence. */
export function useUsageData() {
  const transport = useTransport()

  return useConsoleQuery<TenantProfileResp>(USAGE_TENANT_PROFILE_KEY, '/api/tenant-profile')
}
