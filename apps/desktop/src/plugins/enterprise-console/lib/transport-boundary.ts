/**
 * View-layer import boundary — the explicit blacklist the
 * `*.view.tsx` ESLint rule enforces.
 *
 * Why a string list?
 *   Because the ESLint `no-restricted-imports` rule matches by name
 *   (no plugin runtime), and we want the list to be greppable by
 *   humans reading a CI failure too.
 *
 * Why a file, not a custom ESLint plugin?
 *   Because `page-*.view.tsx` imports get cross-checked at the
 *   *source* level (grep + lint), not at runtime. The ESLint rule
 *   and this list stay in lockstep: every symbol here appears as
 *   a `paths` entry in `apps/desktop/eslint.config.mjs`'s
 *   `*.view.tsx` block, and vice versa.
 *
 * INVARIANT — any `*.view.tsx` MUST NOT import anything in this list.
 * The whole point is that views are pure renderers: they receive a
 * pre-derived ViewModel from the glue layer (`page-*.tsx`) and never
 * reach into transport, queries, or session atoms.
 */

export const VIEW_FORBIDDEN_IMPORTS = [
  // ── Transport surface (the production concern) ────────────────────────
  'useTransport',
  'IpcHermesTransport',
  'FetchHermesTransport',
  'FakeHermesTransport',

  // ── Query / mutation surface (controller concern) ─────────────────────
  'useQuery',
  'useMutation',
  'useQueryClient',
  'invalidateQueries',
  'useConsoleQuery',

  // ── Raw network surface (re-implementing transport) ──────────────────
  'fetch',
  'axios',

  // ── Preload bridge (the renderer must never reach for it) ───────────
  'window.hermesDesktop',

  // ── Session / permission authority (controller concern) ─────────────
  '$whoami',
  'hasPermission',
] as const

export type ViewForbiddenImport = (typeof VIEW_FORBIDDEN_IMPORTS)[number]