import assert from 'node:assert/strict'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

import { test } from 'vitest'

import {
  assertBootstrapAllowed,
  appendUniquePathEntries,
  buildDesktopBackendEnv,
  buildDesktopChildEnv,
  buildDesktopBackendPath,
  hermesManagedNodePathEntries,
  localVerificationHome,
  localVerificationEnv,
  normalizeHermesHomeRoot,
  pathEnvKey,
  POSIX_SANE_PATH_ENTRIES
} from './backend-env'

test('local backend child gets isolated defaults and no inherited credentials or proxy', () => {
  const home = 'C:\\local-test\\hermes-home'
  const env = buildDesktopChildEnv({
    local: true, hermesHome: home, platform: 'win32', pathModule: path.win32,
    inherited: { SystemRoot: 'C:\\Windows', OPENAI_API_KEY: 'synthetic-secret', HTTP_PROXY: 'http://example.invalid', http_proxy: 'http://example.invalid', NODE_OPTIONS: '--require bad',
      PYTHONPATH: 'C:\\production', USERPROFILE: 'C:\\Users\\real' },
    backend: { PYTHONPATH: 'C:\\production', PATH: 'C:\\production' },
    pythonPaths: ['C:\\test-runtime'],
    explicit: { HERMES_DASHBOARD_SESSION_TOKEN: 'synthetic-token', HERMES_PARENT_PID: '123' }
  })
  assert.equal(env.HERMES_HOME, home)
  assert.equal(env.USERPROFILE, home)
  assert.equal(env.LOCALAPPDATA, path.win32.join(home, 'localappdata'))
  assert.equal(env.TEMP, path.win32.join(home, 'temp'))
  assert.equal(env.PYTHONPATH, 'C:\\test-runtime')
  assert.ok(!env.PATH.includes('production'))
  assert.equal(env.OPENAI_API_KEY, undefined)
  assert.equal(env.HTTP_PROXY, undefined)
  assert.equal(env.http_proxy, undefined)
  assert.equal(env.NODE_OPTIONS, undefined)
  assert.equal(env.HERMES_DASHBOARD_SESSION_TOKEN, 'synthetic-token')
  assert.throws(() => buildDesktopChildEnv({ local: true, hermesHome: 'relative', platform: 'win32', pathModule: path.win32, inherited: { SystemRoot: 'C:\\Windows' } }))
  assert.throws(() => buildDesktopChildEnv({ local: true, hermesHome: '\\\\server\\share', platform: 'win32', pathModule: path.win32, inherited: { SystemRoot: 'C:\\Windows' } }))
  assert.throws(() => buildDesktopChildEnv({ local: true, hermesHome: home, platform: 'win32', pathModule: path.win32, inherited: { SystemRoot: 'C:\\Windows' }, pythonPaths: ['C:\\safe;C:\\other'] }))
  assert.throws(() => buildDesktopChildEnv({ local: true, hermesHome: home, platform: 'win32', pathModule: path.win32, inherited: { SystemRoot: 'C:\\Windows' }, explicit: { HTTP_PROXY: 'bad' } }))
})

test('local child process does not receive inherited test secrets', () => {
  const home = path.resolve(process.cwd(), 'synthetic-local-home')
  const env = buildDesktopChildEnv({ local: true, hermesHome: home, inherited: {
    ...process.env, CODEX_SYNTHETIC_SECRET: 'never-forward', HTTPS_PROXY: 'http://example.invalid'
  } })
  const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(JSON.stringify({secret:process.env.CODEX_SYNTHETIC_SECRET??null,proxy:process.env.HTTPS_PROXY??null,home:process.env.HERMES_HOME}))'], { env, encoding: 'utf8' })
  assert.equal(child.status, 0, child.stderr)
  assert.deepEqual(JSON.parse(child.stdout), { secret: null, proxy: null, home })
})

test('normal backend child retains its existing merge semantics', () => {
  const env = buildDesktopChildEnv({ local: false, hermesHome: '/home', inherited: { X: 'a', HERMES_HOME: 'old' }, backend: { X: 'b', HERMES_HOME: 'backend' }, explicit: { X: 'c' } })
  assert.deepEqual(env, { X: 'c', HERMES_HOME: 'backend' })
})

test('local verification stops both fresh bootstrap and forced repair before installer handoff', () => {
  assert.throws(() => assertBootstrapAllowed(true, true), /cannot bootstrap or repair/)
  assert.doesNotThrow(() => assertBootstrapAllowed(true, false))
  assert.doesNotThrow(() => assertBootstrapAllowed(false, true))
})

test('local verification pins home under isolated userData and overrides inherited child home', () => {
  const userData = 'C:\\Users\\fixture\\Hermes-localprep'
  const home = localVerificationHome(true, userData, path.win32)!
  assert.equal(home, 'C:\\Users\\fixture\\Hermes-localprep\\hermes-home')
  assert.equal(localVerificationHome(false, userData, path.win32), null)
  assert.throws(() => localVerificationHome(true, 'relative', path.win32))
  const inherited = { HERMES_HOME: 'C:\\production' }
  const backend = { HERMES_HOME: 'C:\\other' }
  assert.equal({ ...inherited, ...backend, ...localVerificationEnv(true, home) }.HERMES_HOME, home)
  assert.equal({ ...inherited, ...backend, ...localVerificationEnv(false, home) }.HERMES_HOME, backend.HERMES_HOME)
})

test('desktop backend PATH adds Hermes-managed bins and missing POSIX sane entries', () => {
  const result = buildDesktopBackendPath({
    hermesHome: '/Users/test/.hermes',
    venvRoot: '/Users/test/.hermes/hermes-agent/venv',
    currentPath: '/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin',
    platform: 'darwin',
    pathModule: path.posix
  })

  const entries = result.split(':')
  // Both managed-Node layouts lead, POSIX-native shape first, then the venv.
  assert.deepEqual(entries.slice(0, 3), [
    '/Users/test/.hermes/node/bin',
    '/Users/test/.hermes/node',
    '/Users/test/.hermes/hermes-agent/venv/bin'
  ])
  assert.ok(entries.includes('/opt/homebrew/bin'), 'Apple Silicon Homebrew bin is added')
  assert.ok(entries.includes('/opt/homebrew/sbin'), 'Apple Silicon Homebrew sbin is added')
  assert.ok(entries.includes('/usr/local/sbin'), 'missing standard sbin is added')

  for (const expected of POSIX_SANE_PATH_ENTRIES) {
    assert.ok(entries.includes(expected), `${expected} should be present`)
  }
})

test('managed Node dirs lead with the platform-native layout but always offer both', () => {
  const posix = hermesManagedNodePathEntries('/Users/test/.hermes', {
    platform: 'darwin',
    pathModule: path.posix
  })

  const windows = hermesManagedNodePathEntries('C:\\Users\\test\\AppData\\Local\\hermes', {
    platform: 'win32',
    pathModule: path.win32
  })

  // install.sh uses node/bin; install.ps1 unpacks node.exe into node\ itself.
  // Both shapes are always emitted so migrated installs keep resolving.
  assert.deepEqual(posix, ['/Users/test/.hermes/node/bin', '/Users/test/.hermes/node'])
  assert.deepEqual(windows, [
    'C:\\Users\\test\\AppData\\Local\\hermes\\node',
    'C:\\Users\\test\\AppData\\Local\\hermes\\node\\bin'
  ])
})

test('managed Node dirs are empty without a Hermes home', () => {
  assert.deepEqual(hermesManagedNodePathEntries(undefined, { platform: 'darwin', pathModule: path.posix }), [])
  assert.deepEqual(hermesManagedNodePathEntries('', { platform: 'win32', pathModule: path.win32 }), [])
})

test('every managed Node dir outranks the inherited PATH on both platforms', () => {
  for (const [platform, pathModule, home, inherited, delimiter] of [
    ['darwin', path.posix, '/Users/test/.hermes', '/usr/local/bin:/usr/bin', ':'],
    ['win32', path.win32, 'C:\\hermes', 'C:\\Program Files\\nodejs;C:\\Windows\\System32', ';']
  ] as const) {
    const entries = buildDesktopBackendPath({
      hermesHome: home,
      venvRoot: null,
      currentPath: inherited,
      platform,
      pathModule
    }).split(delimiter)

    const managed = hermesManagedNodePathEntries(home, { platform, pathModule })
    const firstInherited = Math.min(...inherited.split(delimiter).map(entry => entries.indexOf(entry)))

    for (const dir of managed) {
      assert.ok(
        entries.indexOf(dir) >= 0 && entries.indexOf(dir) < firstInherited,
        `${dir} must precede the inherited PATH on ${platform}`
      )
    }
  }
})

test('desktop backend PATH preserves first occurrence and avoids duplicates', () => {
  const result = buildDesktopBackendPath({
    hermesHome: '/Users/test/.hermes',
    venvRoot: '/Users/test/.hermes/hermes-agent/venv',
    currentPath: '/opt/homebrew/bin:/usr/bin:/opt/homebrew/bin:/bin',
    platform: 'darwin',
    pathModule: path.posix
  })

  const entries = result.split(':')
  assert.equal(entries.filter(entry => entry === '/opt/homebrew/bin').length, 1)
  assert.ok(
    entries.indexOf('/opt/homebrew/bin') < entries.indexOf('/opt/homebrew/sbin'),
    'existing Homebrew bin keeps its precedence over appended missing sane entries'
  )
})

test('buildDesktopBackendEnv extends PYTHONPATH and backend PATH together', () => {
  const env = buildDesktopBackendEnv({
    hermesHome: '/Users/test/.hermes',
    pythonPathEntries: ['/repo/hermes-agent'],
    venvRoot: '/Users/test/.hermes/hermes-agent/venv',
    currentEnv: {
      PATH: '/usr/bin:/bin',
      PYTHONPATH: '/existing/pythonpath'
    },
    platform: 'darwin',
    pathModule: path.posix
  })

  assert.equal(env.PYTHONPATH, '/repo/hermes-agent:/existing/pythonpath')
  assert.ok(
    env.PATH.startsWith(
      '/Users/test/.hermes/node/bin:/Users/test/.hermes/node:/Users/test/.hermes/hermes-agent/venv/bin:'
    )
  )
  assert.ok(env.PATH.includes('/opt/homebrew/bin'))
})

test('buildDesktopBackendEnv forces PYTHONUTF8 unless the user set it explicitly', () => {
  const defaulted = buildDesktopBackendEnv({
    hermesHome: '/Users/test/.hermes',
    currentEnv: { PATH: '/usr/bin' },
    platform: 'darwin',
    pathModule: path.posix
  })

  assert.equal(defaulted.PYTHONUTF8, '1')

  const optedOut = buildDesktopBackendEnv({
    hermesHome: '/Users/test/.hermes',
    currentEnv: { PATH: '/usr/bin', PYTHONUTF8: '0' },
    platform: 'darwin',
    pathModule: path.posix
  })

  assert.equal(optedOut.PYTHONUTF8, '0')
})

test('normalizeHermesHomeRoot maps profile homes back to the global Hermes root', () => {
  assert.equal(
    normalizeHermesHomeRoot('/Users/test/.hermes/profiles/oracle', { pathModule: path.posix }),
    '/Users/test/.hermes'
  )
  assert.equal(
    normalizeHermesHomeRoot('C:\\Users\\test\\AppData\\Local\\hermes\\profiles\\oracle', { pathModule: path.win32 }),
    'C:\\Users\\test\\AppData\\Local\\hermes'
  )
  assert.equal(normalizeHermesHomeRoot('/Users/test/.hermes', { pathModule: path.posix }), '/Users/test/.hermes')
})

test('Windows PATH casing and delimiter are preserved without POSIX sane entries', () => {
  const env = buildDesktopBackendEnv({
    hermesHome: 'C:\\Users\\test\\AppData\\Local\\hermes',
    pythonPathEntries: ['C:\\repo\\hermes-agent'],
    venvRoot: 'C:\\Users\\test\\AppData\\Local\\hermes\\hermes-agent\\venv',
    currentEnv: {
      Path: 'C:\\Windows\\System32;C:\\Windows',
      PYTHONPATH: 'C:\\existing\\pythonpath'
    },
    platform: 'win32',
    pathModule: path.win32
  })

  assert.equal(pathEnvKey({ Path: 'x' }, 'win32'), 'Path')
  assert.equal(env.PATH, undefined)
  // Windows leads with the portable layout (install.ps1 unpacks node.exe
  // straight into node\, no bin\), then the POSIX shape for migrated installs.
  assert.ok(
    env.Path.startsWith(
      'C:\\Users\\test\\AppData\\Local\\hermes\\node;C:\\Users\\test\\AppData\\Local\\hermes\\node\\bin;'
    )
  )
  assert.ok(env.Path.includes('\\venv\\Scripts;'))
  assert.ok(env.Path.includes(';C:\\Windows\\System32;C:\\Windows'))
  assert.equal(env.Path.includes('/opt/homebrew/bin'), false)
})

test('appendUniquePathEntries drops empty entries and keeps first occurrence', () => {
  assert.equal(appendUniquePathEntries([':/a::/b', ['/a', '/c']], { delimiter: ':' }), '/a:/b:/c')
})
