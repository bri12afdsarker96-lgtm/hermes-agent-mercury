/**
 * Wire types for the Hermes_AI web server (`hermes_devices/webserver.py`), the
 * Phase-1 authority the Enterprise Console consumes. These mirror the server's
 * real JSON shapes (whoami / health / metrics); the server — never this client —
 * owns identity, tenant, permission, and capability truth.
 */

/** Server capability maturity, straight from `/api/capabilities` + whoami. The
 *  console must render this honestly and never present DEV/CONTRACT/PLANNED as a
 *  live, production-usable feature (Capability Truth). */
export type CapabilityStatus = 'CONTRACT' | 'DEV' | 'LIVE' | 'PLANNED'

export interface ProductCapability {
  /** true ONLY when the server judges the capability live AND the caller's role
   *  ceiling covers it. DEV/CONTRACT/PLANNED are always false. */
  enabled: boolean
  status: CapabilityStatus
}

/** `GET /api/whoami` — the authenticated session. Sole source of principal /
 *  tenant / role / permissions / capabilities for the UI gates. */
export interface Whoami {
  capability_revision: number
  data_scope: { mode: string; scopes: string[] }
  /** PR-A0 canonical field; during the transition it mirrors perms_effective. */
  effective_permissions?: string[]
  handoff_claim_timeout_s?: number
  kb_supported_extensions?: string[]
  name: string
  perms_effective?: string[]
  principal_id: string
  product_capabilities: Record<string, ProductCapability>
  role: string
  tenant_id: null | string
}

/** `GET /api/health` — unauthenticated liveness + auth posture. */
export interface Health {
  auth_mode: string
  legacy_tenant_null_rows?: number
  ok: boolean
}

/** `GET /api/metrics?window=…` — aggregate event counters + surfaced alerts.
 *  Intentionally loose: the console reads a documented subset and tolerates the
 *  rest, so a server-side counter addition never breaks the page. */
export interface Metrics {
  alerts?: MetricAlert[]
  errors?: Record<string, number>
  [key: string]: unknown
}

export interface MetricAlert {
  detail?: string
  kind?: string
  severity?: string
  [key: string]: unknown
}

export type MetricsWindow = '1h' | '24h' | '7d'
