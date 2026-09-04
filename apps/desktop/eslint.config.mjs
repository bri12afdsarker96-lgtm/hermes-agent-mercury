import shared from '../../eslint.config.shared.mjs'
import globals from 'globals'

export default [
  ...shared,
  {
    // Desktop is an Electron renderer — it legitimately uses browser globals
    // (window, document, etc). Re-add them here; the shared config omits
    // globals.browser so terminal-only workspaces (ui-tui) don't get them.
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  {
    // THE PLUGIN FENCE: plugins speak @hermes/plugin-sdk (+ react), never `@/…`
    // internals — the same isolation a runtime-fetched published plugin gets,
    // enforced on bundled ones so the SDK surface stays honest and sufficient.
    files: ['src/plugins/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/*', '../*', '@hermes/shared'],
              message: 'Plugins import only @hermes/plugin-sdk (and react). Missing something? Add it to the SDK.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.test.tsx'],
    rules: {
      'no-restricted-globals': ['warn', 'document'],
    },
  },
  {
    // W1-A-REMEDIATION-01 · View-layer import boundary. Per-page
    // presentational views (`*.view.tsx`) must NOT reach for transport,
    // query hooks, raw session atoms, or permission authority — they
    // receive a presentation-safe ViewModel from the glue layer and
    // render it.
    //
    // ESLint's `no-restricted-imports` matches by SOURCE PATH, not by
    // imported binding name. The future per-page Views live at
    // `src/plugins/enterprise-console/page-*.view.tsx`, so their real
    // sibling source paths are `./...` (NOT `../...`). The earlier
    // `../...` paths in this block were a bug from when the negative
    // fixture sat at `lib/`. The fixture has been deleted; the paths
    // here are now aligned with the real future topology.
    //
    // The plugin fence (`../*` forbidden for `src/plugins/**`) is
    // intentionally broad; we do NOT carve it out for any directory.
    // The shared layer (`view-model.ts`) sits at the Enterprise Console
    // root next to its sibling primitives (`catalog.ts`, `types.ts`,
    // `capabilities.ts`) and uses `./...` paths — no fence relaxation
    // required.
    //
    // `window.hermesDesktop` is enforced separately in a later block
    // (LAST in source order so it survives the broader
    // `src/**/*.{ts,tsx}` no-restricted-syntax block that comes before
    // it; ESLint flat config replaces the same rule's selector array
    // on overlapping files).
    files: ['src/plugins/enterprise-console/**/*.view.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            // ── Transport module (useTransport / HermesTransport / etc) ──
            {
              name: './transport',
              importNames: ['useTransport', 'getTransport', '$transport'],
              message:
                'View files must not import transport. Receive a ViewModel from the glue layer instead.',
            },
            // ── Fetch transport module ────────────────────────────────
            {
              name: './fetch-transport',
              importNames: ['FetchHermesTransport', 'HermesApiError', 'rawRequest'],
              message: 'View files must not import fetch transport.',
            },
            // ── Page-kit (controller-owned query helpers) ─────────────
            // View MAY import QueryBody / ConsoleRows / fmtIso
            // (presentational reusable primitives). The controller
            // hook `useConsoleQuery` remains forbidden in views.
            {
              name: './page-kit',
              importNames: ['useConsoleQuery'],
              message:
                'View files must not import the controller query hook. The controller owns queries.',
            },
            // ── Session atom (raw $whoami reads are controller-only) ─
            {
              name: './session',
              importNames: ['$whoami'],
              message:
                'View files must not import the whoami atom. The ViewModel already carries the relevant whoami-derived fields.',
            },
            // ── Capability / permission authority ───────────────────
            {
              name: './capabilities',
              importNames: ['hasPermission', 'isSuperAdmin'],
              message:
                'View files must not import permission authority. The ViewModel already carries canRead/readOnlyReason.',
            },
          ],
          patterns: [
            // ── Network module sources ─────────────────────────────
            {
              group: ['axios'],
              message: 'View files must not import axios. The controller owns transport.',
            },
          ],
        },
      ],
      // Global `fetch` is a web global, not an import; restrict it
      // here too so views can't bypass `no-restricted-imports` by
      // calling `fetch(...)` directly.
      'no-restricted-globals': [
        'error',
        {
          name: 'fetch',
          message: 'View files must not use global fetch. The controller owns transport.',
        },
      ],
    },
  },
  {
    // Ban mirroring reactive values into refs via useEffect — the "atom-mirrored
    // ref" antipattern. A ref synced from a nanostores atom via useEffect lags the
    // atom by one render, which creates stale-read bugs in callbacks that read the
    // ref (cancelRun sent session.interrupt to the wrong session; steerPrompt,
    // restoreToMessage, editMessage all had closure-priority stale reads). The fix
    // is to read $atom.get() directly in callbacks instead. This rule catches the
    // mirroring effect at lint time so the pattern can't reappear. Legitimate
    // non-atom ref writes inside useEffect (DOM instance refs, mount flags, request
    // tokens, prop mirrors) get an eslint-disable-next-line with a comment.
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          // useEffect(() => { someRef.current = value }, [value])
          selector:
            'CallExpression[callee.name="useEffect"] > ArrowFunctionExpression[body.type="AssignmentExpression"][body.left.type="MemberExpression"][body.left.property.name="current"]',
          message:
            'Do not mirror reactive values into refs via useEffect. Read $atom.get() directly in callbacks instead — refs synced from atoms lag one render and cause stale-read bugs.',
        },
        {
          // useEffect(() => { someRef.current = value; ... }, [value])
          selector:
            'CallExpression[callee.name="useEffect"] > ArrowFunctionExpression[body.type="BlockStatement"]:has(AssignmentExpression[left.type="MemberExpression"][left.property.name="current"])',
          message:
            'Do not mirror reactive values into refs via useEffect. Read $atom.get() directly in callbacks instead — refs synced from atoms lag one render and cause stale-read bugs.',
        },
        {
          // useEffect(() => { setMutableRef(ref, value) })
          selector:
            'CallExpression[callee.name="useEffect"] > ArrowFunctionExpression[body.type="BlockStatement"]:has(CallExpression[callee.name="setMutableRef"])',
          message:
            'Do not mirror reactive values into refs via useEffect (setMutableRef included). Read $atom.get() directly in callbacks instead — refs synced from atoms lag one render and cause stale-read bugs.',
        },
        {
          // {contribution.render()} anywhere inside JSX — calling a render
          // callback inline makes its hooks belong to the HOST component, so
          // loading/replacing a plugin changes the host's hook count → React
          // #310 (#80560, crashed every Windows user with a desktop plugin).
          // Mount it as a child instead: <ContribRender render={c.render} />.
          selector: 'JSXExpressionContainer CallExpression[callee.property.name="render"]',
          message:
            'Do not call render() callbacks inline in JSX — the view’s hooks become the host’s and plugin load/replace changes the host hook count (React #310). Mount it as a component: <ContribRender render={...} /> from @/contrib/react/boundary.',
        },
      ],
    },
  },
  {
    // W1-A-REMEDIATION-01 · Preload-bridge block. View files must never
    // touch window.hermesDesktop (the preload IPC bridge). This rule
    // lives in its own block AFTER the broader
    // `src/**/*.{ts,tsx}` no-restricted-syntax block (atom-mirror)
    // so it wins on overlapping files: ESLint flat config replaces the
    // same rule's selector array on overlapping files (later wins).
    //
    // We deliberately keep the scope narrow (only view files). Other
    // renderer code is free to use the preload bridge.
    files: ['src/plugins/enterprise-console/**/*.view.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'MemberExpression[object.name="window"][property.name="hermesDesktop"]',
          message:
            'View files must not touch window.hermesDesktop. The controller owns the preload bridge.',
        },
      ],
    },
  },
]