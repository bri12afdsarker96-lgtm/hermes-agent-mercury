import path from 'node:path'
import { build } from 'esbuild'
import { _electron, expect, test, type ElectronApplication } from '@playwright/test'
import { buildAppEnv, createSandbox } from './fixtures'
import pkg from '../package.json' with { type: 'json' }

test('migrates only enterprise shortcuts using the real Windows shell', async ({}, info) => {
  test.skip(process.platform !== 'win32', 'Windows shell integration')
  const sandbox = createSandbox('windows-identity')
  const helper = path.join(sandbox.root, 'windows-identity.cjs')
  await build({
    entryPoints: [path.resolve('electron/enterprise-windows-identity.ts')],
    outfile: helper,
    bundle: true,
    platform: 'node',
    format: 'cjs'
  })
  const env = buildAppEnv(sandbox, { HERMES_DESKTOP_BOOT_FAKE: '1' })
  delete env.HERMES_DESKTOP_HERMES_ROOT
  delete env.HERMES_DESKTOP_DEV_SERVER
  delete env.ELECTRON_RUN_AS_NODE
  let app: ElectronApplication | undefined
  try {
    app = await _electron.launch({
      executablePath: path.resolve('release', pkg.version, 'win-unpacked', 'HermesEnterpriseAssistant.exe'),
      args: ['--disable-gpu', '--no-sandbox'],
      env
    })
    const result = await app.evaluate(
      async ({ app, shell }, options) => {
        const require = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json')
        const { repairEnterpriseShortcuts, ENTERPRISE_APP_ID } = require(options.module)
        const path = process.getBuiltinModule('path')
        const fs = process.getBuiltinModule('fs')
        const ours = path.join(options.root, 'enterprise.lnk')
        const other = path.join(options.root, 'other-product.lnk')
        const old = path.join(options.root, 'removed-0.20.7.exe')
        const executable = app.getPath('exe')
        const icon = path.join(process.resourcesPath, 'brand-icon.ico')
        if (
          !shell.writeShortcutLink(ours, 'create', {
            target: old,
            icon: old,
            iconIndex: 0,
            appUserModelId: ENTERPRISE_APP_ID,
            args: '--fixture-only'
          })
        )
          throw new Error('Cannot create enterprise fixture')
        if (!shell.writeShortcutLink(other, 'create', { target: old, appUserModelId: 'other.product' }))
          throw new Error('Cannot create unrelated fixture')
        const before = fs.readFileSync(other).toString('base64')
        const migration = repairEnterpriseShortcuts([ours, ours, other], executable, icon, shell)
        const migrated = shell.readShortcutLink(ours)
        const second = repairEnterpriseShortcuts([ours, other], executable, icon, shell)
        const untouched = before === fs.readFileSync(other).toString('base64')
        return { executable, icon, migrated, migration, second, untouched }
      },
      { root: sandbox.root, module: helper }
    )
    expect(result.migration.failed).toEqual([])
    expect(result.migration.repaired).toHaveLength(1)
    expect(result.migrated.target).toBe(result.executable)
    expect(result.migrated.icon).toBe(result.icon)
    expect(result.migrated.iconIndex).toBe(0)
    expect(result.migrated.args).toBe('--fixture-only')
    expect(result.migrated.appUserModelId).toBe('com.qiqiaoban.hermes-enterprise-assistant')
    expect(result.second).toEqual({ repaired: [], failed: [] })
    expect(result.untouched).toBe(true)
    await info.attach('shortcut-migration', { body: JSON.stringify(result, null, 2), contentType: 'application/json' })
  } finally {
    await app?.close().catch(() => {})
    sandbox.cleanup()
  }
})
