/**
 * Read-only helpers over the server's whoami. These are UI DISPLAY CONTROL
 * ONLY — never a security boundary. The Hermes server enforces every permission
 * and capability itself; these helpers just decide what the console shows or
 * disables so the operator is not offered an action the server would reject.
 */

import type { CapabilityStatus, Whoami } from './types'

function effectivePerms(who: null | Whoami): string[] {
  if (!who) {
    return []
  }

  return who.effective_permissions ?? who.perms_effective ?? []
}

/**
 * Best-effort mirror of the server's wildcard permission match (`ops/auth.py`
 * `check_perm`). Supports the superuser `*` and dotted prefix grants like
 * `kb.*`. Intentionally conservative: a false negative only hides UI the server
 * would have allowed; the server remains the real gate.
 */
export function hasPermission(who: null | Whoami, perm: string): boolean {
  const perms = effectivePerms(who)

  if (perms.includes('*') || perms.includes(perm)) {
    return true
  }

  return perms.some(granted => {
    if (!granted.endsWith('.*')) {
      return false
    }

    const prefix = granted.slice(0, -1) // keep trailing dot: "kb."

    return perm.startsWith(prefix)
  })
}

export function capabilityStatus(who: null | Whoami, capability: string): CapabilityStatus | null {
  return who?.product_capabilities?.[capability]?.status ?? null
}

/** The server's own verdict: live AND covered by the caller's role ceiling. */
export function capabilityEnabled(who: null | Whoami, capability: string): boolean {
  return who?.product_capabilities?.[capability]?.enabled ?? false
}

export function isSuperAdmin(who: null | Whoami): boolean {
  return who?.role === 'super_admin'
}
