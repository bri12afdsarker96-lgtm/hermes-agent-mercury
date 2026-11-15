; CHECK_APP_RUNNING uses this override for both installation and uninstallation.
; Restricted permits inline commands. Never enter the image-name kill fallback.
!macro enterpriseProcessGuardCommand ACTION
  !define EnterpriseProcessGuardCommand \
    `& { $$ErrorActionPreference = 'Stop'; \
      try { \
        $$directory = $$env:HERMES_NSIS_INSTALLDIR; \
        if ([string]::IsNullOrWhiteSpace($$directory) -or ![IO.Path]::IsPathRooted($$directory)) { throw 'Invalid installation directory.' }; \
        $$directory = [IO.Path]::GetFullPath($$directory).TrimEnd([char]92); \
        if ($$directory -eq [IO.Path]::GetPathRoot($$directory).TrimEnd([char]92)) { throw 'Installation directory must be an application folder.' }; \
        $$prefix = $$directory + [char]92; \
        $$targets = @(); \
        $$snapshot = @(Get-CimInstance -ClassName Win32_Process -ErrorAction Stop); \
        foreach ($$candidate in $$snapshot) { \
          if ($$candidate.Name -ine '${APP_EXECUTABLE_FILENAME}') { continue }; \
          if ([string]::IsNullOrWhiteSpace($$candidate.ExecutablePath) -or ![IO.Path]::IsPathRooted($$candidate.ExecutablePath)) { throw 'CIM did not return an executable path for an application process.' }; \
          $$path = [IO.Path]::GetFullPath($$candidate.ExecutablePath); \
          if ($$path.StartsWith($$prefix, [StringComparison]::OrdinalIgnoreCase)) { $$targets += $$candidate }; \
        }; \
        if ('${ACTION}' -eq 'scan') { if ($$targets.Count -gt 0) { exit 10 }; exit 0 }; \
        if ('${ACTION}' -ne 'close') { throw 'Invalid process guard action.' }; \
        foreach ($$candidate in $$targets) { \
          try { $$live = Get-Process -Id $$candidate.ProcessId -ErrorAction Stop } \
          catch { if ($$_.CategoryInfo.Category -eq 'ObjectNotFound') { continue }; throw }; \
          try { \
            $$handle = $$live.Handle; \
            if ($$null -eq $$handle -or $$handle -eq [IntPtr]::Zero) { throw 'Cannot open a process handle safely.' }; \
            if ([string]::IsNullOrWhiteSpace($$live.Path) -or ![IO.Path]::IsPathRooted($$live.Path)) { throw 'Cannot verify the live executable path.' }; \
            $$livePath = [IO.Path]::GetFullPath($$live.Path); \
            if (!$$livePath.StartsWith($$prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Process identity changed during verification.' }; \
            Stop-Process -InputObject $$live -Force -ErrorAction Stop; \
            if (!$$live.WaitForExit(5000)) { throw 'An application process did not exit.' }; \
          } finally { $$live.Dispose() }; \
        }; \
        exit 0; \
      } catch { Write-Output ('Process safety check failed. ' + $$_.Exception.Message); exit 2 }; \
    }`
!macroend

!macro enterpriseRunProcessGuard ACTION
  !insertmacro enterpriseProcessGuardCommand "${ACTION}"
  nsExec::ExecToStack /TIMEOUT=30000 `"$PowerShellPath" -NoLogo -NoProfile -NonInteractive -Command "${EnterpriseProcessGuardCommand}"`
  !undef EnterpriseProcessGuardCommand
  Pop $0
  Pop $1
!macroend

!macro enterpriseProcessGuardFailure
  DetailPrint "$1"
  MessageBox MB_OK|MB_ICONSTOP "Setup stopped because it could not safely verify or close application processes in $INSTDIR.$\r$\nPowerShell/CIM must be available and executable paths must be readable.$\r$\n$1$\r$\nClose this folder's application manually and retry, or contact your administrator." /SD IDOK
  SetErrorLevel 2
  Quit
!macroend

!macro customCheckAppRunning
  Push $0
  Push $1
  ; Pass the directory as data, including apostrophes and PowerShell metacharacters.
  System::Call 'kernel32::SetEnvironmentVariable(t "HERMES_NSIS_INSTALLDIR", t "$INSTDIR") i.r0'
  ${If} $0 == 0
    StrCpy $1 "Cannot pass the installation directory to the process safety check."
    !insertmacro enterpriseProcessGuardFailure
  ${EndIf}

  !insertmacro enterpriseRunProcessGuard "scan"
  ${If} $0 == 10
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" /SD IDOK IDOK +3
    SetErrorLevel 1
    Quit
    DetailPrint "$(appClosing)"
    !insertmacro enterpriseRunProcessGuard "close"
    ${If} $0 != 0
      !insertmacro enterpriseProcessGuardFailure
    ${EndIf}
    ; A new instance or a failed close must prevent files from being replaced.
    !insertmacro enterpriseRunProcessGuard "scan"
    ${If} $0 == 10
      StrCpy $1 "Application processes are still running in the installation directory."
    ${EndIf}
  ${EndIf}
  ${If} $0 != 0
    !insertmacro enterpriseProcessGuardFailure
  ${EndIf}
  System::Call 'kernel32::SetEnvironmentVariable(t "HERMES_NSIS_INSTALLDIR", p 0)'
  Pop $1
  Pop $0
!macroend

; Only an actual NSIS install has this marker. Unpacked and MSI builds must
; not claim they can use the per-user NSIS update channel.
!macro customInstall
  FileOpen $0 "$INSTDIR\resources\enterprise-nsis-install.json" w
  FileWrite $0 '{"schemaVersion":1,"installer":"nsis","appId":"com.qiqiaoban.hermes-enterprise-assistant"}'
  FileClose $0

!macroend

!macro customUnInstall
  Delete "$INSTDIR\resources\enterprise-nsis-install.json"
!macroend
