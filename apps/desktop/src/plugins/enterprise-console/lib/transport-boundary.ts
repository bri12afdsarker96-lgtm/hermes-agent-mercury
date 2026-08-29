/**
 * View-layer import boundary — the explicit blacklist the
 * `eslint-plugins/no-view-transport` rule enforces.
 *
 * Why a string list? Because the rule needs to match by name (we can't
 * import a function at lint time without loading the rule's host
 * environment), and we want the list to be greppable by humans reading
 * a CI failure too.
 *
 * Why a file, not an eslint plugin? Because page-*.view.tsx imports
 * cross-checked at the *source* level, not at runtime — the ESLint rule
 * and the import boundary stay in lockstep. If a future maintainer adds
 * a new transport helper, they must add it to BOTH this list AND the
 * `no-view-transport` rule (the rule's array mirrors this list at
 * lint setup time).
 *
 * INVARIANT — any `page-*.view.tsx` MUST NOT import anything from this
 * file. The whole point is that views are pure renderers.
 */

export const VIEW_FORBIDDEN_IMPORTS = [
  // ── Transport surface (the production concern) ───────────────────────
  'useTransport',
  'IpcHermesTransport',
  'FetchHermesTransport',
  'FakeHermesTransport',

  // ── Query / mutation surface (controller concern) ────────────────────
  'useQuery',
  'useMutation',
  'useQueryClient',
  'invalidateQueries',
  'useConsoleQuery',

  // ── Raw network surface (re-implementing transport) ────────────────
  'fetch',
  'axios',

  // ── Preload bridge (the renderer must never reach for it) ─────────
  'window.hermesDesktop',

  // ── Session / permission helpers (controller concern) ─────────────
  '$whoami',
  'hasPermission',
] as const

export type ViewForbiddenImport = (typeof VIEW_FORBIDDEN_IMPORTS)[number]
