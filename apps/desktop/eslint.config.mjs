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
        ...globals.node
      }
    }
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
              message: 'Plugins import only @hermes/plugin-sdk (and react). Missing something? Add it to the SDK.'
            }
          ]
        }
      ]
    }
  },
  {
    files: ['**/*.test.tsx'],
    rules: {
      'no-restricted-globals': ['warn', 'document']
    }
  },
  {
    // W1-A · Shared lib/ scope override. The shared view-model and
    // transport-boundary primitives in `lib/` legitimately reach for
    // sibling files in `enterprise-console/` (types.ts, catalog.ts,
    // capabilities.ts) to avoid duplicating authority (per P12:
    // single shared implementation, no duplicated wildcard logic).
    //
    // The plugin fence (`../*` forbidden for `src/plugins/**`) is
    // intentionally broad to prevent plugins from reaching for the
    // host's internals via `../*`; this override narrows it back to
    // the legitimate sibling path within the enterprise-console dir.
    files: ['src/plugins/enterprise-console/lib/**/*.ts'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
  {
    // W1-A · View-layer import boundary. Per-page presentational views
    // (`*.view.tsx`) must NOT reach for transport, query hooks, raw
    // session atoms, or permission authority — they receive a
    // presentation-safe ViewModel from the glue layer and render it.
    //
    // The list is mirrored in
    // `apps/desktop/src/plugins/enterprise-console/lib/transport-boundary.ts`
    // and `VIEW_FORBIDDEN_IMPORTS`. If you add a symbol here, add it
    // there too (and vice versa).
    //
    // ESLint's `no-restricted-imports` matches by SOURCE PATH, not by
    // imported binding name, so we list the source paths of the
    // modules that own the forbidden surface. The `importNames` field
    // narrows further to specific exports (so a view can still import,
    // say, `fmtIso` from `./page-kit` if it really needed to — only
    // `useConsoleQuery` and friends are off-limits).
    files: ['src/plugins/enterprise-console/**/*.view.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            // ── Transport module (useTransport / HermesTransport / etc) ──
            {
              name: '../transport',
              importNames: ['useTransport', 'getTransport', '$transport'],
              message: 'View files must not import transport. Receive a ViewModel from the glue layer instead.',
            },
            // ── Fetch transport module ────────────────────────────────
            {
              name: '../fetch-transport',
              importNames: ['FetchHermesTransport', 'HermesApiError', 'rawRequest'],
              message: 'View files must not import fetch transport.',
            },
            // ── Page-kit (controller-owned query helpers) ─────────────
            {
              name: '../page-kit',
              importNames: ['useConsoleQuery', 'QueryBody', 'ConsoleRows'],
              message: 'View files must not import console query helpers. The controller owns queries.',
            },
            // ── Session atom (raw $whoami reads are controller-only) ─
            {
              name: '../session',
              importNames: ['$whoami'],
              message: 'View files must not import the whoami atom. The ViewModel already carries the relevant whoami-derived fields.',
            },
            // ── Capability / permission authority ───────────────────
            {
              name: '../capabilities',
              importNames: ['hasPermission', 'isSuperAdmin'],
              message: 'View files must not import permission authority. The ViewModel already carries canRead/canWrite/readOnlyReason.',
            },
          ],
          patterns: [
            // ── Raw network / IPC bridge ───────────────────────────
            { group: ['fetch', 'axios', 'window.hermesDesktop'], message: 'View files must not reach for raw network or the preload bridge. The controller owns transport.' },
          ],
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
            'Do not mirror reactive values into refs via useEffect. Read $atom.get() directly in callbacks instead — refs synced from atoms lag one render and cause stale-read bugs.'
        },
        {
          // useEffect(() => { someRef.current = value; ... }, [value])
          selector:
            'CallExpression[callee.name="useEffect"] > ArrowFunctionExpression[body.type="BlockStatement"]:has(AssignmentExpression[left.type="MemberExpression"][left.property.name="current"])',
          message:
            'Do not mirror reactive values into refs via useEffect. Read $atom.get() directly in callbacks instead — refs synced from atoms lag one render and cause stale-read bugs.'
        },
        {
          // useEffect(() => { setMutableRef(ref, value) }, [value])
          selector:
            'CallExpression[callee.name="useEffect"] > ArrowFunctionExpression[body.type="BlockStatement"]:has(CallExpression[callee.name="setMutableRef"])',
          message:
            'Do not mirror reactive values into refs via useEffect (setMutableRef included). Read $atom.get() directly in callbacks instead — refs synced from atoms lag one render and cause stale-read bugs.'
        },
        {
          // {contribution.render()} anywhere inside JSX — calling a render
          // callback inline makes its hooks belong to the HOST component, so
          // loading/replacing a plugin changes the host's hook count → React
          // #310 (#80560, crashed every Windows user with a desktop plugin).
          // Mount it as a child instead: <ContribRender render={c.render} />.
          selector: 'JSXExpressionContainer CallExpression[callee.property.name="render"]',
          message:
            'Do not call render() callbacks inline in JSX — the callback\u2019s hooks become the host\u2019s and plugin load/replace changes the host hook count (React #310). Mount it as a component: <ContribRender render={...} /> from @/contrib/react/boundary.'
        }
      ]
    }
  }
]
