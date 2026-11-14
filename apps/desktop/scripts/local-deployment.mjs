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
    productName: 'Hermes-企业助手-本地联调', artifactName: 'Hermes-企业助手-${version}-${arch}-localprep.${ext}',
    protocols: [],
    electronDist, beforePack: 'scripts/before-pack-localprep.mjs',
    win: { ...build.win, signAndEditExecutable: false },
    nsis: { ...build.nsis, include: 'scripts/localprep-installer.nsh', shortcutName: 'Hermes-企业助手-本地联调',
      uninstallDisplayName: 'Hermes-企业助手-本地联调' },
    extraResources: build.extraResources.filter(item => !String(item.to ?? '').startsWith('openvpn-connect/')) }
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
