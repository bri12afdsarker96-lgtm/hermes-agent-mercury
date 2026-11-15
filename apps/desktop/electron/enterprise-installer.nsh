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
