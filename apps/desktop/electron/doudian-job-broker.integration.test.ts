import { expect, it } from 'vitest'
import path from 'node:path'
import { createDoudianJobHost } from './doudian-job-broker'

const broker = process.env.HERMES_TEST_JOB_BROKER
const fixture = process.env.HERMES_TD_TEST_HOST

it('rejects a relative broker path without launching the host', () => {
  expect(() => createDoudianJobHost(path.resolve('synthetic.exe'), 'relative-broker.exe'))
    .toThrow('DOUDIAN_JOB_BROKER_UNAVAILABLE')
})

it.skipIf(process.platform !== 'win32' || !fixture)(
  'fails closed when the broker cannot be started', async () => {
    const host = createDoudianJobHost(fixture!, path.resolve('missing-synthetic-job-broker.exe'))
    try {
      await expect(host.request('initialize')).rejects.toThrow('DOUDIAN_HOST_LOST')
    } finally {
      host.close()
    }
  }
)

it.skipIf(process.platform !== 'win32' || !broker || !fixture)(
  'carries TD fixture stdio through the native job broker', async () => {
    const host = createDoudianJobHost(fixture!, broker!)
    try {
      const result = await host.request('initialize', { scope: 'a'.repeat(64) }) as { protocol: number; integration: string }
      expect(result.protocol).toBe(1)
      expect(result.integration).toBe('hermes-review-v1')
      const capabilities = await host.request('capabilities') as { protocol: number }
      expect(capabilities.protocol).toBe(1)
    } finally {
      host.close()
    }
  }, 15000
)
