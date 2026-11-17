; Test installs are confined to their own per-user directory. Do not accept
; a caller-provided /D= or an existing non-test installation.
!macro customInit
  !insertmacro GetDParameter $R0
  ${If} $R0 != ""
    MessageBox MB_OK|MB_ICONSTOP "The test installer does not accept a custom installation directory."
    SetErrorLevel 2
    Quit
  ${EndIf}
  ${If} $INSTDIR != "$LOCALAPPDATA\Programs\${APP_FILENAME}"
    MessageBox MB_OK|MB_ICONSTOP "The test installation directory is not the dedicated local test directory."
    SetErrorLevel 2
    Quit
  ${EndIf}

  System::Call 'kernel32::GetFileAttributesW(w "$LOCALAPPDATA") i.r0'
  IntOp $0 $0 & 0x400
  ${If} $0 != 0
    SetErrorLevel 2
    Quit
  ${EndIf}
  System::Call 'kernel32::GetFileAttributesW(w "$LOCALAPPDATA\Programs") i.r0'
  ${If} $0 != -1
    IntOp $0 $0 & 0x400
    ${If} $0 != 0
      SetErrorLevel 2
      Quit
    ${EndIf}
  ${EndIf}
  System::Call 'kernel32::GetFileAttributesW(w "$INSTDIR") i.r0'
  ${If} $0 != -1
    IntOp $0 $0 & 0x400
    ${If} $0 != 0
      SetErrorLevel 2
      Quit
    ${EndIf}
  ${EndIf}

  IfFileExists "$INSTDIR\.hermes-localtest-install" t105_dir_allowed
  ClearErrors
  FindFirst $1 $2 "$INSTDIR\*"
  IfErrors t105_dir_allowed
  t105_dir_next:
    StrCmp $2 "" t105_dir_done
    StrCmp $2 "." t105_dir_continue
    StrCmp $2 ".." t105_dir_continue
    FindClose $1
    MessageBox MB_OK|MB_ICONSTOP "The test installation directory contains unrecognized files."
    SetErrorLevel 2
    Quit
  t105_dir_continue:
    ClearErrors
    FindNext $1 $2
    IfErrors t105_dir_done
    Goto t105_dir_next
  t105_dir_done:
    FindClose $1
  t105_dir_allowed:
!macroend

!macro customInstall
  FileOpen $0 "$INSTDIR\.hermes-localtest-install" w
  IfErrors 0 +3
    SetErrorLevel 2
    Quit
  FileWrite $0 "Hermes local test install v1"
  FileClose $0
!macroend
