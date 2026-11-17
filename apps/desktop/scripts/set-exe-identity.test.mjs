import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'

import { stampExeIdentity } from './set-exe-identity.mjs'
import afterPack from './after-pack.mjs'

const fixture = process.env.HERMES_PE_TEST_ELECTRON_EXE
const desktopRoot = resolve(import.meta.dirname, '..')
const enabled = process.platform === 'win32' && !!fixture
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex')

function versionInfo(exe) {
  const command = '$v=(Get-Item -LiteralPath $env:HERMES_PE_TEST_TARGET).VersionInfo; ' +
    '[pscustomobject]@{FileVersion=$v.FileVersion;ProductVersion=$v.ProductVersion;FileMajor=$v.FileMajorPart;FileMinor=$v.FileMinorPart;FileBuild=$v.FileBuildPart;FilePrivate=$v.FilePrivatePart;ProductMajor=$v.ProductMajorPart;ProductMinor=$v.ProductMinorPart;ProductBuild=$v.ProductBuildPart;ProductPrivate=$v.ProductPrivatePart;ProductName=$v.ProductName;FileDescription=$v.FileDescription;CompanyName=$v.CompanyName;InternalName=$v.InternalName;OriginalFilename=$v.OriginalFilename}|ConvertTo-Json -Compress'
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    encoding: 'utf8', env: { ...process.env, HERMES_PE_TEST_TARGET: exe }
  })
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

test('stamps package version into real PE resources without changing the source executable', { skip: !enabled }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'hermes-pe-version-'))
  const originalHash = hash(fixture)
  try {
    const sourceVersion = JSON.parse(readFileSync(join(desktopRoot, 'package.json'), 'utf8')).version
    const versions = [sourceVersion, '1.2.3', '2.3.4-beta.1']
    for (const [index, version] of versions.entries()) {
      const project = join(root, `${index}-${version}`)
      const icon = join(project, 'assets', 'brand', 'hermes-mark-hires.ico')
      const exe = join(project, 'HermesEnterpriseAssistantLocalTest.exe')
      mkdirSync(dirname(icon), { recursive: true })
      copyFileSync(join(desktopRoot, 'assets', 'brand', 'hermes-mark-hires.ico'), icon)
      copyFileSync(fixture, exe)
      writeFileSync(join(project, 'package.json'), JSON.stringify({ version }))
      const before = versionInfo(exe)
      assert.notEqual(before.FileVersion, version, 'fixture should expose the original Electron version')
      await stampExeIdentity(exe, index === 0 ? desktopRoot : project)
      const after = versionInfo(exe)
      const expectedVersion = version.split('-')[0]
      const parts = expectedVersion.split('.').map(Number)
      assert.deepEqual([after.FileMajor, after.FileMinor, after.FileBuild, after.FilePrivate], [...parts, 0])
      assert.deepEqual([after.ProductMajor, after.ProductMinor, after.ProductBuild, after.ProductPrivate], [...parts, 0])
      assert.match(after.FileVersion, new RegExp(`^${expectedVersion.replaceAll('.', '\\.')}(?:\\.0)?$`))
      assert.match(after.ProductVersion, new RegExp(`^${expectedVersion.replaceAll('.', '\\.')}(?:\\.0)?$`))
      assert.equal(after.ProductName, 'Hermes-企业助手')
      assert.equal(after.FileDescription, 'Hermes-企业助手')
      assert.equal(after.CompanyName, '七巧板')
      assert.equal(after.InternalName, before.InternalName)
      assert.equal(after.OriginalFilename, before.OriginalFilename)
    }
    assert.equal(hash(fixture), originalHash, 'source Electron executable must remain unchanged')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('rejects versions that cannot fit Windows version fields before editing', { skip: !enabled }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'hermes-pe-invalid-'))
  try {
    const icon = join(root, 'assets', 'brand', 'hermes-mark-hires.ico')
    const exe = join(root, 'fixture.exe')
    mkdirSync(dirname(icon), { recursive: true })
    copyFileSync(join(desktopRoot, 'assets', 'brand', 'hermes-mark-hires.ico'), icon)
    copyFileSync(fixture, exe)
    const before = hash(exe)
    for (const version of ['bad', '1.2.65536', '1.2']) {
      writeFileSync(join(root, 'package.json'), JSON.stringify({ version }))
      await assert.rejects(stampExeIdentity(exe, root), /invalid Windows executable version/)
      assert.equal(hash(exe), before)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('afterPack stamps the configured executable using the desktop package version', { skip: !enabled }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'hermes-pe-hook-'))
  try {
    const staged = join(root, 'project', 'build', 'doudian')
    const out = join(root, 'win-unpacked')
    const packaged = join(out, 'resources', 'doudian')
    mkdirSync(staged, { recursive: true })
    mkdirSync(packaged, { recursive: true })
    const content = 'synthetic fixture only'
    const digest = createHash('sha256').update(content).digest('hex')
    const manifest = JSON.stringify({ protocol: 1, integration: 'hermes-review-v1', files: { 'fixture.txt': digest } })
    for (const dir of [staged, packaged]) {
      writeFileSync(join(dir, 'fixture.txt'), content)
      writeFileSync(join(dir, 'manifest.json'), manifest)
    }
    const exe = join(out, 'HermesEnterpriseAssistantLocalTest.exe')
    copyFileSync(fixture, exe)
    await afterPack({ electronPlatformName: 'win32', appOutDir: out,
      packager: { appInfo: { productFilename: 'HermesEnterpriseAssistantLocalTest' }, projectDir: join(root, 'project') } })
    const actual = versionInfo(exe)
    const version = JSON.parse(readFileSync(join(desktopRoot, 'package.json'), 'utf8')).version
    assert.deepEqual([actual.FileMajor, actual.FileMinor, actual.FileBuild, actual.FilePrivate], [...version.split('.').map(Number), 0])
    assert.deepEqual([actual.ProductMajor, actual.ProductMinor, actual.ProductBuild, actual.ProductPrivate], [...version.split('.').map(Number), 0])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
