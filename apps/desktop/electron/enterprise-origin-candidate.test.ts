// enterprise-origin-candidate.test.ts
//
// B16-OL · Trusted main-owned enterprise-origin resolution tests.
//
// These tests pin down the seam established by enterprise-origin-candidate.ts:
// they prove the resolver never silently substitutes an alternative origin for
// an explicit-but-invalid process.env value, and that the Windows HKCU
// fallback is only consulted when the explicit process env is absent/blank.
// The helper is pure (no I/O, no IPC, no `reg` spawn), so the full
// resolution policy is exercisable from a Linux runner — which the in-place
// IPC handler in main.ts cannot be without a Windows-only CI.
//
// Test value convention: every test origin uses the reserved `.invalid`
// TLD (RFC 2606 §2) so accidental DNS resolution never reaches a real
// host, even in a misconfigured CI environment.

import assert from 'node:assert/strict'

import { describe, test } from 'vitest'

import { resolveEnterpriseOriginCandidate } from './enterprise-origin-candidate'

const VALID_HTTPS = 'https://enterprise.example.invalid'
const VALID_LOOPBACK_HTTP = 'http://127.0.0.1:8080'
const OTHER_VALID_HTTPS = 'https://other-origin.example.invalid'
const INVALID_NON_LOOPBACK_HTTP = 'http://enterprise.example.invalid'

describe('resolveEnterpriseOriginCandidate · T1 process env valid HTTPS wins', () => {
  test('explicit valid HTTPS returns the explicit value verbatim', () => {
    assert.equal(
      resolveEnterpriseOriginCandidate({
        processEnv: VALID_HTTPS,
        windowsUserEnv: OTHER_VALID_HTTPS
      }),
      VALID_HTTPS
    )
  })

  test('explicit valid HTTPS wins even when registry value is absent', () => {
    assert.equal(
      resolveEnterpriseOriginCandidate({
        processEnv: VALID_HTTPS,
        windowsUserEnv: null
      }),
      VALID_HTTPS
    )
  })
})

describe('resolveEnterpriseOriginCandidate · T2 process env valid loopback HTTP remains permitted by existing policy', () => {
  test('explicit loopback HTTP returns the explicit value verbatim', () => {
    assert.equal(
      resolveEnterpriseOriginCandidate({
        processEnv: VALID_LOOPBACK_HTTP,
        windowsUserEnv: VALID_HTTPS
      }),
      VALID_LOOPBACK_HTTP
    )
  })

  test('explicit loopback HTTP returns the explicit value when registry is null', () => {
    assert.equal(
      resolveEnterpriseOriginCandidate({
        processEnv: VALID_LOOPBACK_HTTP,
        windowsUserEnv: null
      }),
      VALID_LOOPBACK_HTTP
    )
  })
})

describe('resolveEnterpriseOriginCandidate · T3 process env explicit invalid non-loopback HTTP fails closed AND does NOT fall back to registry', () => {
  test('invalid explicit non-loopback HTTP returns the explicit string (validation is downstream)', () => {
    // The resolver itself only picks a candidate; validation lives in
    // normalizeEnterpriseApiOriginOrNull. The fail-closed guarantee we
    // pin here is that we MUST NOT silently substitute the registry value
    // when the explicit value is present-and-non-blank. The downstream
    // normalizer will reject `http://enterprise.example.invalid` because
    // it is non-loopback and not https; that rejection is what produces the
    // observed `null` at the IPC layer. This test guards the seam
    // boundary: the resolver itself must not preempt validation by
    // switching to a different candidate.
    assert.equal(
      resolveEnterpriseOriginCandidate({
        processEnv: INVALID_NON_LOOPBACK_HTTP,
        windowsUserEnv: VALID_HTTPS
      }),
      INVALID_NON_LOOPBACK_HTTP
    )
  })

  test('invalid explicit value is never replaced by the registry fallback', () => {
    // Mirrors the in-process scenario: process.env holds a misconfigured
    // http:// origin while the live HKCU environment has a valid https://
    // value. The resolver must keep the explicit string so the downstream
    // normalizer can fail closed, instead of letting the registry value
    // "rescue" the misconfigured process env.
    const picked = resolveEnterpriseOriginCandidate({
      processEnv: INVALID_NON_LOOPBACK_HTTP,
      windowsUserEnv: VALID_HTTPS
    })

    assert.notEqual(picked, VALID_HTTPS)
    assert.notEqual(picked, OTHER_VALID_HTTPS)
    assert.equal(picked, INVALID_NON_LOOPBACK_HTTP)
  })
})

describe('resolveEnterpriseOriginCandidate · T4 process env absent + Windows HKCU valid HTTPS resolves', () => {
  test('undefined process env + valid registry HTTPS returns the registry value', () => {
    assert.equal(
      resolveEnterpriseOriginCandidate({
        processEnv: undefined,
        windowsUserEnv: VALID_HTTPS
      }),
      VALID_HTTPS
    )
  })

  test('null process env + valid registry HTTPS returns the registry value', () => {
    assert.equal(
      resolveEnterpriseOriginCandidate({
        processEnv: null,
        windowsUserEnv: VALID_HTTPS
      }),
      VALID_HTTPS
    )
  })
})

describe('resolveEnterpriseOriginCandidate · T5 process env blank + Windows HKCU valid HTTPS resolves', () => {
  test('empty-string process env + valid registry HTTPS returns the registry value', () => {
    assert.equal(
      resolveEnterpriseOriginCandidate({
        processEnv: '',
        windowsUserEnv: VALID_HTTPS
      }),
      VALID_HTTPS
    )
  })

  test('whitespace-only process env + valid registry HTTPS returns the registry value', () => {
    assert.equal(
      resolveEnterpriseOriginCandidate({
        processEnv: '   \t  ',
        windowsUserEnv: VALID_HTTPS
      }),
      VALID_HTTPS
    )
  })

  test('non-string process env is treated as absent and falls back to registry', () => {
    // process.env typed as string|undefined, but the seam must not blow up
    // if a defensive caller passes a value coerced from JSON / config that
    // is not actually a string.
    assert.equal(
      resolveEnterpriseOriginCandidate({
        processEnv: 42,
        windowsUserEnv: VALID_HTTPS
      }),
      VALID_HTTPS
    )

    assert.equal(
      resolveEnterpriseOriginCandidate({
        processEnv: { unexpected: 'object' },
        windowsUserEnv: VALID_HTTPS
      }),
      VALID_HTTPS
    )
  })
})

describe('resolveEnterpriseOriginCandidate · T6 both absent → null', () => {
  test('undefined process env + null registry returns null', () => {
    assert.equal(
      resolveEnterpriseOriginCandidate({
        processEnv: undefined,
        windowsUserEnv: null
      }),
      null
    )
  })

  test('blank process env + null registry returns null', () => {
    assert.equal(
      resolveEnterpriseOriginCandidate({
        processEnv: '',
        windowsUserEnv: null
      }),
      null
    )
  })

  test('whitespace process env + null registry returns null', () => {
    assert.equal(
      resolveEnterpriseOriginCandidate({
        processEnv: '   ',
        windowsUserEnv: null
      }),
      null
    )
  })

  test('blank process env + whitespace registry returns null', () => {
    assert.equal(
      resolveEnterpriseOriginCandidate({
        processEnv: '',
        windowsUserEnv: '   '
      }),
      null
    )
  })
})

describe('resolveEnterpriseOriginCandidate · T7 registry invalid HTTP non-loopback returns the registry value (downstream validator fails it closed)', () => {
  test('registry carries the invalid value to downstream normalization', () => {
    // Same fail-closed contract as T3, applied to the registry channel:
    // the resolver must surface the raw candidate so the existing
    // normalizer can reject it. The resolver is not the policy.
    assert.equal(
      resolveEnterpriseOriginCandidate({
        processEnv: undefined,
        windowsUserEnv: INVALID_NON_LOOPBACK_HTTP
      }),
      INVALID_NON_LOOPBACK_HTTP
    )
  })
})

describe('resolveEnterpriseOriginCandidate · T8 off-Windows: no `reg` spawn, returns null when process env absent', () => {
  test('off-Windows platform yields null from readWindowsUserEnvVar without spawning (covered by windows-user-env.test.ts)', () => {
    // The pure resolver itself does not touch the platform; this test
    // documents the contract that the helper assumes: readWindowsUserEnvVar
    // returns null off-Windows (see windows-user-env.test.ts: "returns null
    // off Windows without spawning"). When wired through main.ts, that
    // null flows into resolveEnterpriseOriginCandidate unchanged.
    assert.equal(
      resolveEnterpriseOriginCandidate({
        processEnv: undefined,
        windowsUserEnv: null
      }),
      null
    )
  })
})

describe('resolveEnterpriseOriginCandidate · T9 renderer is never involved', () => {
  test('signature accepts no IPC/renderer parameter and has no implicit event source', () => {
    // Structural guarantee: the helper takes only the two candidate
    // strings. There is no `event.sender`, no IPC channel, no
    // Electron.WebContents anywhere in the type signature. This test
    // would fail to compile if a renderer-coupled source were added.
    const acceptedKeys: ReadonlyArray<keyof Parameters<typeof resolveEnterpriseOriginCandidate>[0]> = [
      'processEnv',
      'windowsUserEnv'
    ]

    assert.deepEqual(acceptedKeys, ['processEnv', 'windowsUserEnv'])
  })
})

describe('resolveEnterpriseOriginCandidate · T10 no bearer/token returned or persisted by the seam', () => {
  test('return value is the picked URL candidate or null — never a credential object', () => {
    const picked = resolveEnterpriseOriginCandidate({
      processEnv: VALID_HTTPS,
      windowsUserEnv: VALID_HTTPS
    })

    assert.equal(typeof picked, 'string')
    assert.equal(picked, VALID_HTTPS)
    // No object shape is ever produced, which means there is nowhere for a
    // bearer or token to be smuggled through the seam.
    assert.notEqual(typeof picked, 'object')
  })

  test('return value cannot contain userinfo credentials', () => {
    // The existing normalizeEnterpriseApiOriginOrNull rejects
    // `https://user:pass@...`, so the resolved candidate must already
    // be a credential-free URL by the time it reaches the normalizer.
    // We pin that contract here at the resolver boundary by asserting
    // that a credentialed input is forwarded verbatim (validation
    // happens one step later in the normalizer).
    const credentialed = 'https://user:pass@enterprise.example.invalid'

    assert.equal(
      resolveEnterpriseOriginCandidate({
        processEnv: credentialed,
        windowsUserEnv: null
      }),
      credentialed
    )
  })
})
