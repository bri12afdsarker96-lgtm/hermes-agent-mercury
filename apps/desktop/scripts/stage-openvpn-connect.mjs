/**
 * Fetch the exact OpenVPN Connect MSI included by the internal Windows
 * installer. The binary deliberately is not committed to Hermes source: each
 * package build retrieves it from the vendor's HTTPS endpoint and fails closed
 * unless its official SHA-256 matches the reviewed manifest.
 */
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const desktopDirectory = path.resolve(scriptDirectory, '..')
const manifestPath = path.join(desktopDirectory, 'assets', 'openvpn-connect-manifest.json')
const downloadDirectory = path.join(desktopDirectory, 'build', 'openvpn-connect')
const maximumMsiBytes = 256 * 1024 * 1024

async function sha256(file) {
  return await new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(file)
    stream.on('error', reject)
    stream.on('data', chunk => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

function assertManifest(manifest) {
  if (
    !manifest ||
    typeof manifest !== 'object' ||
    typeof manifest.file_name !== 'string' ||
    !/^[A-Za-z0-9._-]+\.msi$/.test(manifest.file_name) ||
    typeof manifest.source_url !== 'string' ||
    !/^https:\/\/(packages|swupdate)\.openvpn\.net\//.test(manifest.source_url) ||
    typeof manifest.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(manifest.sha256)
  ) {
    throw new Error('OpenVPN Connect manifest is malformed')
  }
}

function downloadWithWindowsWebRequest(source, destination) {
  return new Promise((resolve, reject) => {
    // Windows respects the organisation's WinHTTP/proxy policy here. The URL
    // and output filename have already been constrained by assertManifest(),
    // so this does not turn the build hook into a command-input surface.
    execFile(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        '& { param([string]$Source, [string]$Destination) Invoke-WebRequest -Uri $Source -OutFile $Destination -MaximumRedirection 0 }',
        source,
        destination
      ],
      { timeout: 10 * 60 * 1000, windowsHide: true },
      error => (error ? reject(error) : resolve())
    )
  })
}

export async function stageOpenVpnConnect() {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  assertManifest(manifest)
  const destination = path.join(downloadDirectory, manifest.file_name)

  if (existsSync(destination) && (await sha256(destination)) === manifest.sha256) {
    console.log(`[openvpn-connect] using verified ${manifest.file_name}`)
    return destination
  }

  await mkdir(downloadDirectory, { recursive: true })
  const temporary = `${destination}.download`
  await rm(temporary, { force: true })
  const abort = new AbortController()
  const timeout = setTimeout(() => abort.abort(), 10 * 60 * 1000)

  try {
    try {
      const response = await fetch(manifest.source_url, { redirect: 'error', signal: abort.signal })
      const length = Number(response.headers.get('content-length'))
      if (!response.ok || !response.body || !Number.isFinite(length) || length <= 0 || length > maximumMsiBytes) {
        throw new Error(`OpenVPN Connect download was rejected (HTTP ${response.status})`)
      }
      await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary, { flags: 'wx' }))
    } catch (error) {
      await rm(temporary, { force: true })
      if (process.platform !== 'win32') {
        throw error
      }
      console.warn('[openvpn-connect] Node HTTPS failed; retrying through Windows network policy')
      await downloadWithWindowsWebRequest(manifest.source_url, temporary)
    }
    const actualHash = await sha256(temporary)
    if (actualHash !== manifest.sha256) {
      throw new Error('OpenVPN Connect MSI checksum does not match the reviewed manifest')
    }
    await rename(temporary, destination)
    console.log(`[openvpn-connect] staged verified ${manifest.file_name}`)
    return destination
  } finally {
    clearTimeout(timeout)
    await rm(temporary, { force: true })
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await stageOpenVpnConnect()
}
