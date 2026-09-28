import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { expect, it } from 'vitest'
import { rememberedLogin, rememberPasswordRotation } from './enterprise-remembered-login'

it('persists an encrypted, origin-bound login, replaces it and forgets it', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'hermes-login-'))
  const file = path.join(dir, 'login.enc')
  const key = randomBytes(32)
  const cipher = {
    isEncryptionAvailable: () => true,
    encryptString(value: string) {
      const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', key, iv)
      const encrypted = Buffer.concat([c.update(value, 'utf8'), c.final()])
      return Buffer.concat([iv, c.getAuthTag(), encrypted])
    },
    decryptString(value: Buffer) {
      const c = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12))
      c.setAuthTag(value.subarray(12, 28))
      return Buffer.concat([c.update(value.subarray(28)), c.final()]).toString('utf8')
    }
  }
  try {
    const vault = rememberedLogin(file, cipher)
    vault.save('https://enterprise.test', 'employee', 'secret-test-password')
    expect(readFileSync(file).includes(Buffer.from('secret-test-password'))).toBe(false)
    expect(vault.read('https://another.test')).toBeNull()
    expect(rememberedLogin(file, cipher).read('https://enterprise.test')?.password).toBe('secret-test-password')
    vault.save('https://enterprise.test', 'employee', 'replacement-password')
    expect(vault.read('https://enterprise.test')?.password).toBe('replacement-password')
    rememberPasswordRotation(vault, 'https://enterprise.test', null)
    expect(rememberedLogin(file, cipher).read('https://enterprise.test')).toBeNull()
    rememberPasswordRotation(vault, 'https://enterprise.test', { loginName: 'employee', password: 'rotated-first-login-password' })
    expect(rememberedLogin(file, cipher).read('https://enterprise.test')?.password).toBe('rotated-first-login-password')
    expect(readFileSync(file).includes(Buffer.from('rotated-first-login-password'))).toBe(false)
    vault.clear()
    expect(existsSync(file)).toBe(false)
    expect(vault.read('https://enterprise.test')).toBeNull()
    expect(() => rememberedLogin(file, { ...cipher, isEncryptionAvailable: () => false }).save('https://enterprise.test', 'employee', 'password')).toThrow()
    expect(existsSync(file)).toBe(false)
  } finally {rmSync(dir, { recursive: true, force: true })}
})
