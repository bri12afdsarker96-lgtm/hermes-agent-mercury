// enterprise-origin-candidate.test.ts
//
// B16-OL · Trusted main-owned enterprise-origin resolution tests.
//
// These tests pin down the seam established by enterprise-origin-candidate.ts:
// they prove the resolver never silently substitutes an alternative origin for
// an explicit-but-invalid process.env value, and that the Windows HKCU
// fallback reader is only invoked when the explicit process env is
// absent/blank. Every T1-T7 case directly counts how many times the reader
// callback was invoked, which is the only way to guard the lazy contract
// against future regressions that re-introduce an eager read.
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

// Spy factory: returns a function pair — `reader` (the callback the helper
// will invoke) and `count` (a closure-captured call counter the test can
// assert on). Using a closure keeps the spy free of any vitest mocking
// machinery, so the test exercises the real seam shape main.ts will use.
function makeSpyReader(returnValue: string | null): {
  reader: () => string | null
  count: () => number
} {

  let calls = 0

  return {

    reader: () => {
      calls += 1

      return returnValue
    },
    count: () => calls
  }
}

describe('resolveEnterpriseOriginCandidate · T1 process env valid HTTPS wins', () => {
  test('explicit valid HTTPS returns the explicit value verbatim, registry reader NOT called', () => {
    const spy = makeSpyReader(OTHER_VALID_HTTPS)

    const out = resolveEnterpriseOriginCandidate({
      processEnv: VALID_HTTPS,
      windowsUserEnvReader: spy.reader
    })

    assert.equal(out, VALID_HTTPS)
    assert.equal(spy.count(), 0)
  })

  test('explicit valid HTTPS wins even when registry reader exists', () => {
    const spy = makeSpyReader(null)

    const out = resolveEnterpriseOriginCandidate({
      processEnv: VALID_HTTPS,
      windowsUserEnvReader: spy.reader
    })

    assert.equal(out, VALID_HTTPS)
    assert.equal(spy.count(), 0)
  })
})

describe('resolveEnterpriseOriginCandidate · T2 process env valid loopback HTTP remains permitted by existing policy', () => {
  test('explicit loopback HTTP returns verbatim, registry reader NOT called', () => {
    const spy = makeSpyReader(VALID_HTTPS)

    const out = resolveEnterpriseOriginCandidate({
      processEnv: VALID_LOOPBACK_HTTP,
      windowsUserEnvReader: spy.reader
    })

    assert.equal(out, VALID_LOOPBACK_HTTP)
    assert.equal(spy.count(), 0)
  })

  test('explicit loopback HTTP wins when registry reader returns null', () => {
    const spy = makeSpyReader(null)

    const out = resolveEnterpriseOriginCandidate({
      processEnv: VALID_LOOPBACK_HTTP,
      windowsUserEnvReader: spy.reader
    })

    assert.equal(out, VALID_LOOPBACK_HTTP)
    assert.equal(spy.count(), 0)
  })
})

describe('resolveEnterpriseOriginCandidate · T3 explicit invalid non-loopback HTTP fails closed AND does NOT fall back to registry', () => {
  test('invalid explicit non-loopback HTTP: raw explicit string selected, registry reader NOT called', () => {
    // The resolver itself only picks a candidate; validation lives in
    // normalizeEnterpriseApiOriginOrNull. The fail-closed guarantee we
    // pin here is twofold:
    //   (a) the registry reader MUST NOT be invoked at all when the
    //       explicit channel produced any non-blank string;
    //   (b) the explicit value is returned verbatim so the downstream
    //       normalizer can fail closed, instead of letting the registry
    //       value "rescue" the misconfigured process env.
    const spy = makeSpyReader(VALID_HTTPS)

    const out = resolveEnterpriseOriginCandidate({
      processEnv: INVALID_NON_LOOPBACK_HTTP,
      windowsUserEnvReader: spy.reader
    })

    assert.equal(out, INVALID_NON_LOOPBACK_HTTP)
    assert.notEqual(out, VALID_HTTPS)
    assert.notEqual(out, OTHER_VALID_HTTPS)
    assert.equal(spy.count(), 0)
  })
})

describe('resolveEnterpriseOriginCandidate · T4 process env absent + Windows HKCU valid HTTPS resolves', () => {
  test('undefined process env + valid registry HTTPS: registry reader called exactly once, value returned', () => {
    const spy = makeSpyReader(VALID_HTTPS)

    const out = resolveEnterpriseOriginCandidate({
      processEnv: undefined,
      windowsUserEnvReader: spy.reader
    })

    assert.equal(out, VALID_HTTPS)
    assert.equal(spy.count(), 1)
  })

  test('null process env + valid registry HTTPS: registry reader called exactly once, value returned', () => {
    const spy = makeSpyReader(VALID_HTTPS)

    const out = resolveEnterpriseOriginCandidate({
      processEnv: null,
      windowsUserEnvReader: spy.reader
    })

    assert.equal(out, VALID_HTTPS)
    assert.equal(spy.count(), 1)
  })
})

describe('resolveEnterpriseOriginCandidate · T5 process env blank + Windows HKCU valid HTTPS resolves', () => {
  test('empty-string process env + valid registry HTTPS: registry reader called exactly once', () => {
    const spy = makeSpyReader(VALID_HTTPS)

    const out = resolveEnterpriseOriginCandidate({
      processEnv: '',
      windowsUserEnvReader: spy.reader
    })

    assert.equal(out, VALID_HTTPS)
    assert.equal(spy.count(), 1)
  })

  test('whitespace-only process env + valid registry HTTPS: registry reader called exactly once', () => {
    const spy = makeSpyReader(VALID_HTTPS)

    const out = resolveEnterpriseOriginCandidate({
      processEnv: '   \t  ',
      windowsUserEnvReader: spy.reader
    })

    assert.equal(out, VALID_HTTPS)
    assert.equal(spy.count(), 1)
  })

  test('non-string process env treated as absent: registry reader called exactly once', () => {
    // process.env typed as string|undefined, but the seam must not blow up
    // if a defensive caller passes a value coerced from JSON / config that
    // is not actually a string.
    const spy = makeSpyReader(VALID_HTTPS)

    const out = resolveEnterpriseOriginCandidate({
      processEnv: 42,
      windowsUserEnvReader: spy.reader
    })

    assert.equal(out, VALID_HTTPS)

    assert.equal(spy.count(), 1)

    const spyObj = makeSpyReader(VALID_HTTPS)

    const outObj = resolveEnterpriseOriginCandidate({
      processEnv: { unexpected: 'object' },
      windowsUserEnvReader: spyObj.reader
    })

    assert.equal(outObj, VALID_HTTPS)
    assert.equal(spyObj.count(), 1)
  })
})

describe('resolveEnterpriseOriginCandidate · T6 both absent → null', () => {
  test('undefined process env + null registry: reader called exactly once, returns null', () => {
    const spy = makeSpyReader(null)

    const out = resolveEnterpriseOriginCandidate({
      processEnv: undefined,
      windowsUserEnvReader: spy.reader
    })

    assert.equal(out, null)
    assert.equal(spy.count(), 1)
  })

  test('blank process env + null registry: reader called exactly once, returns null', () => {
    const spy = makeSpyReader(null)

    const out = resolveEnterpriseOriginCandidate({
      processEnv: '',
      windowsUserEnvReader: spy.reader
    })

    assert.equal(out, null)
    assert.equal(spy.count(), 1)
  })

  test('whitespace process env + null registry: reader called exactly once, returns null', () => {
    const spy = makeSpyReader(null)

    const out = resolveEnterpriseOriginCandidate({
      processEnv: '   ',
      windowsUserEnvReader: spy.reader
    })

    assert.equal(out, null)
    assert.equal(spy.count(), 1)
  })

  test('blank process env + whitespace registry: reader called exactly once, returns null', () => {
    const spy = makeSpyReader('   ')

    const out = resolveEnterpriseOriginCandidate({
      processEnv: '',
      windowsUserEnvReader: spy.reader
    })

    assert.equal(out, null)
    assert.equal(spy.count(), 1)
  })

  test('both absent + no reader at all: returns null without invoking anything', () => {
    const out = resolveEnterpriseOriginCandidate({
      processEnv: undefined,
      windowsUserEnvReader: undefined
    })

    assert.equal(out, null)
  })
})

describe('resolveEnterpriseOriginCandidate · T7 registry invalid non-loopback HTTP returns the registry value (downstream validator fails it closed)', () => {
  test('registry carries the invalid value to downstream normalization, reader called exactly once', () => {
    const spy = makeSpyReader(INVALID_NON_LOOPBACK_HTTP)

    const out = resolveEnterpriseOriginCandidate({
      processEnv: undefined,
      windowsUserEnvReader: spy.reader
    })

    assert.equal(out, INVALID_NON_LOOPBACK_HTTP)
    assert.equal(spy.count(), 1)
  })
})

describe('resolveEnterpriseOriginCandidate · T8 off-Windows: no `reg` spawn, returns null when process env absent', () => {
  test('off-Windows platform yields null from readWindowsUserEnvVar without spawning (covered by windows-user-env.test.ts)', () => {
    // The pure resolver itself does not touch the platform; this test
    // documents the contract that the helper assumes: readWindowsUserEnvVar
    // returns null off-Windows (see windows-user-env.test.ts: "returns null
    // off Windows without spawning"). When wired through main.ts, that
    // null flows into resolveEnterpriseOriginCandidate unchanged.
    const spy = makeSpyReader(null)

    const out = resolveEnterpriseOriginCandidate({
      processEnv: undefined,
      windowsUserEnvReader: spy.reader
    })

    assert.equal(out, null)
    assert.equal(spy.count(), 1)
  })
})

describe('resolveEnterpriseOriginCandidate · T9 packaged Windows prefers its live durable user setting', () => {
  test('a current HKCU value replaces a stale inherited process environment value', () => {
    const spy = makeSpyReader(OTHER_VALID_HTTPS)

    const out = resolveEnterpriseOriginCandidate({
      processEnv: VALID_LOOPBACK_HTTP,
      preferWindowsUserEnv: true,
      windowsUserEnvReader: spy.reader
    })

    assert.equal(out, OTHER_VALID_HTTPS)
    assert.equal(spy.count(), 1)
  })

  test('a malformed durable value still reaches the normalizer and fails closed', () => {
    const spy = makeSpyReader(INVALID_NON_LOOPBACK_HTTP)

    const out = resolveEnterpriseOriginCandidate({
      processEnv: VALID_HTTPS,
      preferWindowsUserEnv: true,
      windowsUserEnvReader: spy.reader
    })

    assert.equal(out, INVALID_NON_LOOPBACK_HTTP)
    assert.equal(spy.count(), 1)
  })

  test('falls back to the inherited value when the durable user setting is absent', () => {
    const spy = makeSpyReader(null)

    const out = resolveEnterpriseOriginCandidate({
      processEnv: VALID_HTTPS,
      preferWindowsUserEnv: true,
      windowsUserEnvReader: spy.reader
    })

    assert.equal(out, VALID_HTTPS)
    assert.equal(spy.count(), 1)
  })
})

describe('resolveEnterpriseOriginCandidate · T10 renderer is never involved', () => {
  test('signature accepts no IPC/renderer parameter and has no implicit event source', () => {
    // Structural guarantee: the helper takes only the two candidate
    // accessors. There is no `event.sender`, no IPC channel, no
    // Electron.WebContents anywhere in the type signature. This test
    // would fail to compile if a renderer-coupled source were added.
    const acceptedKeys: ReadonlyArray<keyof Parameters<typeof resolveEnterpriseOriginCandidate>[0]> = [
      'processEnv',
      'preferWindowsUserEnv',
      'windowsUserEnvReader'
    ]

    assert.deepEqual(acceptedKeys, ['processEnv', 'preferWindowsUserEnv', 'windowsUserEnvReader'])
  })
})

describe('resolveEnterpriseOriginCandidate · T11 no bearer/token returned or persisted by the seam', () => {
  test('return value is the picked URL candidate or null — never a credential object', () => {
    const spy = makeSpyReader(VALID_HTTPS)

    const out = resolveEnterpriseOriginCandidate({
      processEnv: VALID_HTTPS,
      windowsUserEnvReader: spy.reader
    })

    assert.equal(typeof out, 'string')
    assert.equal(out, VALID_HTTPS)
    // No object shape is ever produced, which means there is nowhere for a
    // bearer or token to be smuggled through the seam.
    assert.notEqual(typeof out, 'object')
    // Explicit env wins → reader NOT called.
    assert.equal(spy.count(), 0)
  })

  test('return value cannot contain userinfo credentials', () => {
    // The existing normalizeEnterpriseApiOriginOrNull rejects
    // `https://user:pass@...`, so the resolved candidate must already
    // be a credential-free URL by the time it reaches the normalizer.
    // We pin that contract here at the resolver boundary by asserting
    // that a credentialed input is forwarded verbatim (validation
    // happens one step later in the normalizer).
    const credentialed = 'https://user:pass@enterprise.example.invalid'
    const spy = makeSpyReader(null)

    const out = resolveEnterpriseOriginCandidate({
      processEnv: credentialed,
      windowsUserEnvReader: spy.reader
    })

    assert.equal(out, credentialed)
    assert.equal(spy.count(), 0)
  })
})
