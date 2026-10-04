import { existsSync } from 'node:fs'
import path from 'node:path'

import type { BrowserWindow, shell } from 'electron'

export const ENTERPRISE_APP_ID = 'com.qiqiaoban.hermes-enterprise-assistant'

export function applyEnterpriseWindowIdentity(
  window: Pick<BrowserWindow, 'setAppDetails'>,
  executable: string,
  icon: string
) {
  window.setAppDetails({
    appId: ENTERPRISE_APP_ID,
    appIconPath: icon,
    appIconIndex: 0,
    relaunchCommand: `"${executable}"`,
    relaunchDisplayName: 'Hermes-企业助手'
  })
}

const samePath = (left: string, right: string) =>
  path.win32.normalize(left).toLowerCase() === path.win32.normalize(right).toLowerCase()

/** Migrate existing links for this product only; preserve pinning and arguments.
 * An installed app may update user links but lack access to public links.
 */
export function repairEnterpriseShortcuts(
  shortcuts: string[],
  executable: string,
  icon: string,
  bridge: Pick<typeof shell, 'readShortcutLink' | 'writeShortcutLink'>
) {
  const repaired: string[] = []
  const failed: string[] = []

  for (const shortcut of new Set(shortcuts)) {
    if (!existsSync(shortcut)) {
      continue
    }

    try {
      const previous = bridge.readShortcutLink(shortcut)

      if (previous.appUserModelId !== ENTERPRISE_APP_ID) {
        continue
      }

      if (samePath(previous.target, executable) && samePath(previous.icon, icon) && previous.iconIndex === 0) {
        continue
      }

      if (
        !bridge.writeShortcutLink(shortcut, 'update', {
          target: executable,
          cwd: path.win32.dirname(executable),
          icon,
          iconIndex: 0,
          appUserModelId: ENTERPRISE_APP_ID
        })
      ) {
        throw new Error('Shortcut update failed')
      }

      repaired.push(shortcut)
    } catch {
      failed.push(shortcut)
    }
  }

  return { repaired, failed }
}
