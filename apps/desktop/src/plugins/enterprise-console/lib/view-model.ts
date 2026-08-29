/**
 * Shared view-model derivation utilities.
 *
 * Views (`*.view.tsx`) are forbidden from importing transport, query
 * hooks, or permission helpers directly. They receive a `ViewModel` (a
 * presentation-safe plain data shape) from their glue (`page-*.tsx`)
 * and render it. Each `deriveXxxViewModel` below takes the raw
 * controller output + `$whoami` + page metadata and produces the
 * presentation fields the view needs.
 *
 * Two rules:
 *
 *  1. NEVER import `useTransport`, `useQuery`, `useMutation`, `useQueryClient`,
 *     `useConsoleQuery`, `IpcHermesTransport`, or `window.hermesDesktop` here.
 *     This file is a pure data layer; if you need a hook, you're writing a
 *     controller instead.
 *
 *  2. NEVER instantiate a permission capability from thin air. The server
 *     is the only authority on what a user can do; this file just MIRRORS
 *     server truth into a shape the view can render without re-running
 *     `useValue($whoami)` itself.
 */

import type { CapabilityStatus, Whoami } from '../types'
import { type ConsolePage } from '../catalog'

/** Shared inputs every per-page VM derivation receives. */
export interface CommonViewModelArgs {
  /** Server-provided session truth. `null` while `$whoami` is loading or
   *  the user is unauthenticated. The VM derivation must still produce a
   *  coherent shape; downstream rendering uses this to decide between
   *  `EmptyState` and the real content. */
  whoami: null | Whoami
  /** The page being rendered. The VM derivation reads `controlStatus` /
   *  `status` / `permission` from the catalog snapshot — never from
   *  fresh server data. */
  page: ConsolePage
  /** An OPTIONAL capability name (e.g. "knowledge_rag") used for the
   *  capability chip slot. Comes from the server's `whoami.product_capabilities`
   *  — if `undefined` here, the chip renders the page's own `status` enum. */
  capabilityName?: string
}

/** Shared fields every page VM exposes. */
export interface CommonViewModelFields {
  /** True iff the viewer holds the page's required `permission`, evaluated
   *  conservatively (server is the real gate; this is display only). */
  canRead: boolean
  /** True iff the page's `controlStatus === 'ready'` AND viewer has the
   *  page's `permission` (write permission is a stricter subset, see
   *  `deriveKnowledgeViewModel` etc. for per-page specifics). */
  canWrite: boolean
  /** Honest page status: server truth only. Drives the `PageStatusBadge`. */
  isReady: boolean
  isReadyDev: boolean
  isPartial: boolean
  isBlocked: boolean
  /** When write is denied, why — drives an honest empty state message. */
  readOnlyReason: null | string
  /** Capability chip label. Comes from whoami.product_capabilities when
   *  `capabilityName` is set; otherwise falls back to the page's status
   *  enum. NEVER fabricates. */
  capabilityStatus: CapabilityStatus | null
}

/** Conservative permission check, mirroring `capabilities.ts` exactly so
 *  VMs and the in-component `hasPermission` call agree.
 *
 *  Exported under the alias `viewerHoldsViaCommon` so test files can
 *  import a stable name that doesn't collide with the identically-named
 *  helper in `capabilities.ts`. */
export function viewerHoldsViaCommon(who: null | Whoami, perm: string): boolean {
  if (!who) {
    return false
  }

  const perms = who.effective_permissions ?? who.perms_effective ?? []

  if (perms.includes('*') || perms.includes(perm)) {
    return true
  }

  return perms.some(granted => {
    if (!granted.endsWith('.*')) {
      return false
    }

    const prefix = granted.slice(0, -1) // keep trailing dot: "kb."

    return perm.startsWith(prefix)
  })
}

/** Derive the shared page fields every VM exposes.
 *
 *  Per-page derivations compose this with their own presentation-safe
 *  data (KPI, list rows, selected row, etc.). */
export function deriveCommonViewModel(args: CommonViewModelArgs): CommonViewModelFields {
  const { whoami, page, capabilityName } = args

  const perm = page.permission
  const canRead = perm ? viewerHoldsViaCommon(whoami, perm) : true
  const canWrite = canRead && page.controlStatus === 'ready'

  const isReady = page.status === 'ready'
  const isReadyDev = page.status === 'ready-dev'
  const isPartial = page.status === 'partial'
  const isBlocked = page.status === 'blocked'

  // Read-only reason surfaces to the view as an honest empty-state string.
  // Order of precedence: server-declared gap → permission denial → control gap.
  let readOnlyReason: null | string = null
  if (!canRead && perm) {
    readOnlyReason = `permission \`${perm}\` required`
  } else if (!canWrite && page.controlStatus === 'missing') {
    readOnlyReason = page.gap ?? 'write surface is not part of Phase-1'
  } else if (!canWrite && page.controlStatus === 'partial') {
    readOnlyReason = page.gap ?? 'write surface is partially available'
  }

  // Capability chip: prefer server whoami.product_capabilities[capabilityName]
  // when both names line up; otherwise fall back to a faithful translation
  // of the page's `status` enum into a CapabilityStatus-equivalent string.
  let capabilityStatus: CapabilityStatus | null = null
  const productCap = whoami?.product_capabilities?.[capabilityName ?? '']

  if (productCap) {
    capabilityStatus = productCap.status
  } else if (isReady) {
    capabilityStatus = 'LIVE'
  } else if (isReadyDev) {
    capabilityStatus = 'DEV'
  } else if (isPartial) {
    capabilityStatus = 'CONTRACT'
  } else if (isBlocked) {
    capabilityStatus = 'PLANNED'
  }

  return {
    canRead,
    canWrite,
    isBlocked,
    isPartial,
    isReady,
    isReadyDev,
    capabilityStatus,
    readOnlyReason,
  }
}
