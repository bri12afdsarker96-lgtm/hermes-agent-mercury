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
 *     to `hasPermission` and `capabilityStatus` from `./capabilities.ts`
 *     (which itself is a documented mirror of `ops/auth.py::check_perm`)
 *     so we cannot drift from server truth. We do NOT maintain a second
 *     wildcard implementation in this file.
 *
 * WHAT THIS FILE DOES NOT DECLARE (per W1-A-REMEDIATION-01):
 *   - `canWrite` (removed). Per-action write truth is the per-page
 *     Controller / per-action ViewModel's job, NOT this shared layer.
 *     Common layer cannot know if `biztask.read` also implies
 *     `biztask.write` — that depends on the server's action matrix,
 *     which only the server can answer.
 *   - `capabilityStatus` from `page.status` fallback. The page
 *     status is a frozen interface implementation truth; it is NOT a
 *     runtime capability verdict. They are different authorities.
 */

import { capabilityStatus, hasPermission } from './capabilities'
import { type ConsolePage } from './catalog'
import type { CapabilityStatus, Whoami } from './types'

/** Shared inputs every per-page VM derivation receives. */
export interface CommonViewModelArgs {
  /**
   * Server-provided session truth. `null` while `$whoami` is loading
   * or the user is unauthenticated. The VM derivation treats `null`
   * as a fail-closed session (see `canRead` below).
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
   * `whoami.product_capabilities`. The shared layer NEVER fabricates
   * a fallback from page.status (see W1-A-REMEDIATION-01 §10).
   */
  capabilityName?: string
}

/**
 * Shared fields every page VM exposes.
 *
 * NOTE — `canWrite` is INTENTIONALLY ABSENT. Per-page / per-action
 * write truth (e.g. `canCreateBiztask`, `canPublishKb`, `canRevokeBinding`)
 * must be derived per-page from the server's action matrix. The shared
 * layer cannot honestly express generic write authority.
 */
export interface CommonViewModelFields {
  /**
   * True iff the viewer holds the page's required `permission`.
   * Server-trusted via `hasPermission(whoami, perm)`.
   *
   * **Fail-closed on null session**: an unknown viewer is NOT a public
   * viewer. The Enterprise Console is not a public surface — every page
   * either has an explicit permission gate or is by convention private.
   * If we ever need a genuinely public page, it must declare an
   * explicit `permission: undefined` policy in the catalog AND we add
   * an explicit allowlist here (W1-A-REMEDIATION-01 §9).
   */
  canRead: boolean
  /** Server runtime capability verdict (or null when not applicable). */
  capabilityStatus: CapabilityStatus | null
  /**
   * Page interface implementation status (drives PageStatusBadge).
   * Distinct from `capabilityStatus` — see W1-A-REMEDIATION-01 §10.
   */
  isReady: boolean
  isReadyDev: boolean
  isPartial: boolean
  isBlocked: boolean
  /**
   * When read is denied, why — drives an honest empty-state message.
   * Limited to session/read permission denial + page interface gap.
   * Does NOT express per-action write authority (left to per-page VM).
   */
  readOnlyReason: null | string
}

/**
 * Derive the shared page fields every VM exposes.
 *
 * Per-page derivations compose this with their own presentation-safe
 * data (KPI, list rows, selected row, etc.) AND with per-action write
 * derivations (e.g. `canCreateBiztask`, `canPublishKb`) — those do NOT
 * live here.
 *
 * Authority delegation (W1-A-REMEDIATION-01 §8 + §10):
 *   - `canRead`       → `hasPermission(whoami, perm)` (capabilities.ts)
 *   - `capabilityStatus` → `capabilityStatus(whoami, capability)` (capabilities.ts)
 *   - `readOnlyReason` → derived from `canRead` + `page.controlStatus` (page gap)
 *   - page status fields (`isReady*` etc.) → derived from `page.status` directly
 *
 * This function does NOT contain a parallel wildcard implementation.
 */
export function deriveCommonViewModel(args: CommonViewModelArgs): CommonViewModelFields {
  const { whoami, page, capabilityName } = args

  // canRead: fail-closed on null session. The Enterprise Console has no
  // public surface; a missing whoami means an unknown viewer, and an
  // unknown viewer cannot read by default. Per-action write truth is
  // explicitly NOT derived here.
  const perm = page.permission
  const canRead = perm ? hasPermission(whoami, perm) : false

  // Page interface implementation status — distinct authority from
  // server runtime capability. The page.status is a frozen interface
  // contract from `docs/enterprise-console/WRITE_SURFACE_CENSUS.md`,
  // not a runtime verdict.
  const isReady = page.status === 'ready'
  const isReadyDev = page.status === 'ready-dev'
  const isPartial = page.status === 'partial'
  const isBlocked = page.status === 'blocked'

  // readOnlyReason is narrowed to session/read + page-interface gap.
  // Action-specific disabled reasons (e.g. "you have biztask.read but
  // not biztask.write") belong in per-page VMs with per-action truth.
  let readOnlyReason: null | string = null

  if (!canRead) {
    if (!whoami) {
      readOnlyReason = 'session not authenticated'
    } else if (perm) {
      readOnlyReason = `permission \`${perm}\` required`
    } else {
      readOnlyReason = 'read not allowed'
    }
  } else if (page.controlStatus === 'missing') {
    readOnlyReason = page.gap ?? 'page interface is not part of Phase-1'
  } else if (page.controlStatus === 'partial') {
    readOnlyReason = page.gap ?? 'page interface is partially available'
  }

  // capabilityStatus: server-only truth via `capabilityStatus(whoami, capability)`.
  // We do NOT fall back to page.status. If the server says nothing, the
  // view shows nothing (or a Phase-1 honest empty state). page.status is
  // an interface-contract enum; mixing it with server runtime
  // capability would lie to operators about what their environment can do.
  const capabilityStatusValue: CapabilityStatus | null =
    capabilityName ? capabilityStatus(whoami, capabilityName) : null

  return {
    canRead,
    capabilityStatus: capabilityStatusValue,
    isBlocked,
    isPartial,
    isReady,
    isReadyDev,
    readOnlyReason,
  }
}