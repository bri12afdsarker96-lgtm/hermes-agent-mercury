import { spawn } from 'node:child_process'
import { expect, it } from 'vitest'
import { DoudianHost } from './doudian-host'

function syntheticHost(reply: string) {
  let child: ReturnType<typeof spawn> | undefined
  const launch = (() => {
    child = spawn(process.execPath, ['-e', `
      process.stdin.once('data', data => {
        const request = JSON.parse(data.toString())
        ${reply}
      })
      setInterval(() => {}, 1000)
    `], { stdio: 'pipe' })
    return child
  }) as typeof spawn
  const host = new DoudianHost('synthetic', launch)
  return { host, child: () => child! }
}

it('exchanges a correlated reply over real child stdio', async () => {
  const fixture = syntheticHost("process.stdout.write(JSON.stringify({id: request.id, ok: true, result: 'synthetic'}) + '\\n')")
  try {
    await expect(fixture.host.request('initialize')).resolves.toBe('synthetic')
  } finally {
    fixture.host.close()
    fixture.child().kill()
  }
})

it.each([
  ['malformed JSON', "process.stdout.write('{bad}\\n')"],
  ['invalid reply', "process.stdout.write(JSON.stringify({id: request.id, ok: 'true'}) + '\\n')"],
  ['oversized frame', "process.stdout.write('x'.repeat(262145))"],
  ['legacy authorization event', "process.stdout.write(JSON.stringify({event: 'paymentAuthorization'}) + '\\n')"]
])('rejects %s and terminates the child', async (_name, reply) => {
  const fixture = syntheticHost(reply)
  const exited = new Promise(resolve => fixture.child().once('exit', resolve))
  try {
    await expect(fixture.host.request('initialize')).rejects.toThrow('DOUDIAN_PROTOCOL_ERROR')
    await expect(exited).resolves.toBeDefined()
    await expect(fixture.host.request('initialize')).rejects.toThrow('DOUDIAN_HOST_LOST')
  } finally {
    fixture.host.close()
    fixture.child().kill()
  }
}, 10000)
