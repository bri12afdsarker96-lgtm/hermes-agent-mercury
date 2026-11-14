import { normalizeEnterpriseApiOriginOrNull } from './enterprise-transport'

export type EnterpriseOriginSelection = {
  origin: string | null
  source: 'env' | 'packaged' | 'local-build'
  local: boolean
}

/** Validate the literal authority before URL normalization can rewrite a host. */
export function requireLoopbackOrigin(value: unknown): string {
  if (typeof value !== 'string') throw new Error('local enterprise origin must be a URL')
  const raw = value.trim()
  const match = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):([0-9]+)\/?$/i.exec(raw)
  if (!match || !Number.isInteger(Number(match[2])) || Number(match[2]) < 1 || Number(match[2]) > 65535) {
    throw new Error('local enterprise origin must be http with an explicit port and a loopback host')
  }
  const parsed = new URL(raw)
  // Avoid consulting hosts/DNS for the local-only destination.
  const host = match[1].toLowerCase() === 'localhost' ? '127.0.0.1' : parsed.hostname
  return `http://${host}:${Number(match[2])}`
}

export function selectEnterpriseOrigin(options: {
  isPackaged: boolean
  packagedOrigin: unknown
  localBuild: boolean
  envOrigin?: string
}): EnterpriseOriginSelection {
  if (options.localBuild) {
    return { origin: requireLoopbackOrigin(options.packagedOrigin), source: 'local-build', local: true }
  }
  if (options.isPackaged) {
    return { origin: normalizeEnterpriseApiOriginOrNull(options.packagedOrigin), source: 'packaged', local: false }
  }
  if (options.envOrigin !== undefined) {
    return { origin: requireLoopbackOrigin(options.envOrigin), source: 'env', local: true }
  }
  return { origin: normalizeEnterpriseApiOriginOrNull(options.packagedOrigin), source: 'packaged', local: false }
}
