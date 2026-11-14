import path from 'node:path'

// Match the POSIX fallback surface used by the Python terminal environment.
// macOS apps launched from Finder/Dock often inherit only /usr/bin:/bin:/usr/sbin:/sbin,
// which misses Apple Silicon Homebrew and user-installed CLI tools such as codex.
const POSIX_SANE_PATH_ENTRIES = Object.freeze([
  '/opt/homebrew/bin',
  '/opt/homebrew/sbin',
  '/usr/local/sbin',
  '/usr/local/bin',
  '/usr/sbin',
  '/usr/bin',
  '/sbin',
  '/bin'
])

function delimiterForPlatform(platform = process.platform) {
  return platform === 'win32' ? ';' : ':'
}

function pathModuleForPlatform(platform = process.platform) {
  return platform === 'win32' ? path.win32 : path.posix
}

function pathEnvKey(env = process.env, platform = process.platform) {
  if (platform !== 'win32') {
    return 'PATH'
  }

  return Object.keys(env || {}).find(key => key.toUpperCase() === 'PATH') || 'PATH'
}

function currentPathValue(env = process.env, platform = process.platform) {
  const key = pathEnvKey(env, platform)

  return env?.[key] || ''
}

function appendUniquePathEntries(entries, { delimiter = path.delimiter } = {}) {
  const seen = new Set()
  const ordered = []

  for (const entry of entries) {
    if (!entry) {
      continue
    }

    const parts = Array.isArray(entry) ? entry : String(entry).split(delimiter)

    for (const part of parts) {
      if (!part || seen.has(part)) {
        continue
      }

      seen.add(part)
      ordered.push(part)
    }
  }

  return ordered.join(delimiter)
}

/**
 * Hermes-managed Node.js directories, in preferred lookup order.
 *
 * There are two on-disk layouts. `scripts/install.ps1` unpacks portable Node
 * straight into `%LOCALAPPDATA%\hermes\node` (node.exe at the root, no `bin\`);
 * `scripts/install.sh` and the node-bootstrap helper use the POSIX
 * `$HERMES_HOME/node/bin`. Emit BOTH on every platform so mixed and migrated
 * installs resolve, leading with the layout native to the current platform.
 *
 * This is the single source of truth for the ordering rule on the Node side —
 * `main.ts` imports it rather than keeping its own copy. Mirrors
 * `iter_hermes_node_dirs()` in hermes_constants.py, which the Electron main
 * process cannot import.
 */
function hermesManagedNodePathEntries(
  hermesHome,
  { platform = process.platform, pathModule = pathModuleForPlatform(platform) }: any = {}
) {
  if (!hermesHome) {
    return []
  }

  const root = pathModule.join(hermesHome, 'node')
  const bin = pathModule.join(root, 'bin')

  return platform === 'win32' ? [root, bin] : [bin, root]
}

function buildDesktopBackendPath({
  hermesHome,
  venvRoot,
  currentPath = '',
  platform = process.platform,
  pathModule = pathModuleForPlatform(platform)
}: any = {}) {
  const delimiter = delimiterForPlatform(platform)
  const hermesNodeDirs = hermesManagedNodePathEntries(hermesHome, { platform, pathModule })
  const venvBin = venvRoot ? pathModule.join(venvRoot, platform === 'win32' ? 'Scripts' : 'bin') : null
  const saneEntries = platform === 'win32' ? [] : POSIX_SANE_PATH_ENTRIES

  return appendUniquePathEntries([hermesNodeDirs, venvBin, currentPath, saneEntries], { delimiter })
}

function normalizeHermesHomeRoot(hermesHome, { pathModule = pathModuleForPlatform(process.platform) }: any = {}) {
  if (!hermesHome) {
    return hermesHome
  }

  const resolved = pathModule.resolve(String(hermesHome))
  const parent = pathModule.dirname(resolved)

  if (pathModule.basename(parent).toLowerCase() === 'profiles') {
    return pathModule.dirname(parent)
  }

  return resolved
}

function localVerificationHome(local: boolean, userData: string, pathModule = pathModuleForPlatform(process.platform)) {
  if (!local) return null
  if (!userData || !pathModule.isAbsolute(userData)) throw new Error('Local verification requires an absolute userData directory')
  return pathModule.join(userData, 'hermes-home')
}

function localVerificationEnv(local: boolean, hermesHome: string) {
  return local ? { HERMES_HOME: hermesHome } : {}
}

const LOCAL_CHILD_EXPLICIT_KEYS = new Set([
  'TERMINAL_CWD', 'HERMES_DASHBOARD_SESSION_TOKEN', 'HERMES_DESKTOP',
  'HERMES_PARENT_PID', 'HERMES_PARENT_START_MARKER', 'HERMES_PARENT_NONCE',
  'HERMES_WEB_DIST', 'HERMES_DESKTOP_READY_FILE'
])

// Environment hygiene is a separate layer, not an OS filesystem or network sandbox.
function buildDesktopChildEnv({ local, inherited = process.env, backend = {}, explicit = {}, hermesHome,
  pythonPaths = [], platform = process.platform, pathModule = pathModuleForPlatform(platform) }: any) {
  if (!local) return { ...inherited, HERMES_HOME: hermesHome, ...backend, ...explicit }
  if (!hermesHome || !pathModule.isAbsolute(hermesHome) || (platform === 'win32' && !/^[a-z]:[\\/]/i.test(hermesHome))) {
    throw new Error('Local backend requires an absolute local home')
  }
  for (const key of Object.keys(explicit)) {
    if (!LOCAL_CHILD_EXPLICIT_KEYS.has(key)) throw new Error(`Local backend environment key is not allowed: ${key}`)
  }
  for (const entry of pythonPaths) {
    if (typeof entry !== 'string' || entry.includes(delimiterForPlatform(platform)) || !pathModule.isAbsolute(entry) ||
        (platform === 'win32' && !/^[a-z]:[\\/]/i.test(entry))) {
      throw new Error('Local backend Python paths must be absolute local paths')
    }
  }
  const home = pathModule.resolve(hermesHome)
  const env: Record<string, string> = {
    HERMES_HOME: home, HOME: home, USERPROFILE: home,
    APPDATA: pathModule.join(home, 'appdata'), LOCALAPPDATA: pathModule.join(home, 'localappdata'),
    TEMP: pathModule.join(home, 'temp'), TMP: pathModule.join(home, 'temp'),
    PYTHONUTF8: '1', PYTHONNOUSERSITE: '1'
  }
  if (platform === 'win32') {
    const rootKey = Object.keys(inherited).find(key => key.toUpperCase() === 'SYSTEMROOT')
    const root = rootKey && inherited[rootKey]
    if (typeof root !== 'string' || !/^[a-z]:[\\/]/i.test(root)) throw new Error('Local backend requires a local Windows system root')
    env.SystemRoot = pathModule.resolve(root)
    env.WINDIR = env.SystemRoot
    env.ComSpec = pathModule.join(env.SystemRoot, 'System32', 'cmd.exe')
    env.PATHEXT = '.COM;.EXE;.BAT;.CMD'
    env.PATH = [pathModule.join(env.SystemRoot, 'System32'), env.SystemRoot].join(';')
  } else {
    env.PATH = '/usr/bin:/bin'
  }
  if (pythonPaths.length) env.PYTHONPATH = pythonPaths.map((entry: string) => pathModule.resolve(entry)).join(delimiterForPlatform(platform))
  return { ...env, ...explicit }
}

function assertBootstrapAllowed(local: boolean, bootstrap: boolean) {
  if (local && bootstrap) throw new Error('Local verification cannot bootstrap or repair a Hermes runtime automatically')
}

function buildDesktopBackendEnv({
  hermesHome,
  pythonPathEntries = [],
  venvRoot,
  currentEnv = process.env,
  platform = process.platform,
  pathModule = pathModuleForPlatform(platform)
}: any = {}) {
  const delimiter = delimiterForPlatform(platform)
  const currentPythonPath = currentEnv?.PYTHONPATH || ''
  const key = pathEnvKey(currentEnv, platform)

  return {
    PYTHONPATH: appendUniquePathEntries([...pythonPathEntries, currentPythonPath], { delimiter }),
    // Force PEP 540 UTF-8 mode in the spawned Python backend so its stdio and
    // subprocess defaults are UTF-8 even on non-UTF-8 Windows locales (GBK,
    // cp1252, ...). hermes_bootstrap sets this inside the child too, but only
    // after import — anything emitted earlier (interpreter startup errors,
    // pre-bootstrap tracebacks) still decodes with the locale default without
    // this. User's explicit setting wins. Re-port of PR #56499 (echoriver89).
    PYTHONUTF8: currentEnv?.PYTHONUTF8 ?? '1',
    [key]: buildDesktopBackendPath({
      hermesHome,
      venvRoot,
      currentPath: currentPathValue(currentEnv, platform),
      platform,
      pathModule
    })
  }
}

export {
  appendUniquePathEntries,
  buildDesktopBackendEnv,
  buildDesktopChildEnv,
  buildDesktopBackendPath,
  delimiterForPlatform,
  hermesManagedNodePathEntries,
  localVerificationHome,
  localVerificationEnv,
  assertBootstrapAllowed,
  normalizeHermesHomeRoot,
  pathEnvKey,
  POSIX_SANE_PATH_ENTRIES
}
