import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { canonicalTextProofPayload, createEnterpriseTextAuthority } from './enterprise-local-text'

const PYTHON = process.env.HERMES_TEST_PYTHON?.trim() || (process.platform === 'win32' ? 'python' : 'python3')
const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const BACKEND = { kind: 'python', shell: false, args: ['-m', 'hermes_cli.main', 'serve'] }
const CONNECTION = { baseUrl: 'http://127.0.0.1:19001', token: 'synthetic-local-session' }
const CHANNEL = 'a'.repeat(32)
const OPERATION = 'rpc:enterprise_text.submit'

function subject(clock = Date.now) {
  const lifecycle = { current: true }
  const authority = createEnterpriseTextAuthority(BACKEND, () => lifecycle.current, clock)

  if (!authority) {throw new Error('DIRECT_PYTHON_AUTHORITY_UNAVAILABLE')}

  return { authority, lifecycle }
}

function differentHex(value: string): string {
  return `${value[0] === '0' ? '1' : '0'}${value.slice(1)}`
}

describe('owned text main proof canonical payload', () => {
  it('orders numeric ASCII keys lexically rather than using JS enumeration order', () => {
    expect(canonicalTextProofPayload({ '2': 2, '10': 10, '01': 1, z: { b: false, a: null }, A: true }))
      .toBe('{"01":1,"10":10,"2":2,"A":true,"z":{"a":null,"b":false}}')
  })

  it('preserves Chinese, quotes, controls, arrays and safe integer boundaries', () => {
    const value = { text: '中文摘要😀 "quote" \\ slash\n\r\t\b\f\u0000\u001f',
      array: [null, true, false, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, -0] }

    const canonical = canonicalTextProofPayload(value)
    expect(JSON.parse(canonical)).toEqual({ ...value, array: [...value.array.slice(0, -1), 0] })
    expect(canonical.includes('中文摘要😀')).toBe(true)
    expect(canonical.includes('\\u0000')).toBe(true)
  })

  const invalid: Array<{ label: string; value: unknown }> = [
    { label: 'root undefined', value: undefined },
    { label: 'object undefined', value: { value: undefined } },
    { label: 'array undefined', value: [undefined] },
    { label: 'positive float', value: { value: 0.25 } },
    { label: 'negative float', value: [-0.75] },
    { label: 'NaN', value: NaN },
    { label: 'infinity', value: Infinity },
    { label: 'unsafe integer', value: Number.MAX_SAFE_INTEGER + 1 },
    { label: 'unpaired high surrogate', value: '\ud800' },
    { label: 'unpaired low surrogate', value: { value: '\udc00' } },
    { label: 'non ASCII key', value: { 中文: 'value' } },
    { label: 'punctuated key', value: { 'not-a-key': 'value' } },
    { label: 'non plain object', value: new Date(0) },
    { label: 'null prototype object', value: Object.create(null) },
    { label: 'oversize UTF8', value: '文'.repeat(90_000) }
  ]

  for (const { label, value } of invalid) {
    it(`rejects ${label} before signing`, () => {
      expect(() => canonicalTextProofPayload(value)).toThrow('LOCAL_TEXT_REQUEST_INVALID')
    })
  }

  it('rejects absent array elements rather than creating non JSON canonical bytes', () => {
    const sparse: unknown[] = new Array(2)
    sparse[1] = 'synthetic'
    expect(() => canonicalTextProofPayload(sparse)).toThrow('LOCAL_TEXT_REQUEST_INVALID')
  })

  it('rejects excessive nesting', () => {
    let value: unknown = null

    for (let depth = 0; depth < 18; depth += 1) {value = [value]}
    expect(() => canonicalTextProofPayload(value)).toThrow('LOCAL_TEXT_REQUEST_INVALID')
  })
})

describe('owned text signer admission and lifecycle', () => {
  const invalid = [
    { label: 'command runner', backend: { kind: 'command', shell: false, args: BACKEND.args } },
    { label: 'cmd shell runner', backend: { kind: 'command', shell: true, args: ['/c', 'hermes'] } },
    { label: 'Python shell wrapper', backend: { ...BACKEND, shell: true } },
    { label: 'missing explicit shell false', backend: { kind: 'python', args: BACKEND.args } },
    { label: 'Python code runner', backend: { ...BACKEND, args: ['-c', 'synthetic'] } },
    { label: 'other Python module', backend: { ...BACKEND, args: ['-m', 'another_module'] } },
    { label: 'missing module runner', backend: { ...BACKEND, args: [] } }
  ]

  for (const { label, backend } of invalid) {
    it(`does not create authority for ${label}`, () => {
      expect(createEnterpriseTextAuthority(backend, () => true)).toBeNull()
    })
  }

  it('requires binding and rejects rebinding, supersession and changed endpoint credentials', () => {
    const { authority, lifecycle } = subject()
    expect(() => authority.prove(CONNECTION, OPERATION, {}, CHANNEL)).toThrow('LOCAL_TEXT_RUNTIME_UNAVAILABLE')
    authority.bind(CONNECTION)
    expect(() => authority.bind(CONNECTION)).toThrow('LOCAL_TEXT_RUNTIME_UNAVAILABLE')
    expect(() => authority.prove({ ...CONNECTION, baseUrl: 'http://127.0.0.1:19002' }, OPERATION, {}, CHANNEL))
      .toThrow('LOCAL_TEXT_RUNTIME_UNAVAILABLE')
    expect(() => authority.prove({ ...CONNECTION, token: 'different-synthetic-token' }, OPERATION, {}, CHANNEL))
      .toThrow('LOCAL_TEXT_RUNTIME_UNAVAILABLE')
    const runtime = authority.bootstrapEnv().HERMES_ENTERPRISE_TEXT_RUNTIME_ID
    expect(() => authority.prove(CONNECTION, OPERATION, {}, CHANNEL, differentHex(runtime)))
      .toThrow('LOCAL_TEXT_RUNTIME_UNAVAILABLE')
    expect(() => authority.prove(CONNECTION, OPERATION, {}, 'renderer-channel'))
      .toThrow('LOCAL_TEXT_RUNTIME_UNAVAILABLE')
    lifecycle.current = false
    expect(() => authority.prove(CONNECTION, OPERATION, {}, CHANNEL)).toThrow('LOCAL_TEXT_RUNTIME_UNAVAILABLE')
    const stale = subject()
    stale.lifecycle.current = false
    expect(() => stale.authority.bind(CONNECTION)).toThrow('LOCAL_TEXT_RUNTIME_UNAVAILABLE')
  })

  it('retains secrets in closures rather than public JSON and generates distinct runtime authority', () => {
    const { authority } = subject()
    authority.bind(CONNECTION)
    const bootstrap = authority.bootstrapEnv()
    const proof = authority.prove(CONNECTION, OPERATION, {}, CHANNEL)
    const encoded = JSON.stringify(authority)
    // Boolean assertions keep a regression from printing a key or full proof.
    expect(encoded.includes(bootstrap.HERMES_ENTERPRISE_TEXT_BOOTSTRAP_KEY)).toBe(false)
    expect(encoded.includes(proof)).toBe(false)
    expect(encoded.includes('HERMES_ENTERPRISE_TEXT_BOOTSTRAP_KEY')).toBe(false)
    const other = subject().authority.bootstrapEnv()
    expect(other.HERMES_ENTERPRISE_TEXT_BOOTSTRAP_KEY === bootstrap.HERMES_ENTERPRISE_TEXT_BOOTSTRAP_KEY).toBe(false)
    expect(other.HERMES_ENTERPRISE_TEXT_RUNTIME_ID === bootstrap.HERMES_ENTERPRISE_TEXT_RUNTIME_ID).toBe(false)
  })
})

it('uses the actual Node signer against one bootstrap-captured Python verifier process', () => {
  // Whole seconds make the exact TTL boundary independent of float rounding.
  const now = Math.floor(Date.now() / 1000) * 1000
  let issued = now
  const { authority } = subject(() => issued)
  authority.bind(CONNECTION)
  const bootstrap = authority.bootstrapEnv()
  const records: Array<{ payload: unknown; proof: unknown }> = []
  const plans: Array<[string, string, number, number]> = []
  const labels: string[] = []

  function add(label: string, payload: unknown, proof: unknown, accepted: boolean,
    operation = OPERATION, channel = CHANNEL, parallel = false) {
    labels.push(label)
    records.push({ payload, proof })
    plans.push([operation, channel, Number(accepted), Number(parallel)])
  }

  const sign = (payload: unknown, operation = OPERATION, channel = CHANNEL) =>
    authority.prove(CONNECTION, operation, payload, channel)

  const vectors = [
    { '2': 'two', '10': 'ten', '01': 'one', ASCII_key: { z: 1, A: true } },
    { text: '中文摘要😀 "quote" \\ slash\n\r\t\b\f\u0000\u001f' },
    { array: [null, true, false, 0, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, { nested: ['文', -1] }] }
  ]

  vectors.forEach((payload, index) => add(`canonical vector ${index}`, payload, sign(payload), true))

  const payload = { profile: `enterprise-text-${'b'.repeat(32)}`, owner: 'c'.repeat(64), owner_scope: 'd'.repeat(64),
    registration_id: 'e'.repeat(32), generation: 7, conversation_id: 'conversation', prompt_hash: 'f'.repeat(64),
    session_id: 'enterprise-text-runtime-fixture', request_id: 'request', instructions: 'synthetic instructions', input: '合成正文' }

  for (const field of Object.keys(payload)) {
    const proof = sign(payload)
    const changed = { ...payload, [field]: field === 'generation' ? 8 : `changed_${field}` }
    add(`bound field ${field}`, changed, proof, false)
    add(`rejected mutation does not consume nonce ${field}`, payload, proof, true)
  }

  add('added field', { ...payload, extra: 'injected' }, sign(payload), false)
  const missing = { ...payload } as Partial<typeof payload>
  delete missing.input
  add('removed field', missing, sign(payload), false)
  add('wrong operation', payload, sign(payload), false, 'rpc:session.create')
  add('wrong socket', payload, sign(payload), false, OPERATION, '1'.repeat(32))
  const runtimeParts = sign(payload).split('.')
  runtimeParts[1] = differentHex(runtimeParts[1])
  add('old or different runtime', payload, runtimeParts.join('.'), false)
  const macParts = sign(payload).split('.')
  macParts[5] = differentHex(macParts[5])
  add('wrong MAC', payload, macParts.join('.'), false)
  add('missing proof', payload, null, false)
  add('malformed proof', payload, 'v1.incomplete', false)
  add('strict Python float', { value: 0.25 }, sign({ value: 1 }), false)
  add('strict Python surrogate', { value: '\ud800' }, sign({ value: 'synthetic' }), false)

  for (const [offset, accepted] of [[-29999, true], [-30000, false], [2000, true], [2001, false]] as const) {
    issued = now + offset
    add(`TTL offset ${offset}`, payload, sign(payload), accepted)
  }

  issued = now
  const repeated = sign(payload)
  add('first nonce consumption', payload, repeated, true)
  add('nonce replay', payload, repeated, false)
  add('atomic concurrent nonce consumption', payload, sign(payload), true, OPERATION, CHANNEL, true)

  const httpPayload = { method: 'POST', path: '/api/providers/siwc/logout',
    query: { profile: payload.profile }, owner: payload.owner, body: null }

  add('HTTP channel', httpPayload, sign(httpPayload, 'http:POST', 'http'), true, 'http:POST', 'http')
  add('HTTP owner binding', { ...httpPayload, owner: 'changed' }, sign(httpPayload, 'http:POST', 'http'), false, 'http:POST', 'http')
  add('HTTP query binding', { ...httpPayload, query: { profile: 'changed' } }, sign(httpPayload, 'http:POST', 'http'), false, 'http:POST', 'http')

  // Only payload/proof records travel over stdin. The one private test key is
  // supplied by this actual child env, never by a file, argv or logged value.
  const script = `import hermes_bootstrap
import json, os, sys
from concurrent.futures import ThreadPoolExecutor
from hermes_cli import enterprise_text as subject
def run():
    expected_executable = ${JSON.stringify(path.isAbsolute(PYTHON) ? PYTHON : '')}
    if expected_executable and os.path.normcase(os.path.realpath(sys.executable)) != os.path.normcase(os.path.realpath(expected_executable)):
        raise RuntimeError('PYTHON_EXECUTABLE_MISMATCH')
    names = ('HERMES_ENTERPRISE_TEXT_BOOTSTRAP_KEY', 'HERMES_ENTERPRISE_TEXT_RUNTIME_ID')
    if any(name in os.environ for name in names):
        raise RuntimeError('BOOTSTRAP_ENV_NOT_REMOVED')
    if any(name in sys.modules for name in ('openai', 'hermes_cli.auth')):
        raise RuntimeError('UNEXPECTED_AUTH_OR_SDK_IMPORT')
    records = json.load(sys.stdin)
    plans = ${JSON.stringify(plans)}
    subject.time.time = lambda: ${now} / 1000
    if len(records) != len(plans):
        raise RuntimeError('CASE_COUNT_MISMATCH')
    failures = []
    def verify(record, operation, channel):
        try:
            subject.verify_main_proof(record['proof'], operation, record['payload'], channel)
            return 1
        except subject.TextBoundaryError:
            return 0
    for index, (record, plan) in enumerate(zip(records, plans)):
        operation, channel, expected, parallel = plan
        if parallel:
            with ThreadPoolExecutor(max_workers=8) as pool:
                accepted = sum(pool.map(lambda unused: verify(record, operation, channel), range(8)))
            valid = accepted == 1
        else:
            valid = verify(record, operation, channel) == expected
        if not valid:
            failures.append(index)
    if failures:
        sys.stderr.write('PROOF_CONTRACT_FAILED_CASES=' + ','.join(map(str, failures)))
        return 1
    print('PASS ' + str(len(records)))
    return 0
try:
    status = run()
except Exception:
    sys.stderr.write('PROOF_RUNNER_INTERNAL_ERROR')
    status = 2
sys.exit(status)
`

  const env: NodeJS.ProcessEnv = {}

  for (const name of ['PATH', 'PATHEXT', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP']) {
    if (process.env[name]) {env[name] = process.env[name]}
  }

  Object.assign(env, bootstrap, { PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1',
    PYTHONNOUSERSITE: '1', HERMES_DISABLE_LAZY_INSTALLS: '1', HERMES_HOME: path.join(os.tmpdir(), `hermes-proof-${randomUUID()}`) })

  const result = spawnSync(PYTHON, ['-S', '-X', 'utf8', '-B', '-c', script], {
    cwd: ROOT, env, shell: false, windowsHide: true, input: JSON.stringify(records), encoding: 'utf8', timeout: 15_000, maxBuffer: 8192
  })

  // Report finite case labels on failure; never expose stdin, env or a proof.
  const failed = /^PROOF_CONTRACT_FAILED_CASES=([0-9,]+)$/.exec(result.stderr ?? '')
  const failedLabels = failed ? failed[1].split(',').map(index => labels[Number(index)]).join(', ') : 'runner/bootstrap boundary'
  expect(result.error === undefined, 'Python proof child starts').toBe(true)
  expect(result.status === 0, failedLabels).toBe(true)
  expect(result.stderr === '', 'Python proof child emits no diagnostics').toBe(true)
  expect(result.stdout === `PASS ${records.length}\n` || result.stdout === `PASS ${records.length}\r\n`,
    'Python returns only a finite PASS receipt').toBe(true)
}, 20_000)
