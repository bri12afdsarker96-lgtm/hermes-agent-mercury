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
    // W5-B0 Contract/View Freeze (see .hermes/plans/2026-08-29_wave1-contract-freeze.md).
    // page-*.view.tsx files are pure presentational renderers — they may
    // not import transport, query hooks, or session/permission helpers
    // (those belong in page-*.controller.ts). The blacklist lives in
    // `lib/transport-boundary.ts` so adding a new transport helper only
    // requires updating that one list.
    files: ['src/plugins/enterprise-console/page-*.view.tsx', 'src/plugins/enterprise-console/page-*.view.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'useTransport', message: 'View files may not import transport. Move this to a *.controller.ts file.' },
            { name: 'IpcHermesTransport', message: 'View files may not import transport. Move this to a *.controller.ts file.' },
            { name: 'FetchHermesTransport', message: 'View files may not import transport. Move this to a *.controller.ts file.' },
            { name: 'FakeHermesTransport', message: 'View files may not import transport. Move this to a *.controller.ts file.' },
            { name: 'useQuery', message: 'View files may not import query hooks. Move this to a *.controller.ts file.' },
            { name: 'useMutation', message: 'View files may not import mutation hooks. Move this to a *.controller.ts file.' },
            { name: 'useQueryClient', message: 'View files may not import query client. Move this to a *.controller.ts file.' },
            { name: 'invalidateQueries', message: 'View files may not import query invalidation. Move this to a *.controller.ts file.' },
            { name: 'useConsoleQuery', message: 'View files may not import the shared query hook. Move this to a *.controller.ts file.' },
            { name: '$whoami', message: 'View files receive whoami via the ViewModel; do not read the atom directly.' },
            { name: 'hasPermission', message: 'View files receive permission flags via the ViewModel; do not call helpers directly.' }
          ]
        }
      ]
    }
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
