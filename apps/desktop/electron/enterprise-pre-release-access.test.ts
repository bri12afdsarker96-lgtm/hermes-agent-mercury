import { expect, it } from 'vitest'

import {
  backgroundLaunchArguments,
  connectOnLaunchArguments,
  findOpenVpnConnectExecutable,
  hasHermesPreReleaseProfile,
  importProfileArguments,
  needsOpenVpnConsent,
  openVpnConnectExecutableCandidates,
  validateOvpnText
} from './enterprise-pre-release-access'

it('uses only authored OpenVPN Connect executable locations', () => {
  const candidates = openVpnConnectExecutableCandidates({
    PROGRAMFILES: 'C:\\Program Files',
    LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local'
  })
  expect(candidates).toEqual([
    'C:\\Program Files\\OpenVPN Connect\\OpenVPNConnect.exe',
    'C:\\Users\\test\\AppData\\Local\\Programs\\OpenVPN Connect\\OpenVPNConnect.exe'
  ])
  expect(
    findOpenVpnConnectExecutable(candidate => candidate.includes('Programs'), {
      LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local'
    })
  ).toBe('C:\\Users\\test\\AppData\\Local\\Programs\\OpenVPN Connect\\OpenVPNConnect.exe')
})

it('accepts a normal inline profile and rejects local-command or external-file directives', () => {
  const normal =
    'client\nremote 118.195.140.41 9798 udp\n<ca>\ncertificate\n</ca>\n<cert>\ncertificate\n</cert>\n<key>\nprivate-key\n</key>'
  expect(validateOvpnText(normal)).toEqual({ ok: true })
  expect(validateOvpnText(`${normal}\nup C:\\temp\\script.cmd`)).toEqual({ ok: false, reason: 'unsafe_directive' })
  expect(validateOvpnText(`${normal}\nca C:\\Windows\\secret.pem`)).toEqual({ ok: false, reason: 'unsafe_directive' })
})

it('uses fixed command arguments and detects only the owned profile', () => {
  const profiles = JSON.stringify([
    { id: 'one', name: 'Another profile' },
    { id: 'two', name: 'Hermes 内部预发布' }
  ])
  expect(hasHermesPreReleaseProfile(profiles)).toBe(true)
  expect(hasHermesPreReleaseProfile(JSON.stringify([{ id: 'one', name: 'Hermes 内部预发布 - copy' }]))).toBe(false)
  expect(importProfileArguments('C:\\Users\\tester\\Downloads\\tester.ovpn')).toEqual([
    '--import-profile=C:\\Users\\tester\\Downloads\\tester.ovpn',
    '--name=Hermes 内部预发布'
  ])
  expect(connectOnLaunchArguments()).toEqual(['--set-setting=connect-on-launch', '--value=true'])
  expect(backgroundLaunchArguments()).toEqual(['--minimize', '--skip-startup-dialogs'])
  expect(needsOpenVpnConsent('{"error":"Accept GDPR to use the application."}')).toBe(true)
})
