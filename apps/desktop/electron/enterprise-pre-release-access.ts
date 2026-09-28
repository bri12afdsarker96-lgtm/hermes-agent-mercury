import fs from 'node:fs'
import path from 'node:path'

export const HERMES_PRE_RELEASE_PROFILE_NAME = 'Hermes 内部预发布'
export const MAX_OVPN_PROFILE_BYTES = 2 * 1024 * 1024

export interface OpenVpnProfileSummary {
  id: string
  name: string
}

export interface OvpnValidationResult {
  ok: boolean
  reason?: 'not_file' | 'too_large' | 'not_profile' | 'unsafe_directive' | 'unreadable'
}

const unsafeOvpnDirectives = new Set([
  'auth-user-pass-verify',
  'client-connect',
  'client-disconnect',
  'down',
  'ipchange',
  'learn-address',
  'management',
  'management-client',
  'management-query-passwords',
  'plugin',
  'route-pre-down',
  'route-up',
  'script-security',
  'up'
])

const externalMaterialDirectives = new Set([
  'ca',
  'cert',
  'key',
  'pkcs12',
  'secret',
  'tls-auth',
  'tls-crypt',
  'tls-crypt-v2'
])

/** Candidate locations are authored by Hermes, never supplied by the renderer. */
export function openVpnConnectExecutableCandidates(environment: NodeJS.ProcessEnv = process.env): string[] {
  const roots = [
    environment.ProgramW6432,
    environment.PROGRAMFILES,
    environment['ProgramFiles(x86)'],
    environment.LOCALAPPDATA
  ].filter((entry): entry is string => Boolean(entry))
  return [
    ...new Set(
      roots.map(root =>
        root === environment.LOCALAPPDATA
          ? path.join(root, 'Programs', 'OpenVPN Connect', 'OpenVPNConnect.exe')
          : path.join(root, 'OpenVPN Connect', 'OpenVPNConnect.exe')
      )
    )
  ]
}

export function findOpenVpnConnectExecutable(
  exists: (candidate: string) => boolean = fs.existsSync,
  environment: NodeJS.ProcessEnv = process.env
): string | null {
  return openVpnConnectExecutableCandidates(environment).find(candidate => exists(candidate)) ?? null
}

function hasEmbeddedMaterialDirective(line: string): boolean {
  const [directive, ...rest] = line.trim().split(/\s+/)
  return externalMaterialDirectives.has(directive.toLowerCase()) && rest.length > 0
}

/**
 * A VPN profile is executable configuration. Permit Tencent's ordinary inline
 * profile form but reject directives that could run local commands, attach a
 * management socket, or read arbitrary local certificate files.
 */
export function validateOvpnText(source: string): OvpnValidationResult {
  if (!/\bclient\b/i.test(source) || !/^\s*remote\s+\S+/im.test(source)) {
    return { ok: false, reason: 'not_profile' }
  }

  let inInlineBlock = false
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || line.startsWith(';')) {
      continue
    }
    if (/^<[^/][^>]*>$/i.test(line)) {
      inInlineBlock = true
      continue
    }
    if (/^<\/[^>]+>$/i.test(line)) {
      inInlineBlock = false
      continue
    }
    if (inInlineBlock) {
      continue
    }

    const directive = line.split(/\s+/, 1)[0]?.toLowerCase()
    if (unsafeOvpnDirectives.has(directive) || hasEmbeddedMaterialDirective(line)) {
      return { ok: false, reason: 'unsafe_directive' }
    }
  }

  return { ok: true }
}

export function validateOvpnProfileFile(profilePath: string): OvpnValidationResult {
  try {
    if (path.extname(profilePath).toLowerCase() !== '.ovpn') {
      return { ok: false, reason: 'not_profile' }
    }
    const stat = fs.lstatSync(profilePath)
    if (!stat.isFile() || stat.isSymbolicLink()) {
      return { ok: false, reason: 'not_file' }
    }
    if (stat.size <= 0 || stat.size > MAX_OVPN_PROFILE_BYTES) {
      return { ok: false, reason: 'too_large' }
    }
    const contents = fs.readFileSync(profilePath, 'utf8')
    if (contents.includes('\u0000')) {
      return { ok: false, reason: 'unreadable' }
    }
    return validateOvpnText(contents)
  } catch {
    return { ok: false, reason: 'unreadable' }
  }
}

export function parseOpenVpnProfiles(output: string): OpenVpnProfileSummary[] {
  try {
    const parsed = JSON.parse(output)
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed.flatMap(entry =>
      entry && typeof entry.id === 'string' && typeof entry.name === 'string'
        ? [{ id: entry.id, name: entry.name }]
        : []
    )
  } catch {
    return []
  }
}

export function hasHermesPreReleaseProfile(output: string, profileName = HERMES_PRE_RELEASE_PROFILE_NAME): boolean {
  return parseOpenVpnProfiles(output).some(profile => profile.name === profileName)
}

export function needsOpenVpnConsent(output: string): boolean {
  return /accept gdpr to use the application/i.test(output)
}

export function importProfileArguments(profilePath: string, profileName = HERMES_PRE_RELEASE_PROFILE_NAME): string[] {
  return [`--import-profile=${profilePath}`, `--name=${profileName}`]
}

export function backgroundLaunchArguments(): string[] {
  return ['--minimize', '--skip-startup-dialogs']
}

export function connectOnLaunchArguments(): string[] {
  return ['--set-setting=connect-on-launch', '--value=true']
}

export function minimizeOnLaunchArguments(): string[] {
  return ['--set-setting=minimize-on-launch', '--value=true']
}
