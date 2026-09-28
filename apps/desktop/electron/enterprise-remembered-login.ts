import fs from 'node:fs'
import path from 'node:path'

interface Cipher {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}

/** Store only an OS-encrypted envelope; never fall back to plaintext. */
export function rememberedLogin(file: string, cipher: Cipher) {
  return {
    read(origin: string): { loginName: string; password: string } | null {
      try {
        if (!cipher.isEncryptionAvailable()) {return null}
        const saved = JSON.parse(cipher.decryptString(fs.readFileSync(file)))
        if (saved.origin !== origin || typeof saved.loginName !== 'string' || typeof saved.password !== 'string') {return null}
        return { loginName: saved.loginName, password: saved.password }
      } catch {return null}
    },
    save(origin: string, loginName: string, password: string) {
      if (!cipher.isEncryptionAvailable()) {throw new Error('OS credential encryption unavailable')}
      const encrypted = cipher.encryptString(JSON.stringify({ origin, loginName, password }))
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file + '.tmp', encrypted, { mode: 0o600 })
      fs.renameSync(file + '.tmp', file)
    },
    clear() {fs.rmSync(file, { force: true })}
  }
}

/** A normal password rotation must not leave the previously saved password behind. */
export function rememberPasswordRotation(vault: ReturnType<typeof rememberedLogin>, origin: string, intent: { loginName: string; password: string } | null): void {
  if (intent) {vault.save(origin, intent.loginName, intent.password)}
  else {vault.clear()}
}
