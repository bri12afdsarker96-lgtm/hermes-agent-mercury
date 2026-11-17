import { readFile } from 'node:fs/promises'
import path from 'node:path'

export function validateLocalOrigin(value) {
  if (typeof value !== 'string') throw new Error('A local origin is required')
  const match = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):([0-9]+)\/?$/i.exec(value.trim())
  const port = Number(match?.[2])
  if (!match || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Local origin must use http, an explicit port and an allowed loopback host')
  }
  const host = match[1].toLowerCase() === 'localhost' ? '127.0.0.1' : match[1].toLowerCase()
  return `http://${host}:${port}`
}

export function makeLocalDeployment(production, requestedOrigin) {
  return { ...production, enterprise_api_origin: validateLocalOrigin(requestedOrigin),
    local_verification_only: true, pre_release_access: { ...production.pre_release_access, enabled: false } }
}

export function makeLocalBuilderConfig(build, electronDist) {
  if (!electronDist || !Array.isArray(build.extraResources)) throw new Error('Local build requires installed Electron and resource configuration')
  return { ...build, appId: 'com.qiqiaoban.hermes-enterprise-assistant.localprep',
    executableName: 'HermesEnterpriseAssistantLocalPrep', publish: null,
    productName: 'Hermes-企业助手-本地联调', artifactName: 'Hermes-企业助手-${version}-${arch}-localprep.${ext}',
    protocols: [],
    electronDist, beforePack: 'scripts/before-pack-localprep.mjs',
    win: { ...build.win, signAndEditExecutable: false },
    nsis: { ...build.nsis, include: 'scripts/localprep-installer.nsh', shortcutName: 'Hermes-企业助手-本地联调',
      uninstallDisplayName: 'Hermes-企业助手-本地联调' },
    extraResources: build.extraResources.filter(item => !String(item.to ?? '').startsWith('openvpn-connect/')) }
}

export function makeCloudTestBuilderConfig(build, electronDist) {
  if (!electronDist || !Array.isArray(build.extraResources)) throw new Error('Test build requires installed Electron and resources')
  return { ...build, appId: 'com.qiqiaoban.hermes-enterprise-assistant.localtest',
    executableName: 'HermesEnterpriseAssistantLocalTest', productName: 'Hermes-企业助手-测试版',
    artifactName: 'Hermes-企业助手-${version}-${arch}-localtest.${ext}', protocols: [], publish: null,
    extraMetadata: { ...build.extraMetadata, name: 'hermes-enterprise-localtest', productName: 'Hermes-企业助手-测试版' },
    electronDist, win: { ...build.win, signAndEditExecutable: false },
    nsis: { ...build.nsis, include: 'scripts/cloud-test-installer.nsh',
      shortcutName: 'Hermes-企业助手-测试版', uninstallDisplayName: 'Hermes-企业助手-测试版', runAfterFinish: false,
      allowToChangeInstallationDirectory: false } }
}

export function cloudTestPaths({ appData, argv, protectedPaths = [], pathModule = path, canonicalize = value => value }) {
  const prefix = '--hermes-test-data-root='
  const args = argv.filter(arg => arg === '--hermes-test-data-root' || arg.startsWith(prefix))
  if (args.length > 1) throw new Error('Only one test data root may be supplied')
  const requested = args.length ? args[0].slice(prefix.length) : pathModule.join(appData, 'Hermes-Enterprise-LocalTest')
  if (!requested || !pathModule.isAbsolute(requested) || requested === pathModule.parse(requested).root) {
    throw new Error('Test data root must be an absolute non-root directory')
  }
  const root = canonicalize(pathModule.resolve(requested))
  const overlaps = (a, b) => {
    const rel = pathModule.relative(a, b)
    return rel === '' || (!rel.startsWith(`..${pathModule.sep}`) && rel !== '..' && !pathModule.isAbsolute(rel))
  }
  for (const item of protectedPaths.filter(Boolean)) {
    const protectedRoot = canonicalize(pathModule.resolve(item))
    if (overlaps(root, protectedRoot) || overlaps(protectedRoot, root)) throw new Error('Test data root overlaps a protected profile')
  }
  return { root, userData: pathModule.join(root, 'electron'), hermesHome: pathModule.join(root, 'hermes-home') }
}

export function applyCloudTestStartup({ enabled, app, platform, mkdir, ...options }) {
  if (!enabled) return null
  const paths = cloudTestPaths(options)
  mkdir(paths.userData)
  app.setPath('userData', paths.userData)
  app.setPath('sessionData', paths.userData)
  app.setName('Hermes-企业助手-测试版')
  if (platform === 'win32') app.setAppUserModelId('com.qiqiaoban.hermes-enterprise-assistant.localtest')
  return paths
}

export function tdHostEnvironment({ cloudTest, root, inherited = process.env, pathModule = path }) {
  const env = { ...inherited }
  for (const key of Object.keys(env)) if (key.toUpperCase() === 'HERMES_TD_LOCAL_TEST_ROOT') delete env[key]
  if (cloudTest) {
    if (!root || !pathModule.isAbsolute(root)) throw new Error('TD test root must be absolute')
    env.HERMES_TD_LOCAL_TEST_ROOT = pathModule.join(root, 'td')
  }
  return env
}

export function registerDesktopProtocol(app, { local, protocol, defaultApp, argv, executable }) {
  if (local) return
  if (defaultApp && argv.length >= 2) {
    app.setAsDefaultProtocolClient(protocol, executable, [path.resolve(argv[1])])
  } else {
    app.setAsDefaultProtocolClient(protocol)
  }
}

export async function localDeploymentPlugin(file, deploymentFile) {
  const config = JSON.parse(await readFile(file, 'utf8'))
  if (config.local_verification_only !== true || config.pre_release_access?.enabled !== false) {
    throw new Error('Invalid local verification deployment')
  }
  config.enterprise_api_origin = validateLocalOrigin(config.enterprise_api_origin)
  const target = path.resolve(deploymentFile)
  return { name: 'local-enterprise-deployment', setup(build) {
    build.onResolve({ filter: /enterprise-deployment\.json$/ }, args => {
      if (path.resolve(args.resolveDir, args.path) !== target) return undefined
      return { path: target, namespace: 'local-enterprise-deployment' }
    })
    build.onLoad({ filter: /.*/, namespace: 'local-enterprise-deployment' }, () => ({ contents: JSON.stringify(config), loader: 'json' }))
  } }
}
