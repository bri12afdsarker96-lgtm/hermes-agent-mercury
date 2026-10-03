import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { extractFile, statFile } from '@electron/asar'
import { load as parse } from 'js-yaml'

const root = path.resolve(import.meta.dirname, '..')
const sourcePackage = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const release = path.join(root, 'release', sourcePackage.version)
const asar = path.join(release, 'win-unpacked', 'resources', 'app.asar')
const bundledPackage = JSON.parse(extractFile(asar, 'package.json').toString())
assert.equal(bundledPackage.version, sourcePackage.version, 'Packaged version differs from source')
const metadata = parse(readFileSync(path.join(release, 'latest.yml'), 'utf8'))
assert.equal(metadata.version, sourcePackage.version, 'Updater version differs from package')
const executable = `Hermes-企业助手-${sourcePackage.version}-x64.exe`
assert.equal(metadata.path, executable)
const bytes = readFileSync(path.join(release, executable))
const hash = (value, algorithm = 'sha256', encoding = 'hex') => createHash(algorithm).update(value).digest(encoding)
assert.equal(metadata.sha512, hash(bytes, 'sha512', 'base64'), 'Installer checksum mismatch')
assert.equal(metadata.files[0].sha512, metadata.sha512)
assert.equal(metadata.files[0].size, bytes.length)
assert.ok(existsSync(path.join(release, `${executable}.blockmap`)), 'Missing differential update blockmap')
const html = extractFile(asar, 'dist/index.html').toString()
const assets = [...html.matchAll(/(?:src|href)="\.\/(assets\/[^\"]+\.(?:js|css))"/g)].map(match => `dist/${match[1]}`)
assert.ok(assets.length > 0, 'No renderer entry assets found')
const compared = ['dist/index.html', 'dist/electron-main.mjs', 'dist/electron-preload.js', ...assets].map(file => {
  const packaged = extractFile(asar, path.normalize(file))
  assert.equal(hash(packaged), hash(readFileSync(path.join(root, file))), `Stale package content: ${file}`)
  return { file, sha256: hash(packaged) }
})
const sevenZip = process.argv[2]
if (sevenZip) {
  let archive = path.join(release, executable)
  let temporary
  const embedded = file => {
    const result = spawnSync(sevenZip, ['e', archive, file, '-so', '-bd'], { maxBuffer: 64 * 1024 * 1024 })
    assert.equal(result.status, 0, `Cannot inspect installer payload ${file}`)
    return result.stdout
  }
  try {
    // Current electron-builder puts the application inside app-64.7z; older
    // layouts exposed resources directly. Verify either layout, never accept an
    // empty extraction as proof that a payload matched.
    if (!embedded('resources/app.asar').length) {
      const prefix = path.join(tmpdir(), 'hermes-installer-verify-')
      temporary = mkdtempSync(prefix)
      assert.ok(path.resolve(temporary).startsWith(path.resolve(prefix)))
      const result = spawnSync(sevenZip, ['e', archive, 'app-64.7z', '-r', `-o${temporary}`, '-y', '-bd'], {
        encoding: 'utf8'
      })
      assert.equal(result.status, 0, 'Cannot unpack the embedded application archive')
      archive = path.join(temporary, 'app-64.7z')
      assert.ok(existsSync(archive), 'Missing embedded application archive')
    }
    assert.equal(hash(embedded('resources/app.asar')), hash(readFileSync(asar)), 'NSIS embeds a different ASAR')
    for (const { file, sha256 } of compared) {
      if (statFile(asar, path.normalize(file)).unpacked) {
        assert.equal(
          hash(embedded(`resources/app.asar.unpacked/${file}`)),
          sha256,
          `NSIS embeds stale resource ${file}`
        )
      }
    }
  } finally {
    if (temporary) rmSync(temporary, { recursive: true, force: true })
  }
}
console.log(
  JSON.stringify(
    {
      version: metadata.version,
      installer: executable,
      size: bytes.length,
      sha256: hash(bytes),
      sha512: metadata.sha512,
      asarSha256: hash(readFileSync(asar)),
      nsisPayloadVerified: Boolean(sevenZip),
      compared
    },
    null,
    2
  )
)
