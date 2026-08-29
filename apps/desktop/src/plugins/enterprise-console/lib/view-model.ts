/**
 * Shared view-model derivation utilities for the Enterprise Console pages.
 *
 * Views (`*.view.tsx`) are forbidden from importing transport, query
 * hooks, or permission helpers directly. They receive a `ViewModel`
 * (a presentation-safe plain data shape) from their glue (`page-*.tsx`)
 * and render it. Each `deriveXxxViewModel` below takes the raw
 * controller output + `$whoami` + page metadata and produces the
 * presentation fields the view needs.
 *
 * Two hard rules (enforced by code review + the boundary rule in
 * `apps/desktop/eslint.config.mjs`):
 *
 *  1. NEVER import `useTransport`, `useQuery`, `useMutation`,
 *     `useQueryClient`, `useConsoleQuery`, `IpcHermesTransport`,
 *     `FetchHermesTransport`, `FakeHermesTransport`, or
 *     `window.hermesDesktop` here. This file is a pure data layer;
 *     if you need a hook, you're writing a controller instead.
 *
 *  2. NEVER instantiate a permission capability from thin air. The
 *     server is the only authority on what a user can do. We DELEGATE
 *     to `hasPermission` from `./capabilities.ts` (which itself is a
 *     documented mirror of `ops/auth.py::check_perm`) so we cannot
 *     drift from server truth. We do NOT maintain a second wildcard
 *     implementation in this file.
 */

import { hasPermission } from '../capabilities'
import { type ConsolePage } from '../catalog'
import type { CapabilityStatus, Whoami } from '../types'

/** Shared inputs every per-page VM derivation receives. */
export interface CommonViewModelArgs {
  /**
   * Server-provided session truth. `null` while `$whoami` is loading
   * or the user is unauthenticated. The VM derivation still produces
   * a coherent shape; downstream rendering uses this to decide between
   * `EmptyState` and the real content.
   */
  whoami: null | Whoami
  /**
   * The page being rendered. The VM derivation reads `controlStatus`,
   * `status`, `permission`, `gap`, `capability` from the catalog
   * snapshot — never from fresh server data.
   */
  page: ConsolePage
  /**
   * An OPTIONAL capability name (e.g. "knowledge_rag") used for the
   * capability chip slot. Comes from the server's
   * `whoami.product_capabilities` — if `undefined` here, the chip
   * renders the page's own `status` enum.
   */
  capabilityName?: string
}

/** Shared fields every page VM exposes. */
export interface CommonViewModelFields {
  /**
   * True iff the viewer holds the page's required `permission`,
   * evaluated via `hasPermission(whoami, perm)`. The server is the
   * real gate; this is display only.
   */
  canRead: boolean
  /**
   * True iff the page's `controlStatus === 'ready'` AND the viewer
   * holds the page's `permission` (write is a stricter subset of
   * read). Per-page derivations may narrow further.
   */
  canWrite: boolean
  /** Honest page status: server truth only. Drives the PageStatusBadge. */
  isReady: boolean
  isReadyDev: boolean
  isPartial: boolean
  isBlocked: boolean
  /**
   * When write is denied, why — drives an honest empty-state message.
   * Order of precedence: server-declared gap → permission denial →
   * control gap.
   */
  readOnlyReason: null | string
  /**
   * Capability chip label. Comes from `whoami.product_capabilities`
   * when `capabilityName` is set; otherwise falls back to a faithful
   * translation of the page's `status` enum into a
   * `CapabilityStatus`-equivalent string. NEVER fabricates.
   */
  capabilityStatus: CapabilityStatus | null
}

/**
 * Derive the shared page fields every VM exposes.
 *
 * Per-page derivations compose this with their own presentation-safe
 * data (KPI, list rows, selected row, etc.).
 *
 * Authority for `hasPermission` lives in `./capabilities.ts` and is
 * a documented mirror of the server's `ops/auth.py::check_perm`.
 * We delegate to it directly; this file does NOT contain a parallel
 * wildcard implementation.
 */
export function deriveCommonViewModel(args: CommonViewModelArgs): CommonViewModelFields {
  const { whoami, page, capabilityName } = args

  const perm = page.permission
  const canRead = perm ? hasPermission(whoami, perm) : true
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
  // when the name lines up; otherwise fall back to a faithful translation
  // of the page's `status` enum into a CapabilityStatus-equivalent string.
  let capabilityStatus: CapabilityStatus | null = null

  const productCap = capabilityName
    ? whoami?.product_capabilities?.[capabilityName]
    : undefined

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