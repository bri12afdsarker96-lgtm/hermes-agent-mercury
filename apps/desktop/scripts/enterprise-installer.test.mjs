import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

const require = createRequire(import.meta.url)
const desktop = require('../package.json')
const imageName = `${desktop.build.executableName}.exe`
const installDir = String.raw`C:\Apps\Enterprise`
const include = fileURLToPath(new URL('../electron/enterprise-installer.nsh', import.meta.url))
const templateIncludes = path.join(path.dirname(require.resolve('app-builder-lib/package.json')), 'templates/nsis/include')
const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe')
let temporaryRoot

function processFixture(id, executablePath, extra = {}) {
  return { ProcessId: id, Name: imageName, ExecutablePath: executablePath, ...extra }
}

function compileGuard() {
  const cache = path.join(process.env.LOCALAPPDATA, 'electron-builder/Cache/nsis')
  const compiler = fs.readdirSync(cache)
    .filter(name => name.startsWith('nsis-'))
    .map(name => path.join(cache, name, 'Bin/makensis.exe'))
    .find(candidate => fs.existsSync(candidate))
  expect(compiler, 'The existing electron-builder NSIS compiler must be cached').toBeTruthy()

  // NSIS expands the production macro into executable PowerShell test artifacts.
  // The generated PE is compiled for both hooks and is never launched.
  const fixture = [
    'Unicode true',
    'Name "Enterprise guard compile fixture"',
    `OutFile "${path.join(temporaryRoot, 'compile-only.exe')}"`,
    'RequestExecutionLevel user',
    '!include "LogicLib.nsh"',
    `!define APP_EXECUTABLE_FILENAME "${imageName}"`,
    `!include "${include}"`,
    `!addincludedir "${templateIncludes}"`,
    '!include "allowOnlyOneInstallerInstance.nsh"',
    'LangString appRunning 1033 "The application is running."',
    'LangString appClosing 1033 "Closing this installation."'
  ]
  fixture.push('!ifndef TEST_UNINSTALLER')
  for (const action of ['scan', 'close']) {
    fixture.push(
      `!insertmacro enterpriseProcessGuardCommand "${action}"`,
      '!searchreplace GuardScript "${EnterpriseProcessGuardCommand}" "$$" "$"',
      `!appendfile "${path.join(temporaryRoot, `${action}.ps1`)}" "\${GuardScript}"`,
      '!undef GuardScript',
      '!undef EnterpriseProcessGuardCommand'
    )
  }
  fixture.push(
    '!endif',
    '!ifdef TEST_UNINSTALLER',
    'Function un.checkAppRunning',
    '  !insertmacro CHECK_APP_RUNNING',
    'FunctionEnd',
    'Section "Compile only"',
    '  WriteUninstaller "$TEMP\\enterprise-guard-unused.exe"',
    'SectionEnd',
    'Section "un.Uninstall"',
    '  Call un.checkAppRunning',
    'SectionEnd',
    '!else',
    'Section "Compile only"',
    '  !insertmacro CHECK_APP_RUNNING',
    'SectionEnd',
    '!endif'
  )
  const input = path.join(temporaryRoot, 'compile-only.nsi')
  fs.writeFileSync(input, '\uFEFF' + fixture.join('\r\n'))
  for (const defines of [[], ['/DTEST_UNINSTALLER']]) {
    const result = spawnSync(compiler, ['/V3', '/WX', ...defines, input], {
      encoding: 'utf8', windowsHide: true, timeout: 30_000
    })
    expect(result.error, result.error?.message).toBeUndefined()
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
  }
}

function runGuard(action, fixture = {}, directory = installDir) {
  // Every process operation is replaced before invoking the real guard script.
  // A regression into the template's command-line fallback is also trapped.
  const harness = String.raw`
    [Console]::OutputEncoding = [Text.Encoding]::UTF8
    $ErrorActionPreference = 'Stop'
    $fixture = $env:HERMES_GUARD_TEST_FIXTURE | ConvertFrom-Json
    $state = [ordered]@{
      policy = (Get-ExecutionPolicy -Scope Process).ToString()
      queried = 0; inspected = @(); stopped = @(); disposed = @(); fallback = @()
    }
    function Get-CimInstance {
      [CmdletBinding()] param([string]$ClassName)
      $state.queried++
      if ($ClassName -ne 'Win32_Process') { throw 'Unexpected CIM class' }
      if ($fixture.queryFailure) { throw 'Synthetic CIM unavailable' }
      if ($fixture.nonTerminatingQueryError) { Write-Error 'Synthetic CIM permission denied' }
      $fixture.processes
    }
    function Get-Process {
      [CmdletBinding()] param([int]$Id)
      $state.inspected += $Id
      if ($fixture.processExited) {
        Write-Error -Message 'Synthetic exited process' -Category ObjectNotFound
        return
      }
      $candidate = $fixture.processes | Where-Object { $_.ProcessId -eq $Id } | Select-Object -First 1
      $livePath = $candidate.ExecutablePath
      if ($fixture.livePath) { $livePath = $fixture.livePath }
      $live = [pscustomobject]@{ Id = $Id; Path = $livePath }
      $live | Add-Member ScriptProperty Handle {
        if ($fixture.handleFailure) { throw 'Synthetic handle access denied' }
        return 1
      }
      $live | Add-Member ScriptMethod WaitForExit { param($milliseconds) return !$fixture.waitFailure }
      $live | Add-Member ScriptMethod Dispose { $state.disposed += $this.Id }
      return $live
    }
    function Stop-Process {
      [CmdletBinding()] param([object]$InputObject, [switch]$Force)
      if (!$Force) { throw 'Expected an explicit close' }
      if ($fixture.stopFailure) { throw 'Synthetic close access denied' }
      $state.stopped += $InputObject.Id
    }
    function taskkill { $state.fallback += 'taskkill'; throw 'Global fallback is forbidden' }
    function tasklist { $state.fallback += 'tasklist'; throw 'Global fallback is forbidden' }
    try {
      & ([scriptblock]::Create([IO.File]::ReadAllText($env:HERMES_GUARD_TEST_SCRIPT)))
    } finally {
      Write-Output ('GUARD_RESULT=' + ($state | ConvertTo-Json -Depth 8 -Compress))
    }
  `
  const result = spawnSync(powershell, [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Restricted', '-Command', harness
  ], {
    encoding: 'utf8', windowsHide: true, timeout: 15_000,
    env: {
      ...Object.fromEntries(Object.entries(process.env).filter(([name]) => name.toLowerCase() !== 'psmodulepath')),
      PSModulePath: path.join(path.dirname(powershell), 'Modules'),
      HERMES_NSIS_INSTALLDIR: directory,
      HERMES_GUARD_TEST_SCRIPT: path.join(temporaryRoot, `${action}.ps1`),
      HERMES_GUARD_TEST_FIXTURE: JSON.stringify({ processes: [], ...fixture })
    }
  })
  expect(result.error, result.error?.message).toBeUndefined()
  const line = result.stdout.split(/\r?\n/).find(value => value.startsWith('GUARD_RESULT='))
  expect(line, `${result.stdout}\n${result.stderr}`).toBeTruthy()
  const state = JSON.parse(line.slice('GUARD_RESULT='.length))
  expect(state.policy).toBe('Restricted')
  expect(state.fallback).toEqual([])
  return { ...result, state }
}

describe.skipIf(process.platform !== 'win32')('enterprise NSIS process guard', () => {
  beforeAll(() => {
    temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-nsis-guard-'))
    compileGuard()
  }, 30_000)

  afterAll(() => {
    if (temporaryRoot) fs.rmSync(temporaryRoot, { recursive: true, force: true })
  })

  test('compiles the actual electron-builder installer and uninstaller macro seams', () => {
    expect(fs.statSync(path.join(temporaryRoot, 'compile-only.exe')).size).toBeGreaterThan(0)
  })

  test.each(['scan', 'close'])('keeps external same-name instances during %s under Restricted', action => {
    const result = runGuard(action, { processes: [
      processFixture(101, String.raw`C:\Other\HermesEnterpriseAssistant.exe`),
      processFixture(102, String.raw`C:\Apps\Enterprise-backup\HermesEnterpriseAssistant.exe`),
      processFixture(103, String.raw`C:\Apps\Enterprise\..\Outside\HermesEnterpriseAssistant.exe`)
    ] })
    expect(result.status).toBe(0)
    expect(result.state.queried).toBe(1)
    expect(result.state.inspected).toEqual([])
    expect(result.state.stopped).toEqual([])
  })

  const mixedProcesses = [
    processFixture(201, String.raw`C:\Apps\Enterprise\HermesEnterpriseAssistant.exe`),
    processFixture(202, String.raw`c:\APPS\enterprise\child\HermesEnterpriseAssistant.exe`),
    processFixture(203, String.raw`C:\Other\HermesEnterpriseAssistant.exe`),
    processFixture(204, String.raw`C:\Apps\Enterprise-old\HermesEnterpriseAssistant.exe`),
    processFixture(205, null, { Name: 'System' })
  ]

  test('detects internal instances without closing any process', () => {
    const result = runGuard('scan', { processes: mixedProcesses })
    expect(result.status).toBe(10)
    expect(result.state.stopped).toEqual([])
  })

  test('closes only current-directory instances after checking each live process', () => {
    const result = runGuard('close', { processes: mixedProcesses }, `${installDir}\\`)
    expect(result.status).toBe(0)
    expect(result.state.inspected).toEqual([201, 202])
    expect(result.state.stopped).toEqual([201, 202])
    expect(result.state.disposed).toEqual([201, 202])
  })

  test('passes apostrophes, Unicode and PowerShell metacharacters as literal path data', () => {
    const directory = "C:\\Apps\\O'Brien $([int]'invalid') & \u4f01\u4e1a\u52a9\u624b"
    const result = runGuard('close', { processes: [
      processFixture(301, `${directory}\\${imageName}`),
      processFixture(302, `${directory}-other\\${imageName}`)
    ] }, directory)
    expect(result.status).toBe(0)
    expect(result.state.stopped).toEqual([301])
  })

  test.each(['queryFailure', 'nonTerminatingQueryError'])('fails closed on %s', failure => {
    const result = runGuard('close', { [failure]: true, processes: mixedProcesses })
    expect(result.status).toBe(2)
    expect(result.stdout).toContain('Process safety check failed.')
    expect(result.stdout).toContain('CIM')
    expect(result.state.stopped).toEqual([])
  })

  test.each([null, '', 'relative\\HermesEnterpriseAssistant.exe'])('fails closed on unreadable or invalid path %s', executablePath => {
    const result = runGuard('close', { processes: [mixedProcesses[0], processFixture(401, executablePath)] })
    expect(result.status).toBe(2)
    expect(result.state.inspected).toEqual([])
    expect(result.state.stopped).toEqual([])
  })

  test.each(['', 'relative\\Enterprise', 'C:\\', 'C:\\Apps\\..\\'])('rejects unsafe installation directory %s', directory => {
    const result = runGuard('close', { processes: mixedProcesses }, directory)
    expect(result.status).toBe(2)
    expect(result.state.queried).toBe(0)
    expect(result.state.stopped).toEqual([])
  })

  test('rejects a reused PID whose live executable moved outside INSTDIR', () => {
    const result = runGuard('close', {
      processes: [mixedProcesses[0]], livePath: String.raw`C:\Other\HermesEnterpriseAssistant.exe`
    })
    expect(result.status).toBe(2)
    expect(result.state.stopped).toEqual([])
    expect(result.state.disposed).toEqual([201])
  })

  test.each(['handleFailure', 'stopFailure', 'waitFailure'])('blocks continuation on %s', failure => {
    const result = runGuard('close', { [failure]: true, processes: [mixedProcesses[0]] })
    expect(result.status).toBe(2)
    expect(result.stdout).toContain('Process safety check failed.')
    expect(result.state.disposed).toEqual([201])
    expect(result.state.stopped).toEqual(failure === 'waitFailure' ? [201] : [])
  })

  test('handles a process exiting between the CIM snapshot and opening its handle', () => {
    const result = runGuard('close', { processExited: true, processes: [mixedProcesses[0]] })
    expect(result.status).toBe(0)
    expect(result.state.stopped).toEqual([])
  })
})
