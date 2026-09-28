; Only an actual NSIS install has this marker. Unpacked and MSI builds must
; not claim they can use the per-user NSIS update channel.
!macro customInstall
  FileOpen $0 "$INSTDIR\resources\enterprise-nsis-install.json" w
  FileWrite $0 '{"schemaVersion":1,"installer":"nsis","appId":"com.qiqiaoban.hermes-enterprise-assistant"}'
  FileClose $0

  ; The pre-release package carries the vendor's reviewed MSI. Do not run it
  ; silently: OpenVPN Connect presents its own licence/privacy UI and Windows
  ; owns any UAC prompt for its networking driver. A decline only skips this
  ; optional prerequisite; the Hermes login guide can start it later.
  IfFileExists "$PROGRAMFILES64\OpenVPN Connect\OpenVPNConnect.exe" openvpn_connect_ready
  IfFileExists "$PROGRAMFILES\OpenVPN Connect\OpenVPNConnect.exe" openvpn_connect_ready
  IfFileExists "$LOCALAPPDATA\Programs\OpenVPN Connect\OpenVPNConnect.exe" openvpn_connect_ready
  MessageBox MB_YESNO|MB_ICONQUESTION "内部预发布接入需要 OpenVPN Connect。下一步将打开 OpenVPN Connect 的官方安装程序；请在其中阅读并确认其许可与隐私说明。现在安装吗？" IDYES openvpn_connect_install IDNO openvpn_connect_ready

  openvpn_connect_install:
  ExecWait '"msiexec.exe" /i "$INSTDIR\resources\openvpn-connect\openvpn-connect-3.9.0.5008_signed.msi"' $1
  StrCmp $1 0 openvpn_connect_ready
  StrCmp $1 3010 openvpn_connect_restart
  MessageBox MB_ICONEXCLAMATION "OpenVPN Connect 尚未完成安装。Hermes 已继续安装；首次打开时可在“内部预发布接入”中再次安装。"
  Goto openvpn_connect_ready

  openvpn_connect_restart:
  MessageBox MB_ICONINFORMATION "OpenVPN Connect 已安装完成，但 Windows 要求重启后才能使用内部预发布接入。"

  openvpn_connect_ready:
!macroend

!macro customUnInstall
  Delete "$INSTDIR\resources\enterprise-nsis-install.json"
!macroend
