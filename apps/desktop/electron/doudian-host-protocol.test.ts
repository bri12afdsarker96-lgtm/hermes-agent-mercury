import { spawn } from 'node:child_process'
import { expect, it, vi } from 'vitest'
import { DoudianHost } from './doudian-host'

function syntheticHost(reply: string, foreground?: typeof spawn) {
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
  const host = new DoudianHost('synthetic', launch, foreground)
  return { host, child: () => child! }
}

it.each(['startPayment', 'resumePayment'])('grants foreground to this host before %s', async method => {
  const grant = vi.fn((_file: string, _args: string[]) => spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' }))
  const fixture = syntheticHost("process.stdout.write(JSON.stringify({id: request.id, ok: true, result: request.method}) + '\\n')", grant as unknown as typeof spawn)
  try {
    await expect(fixture.host.request(method, { taskId: 'a'.repeat(32) })).resolves.toBe(method)
    expect(grant).toHaveBeenCalledTimes(1)
    expect(grant.mock.calls[0][1]).toEqual(['--hermes-grant-foreground', String(fixture.child().pid)])
  } finally {
    fixture.host.close()
    fixture.child().kill()
  }
})

it.each(['startPayment', 'resumePayment'])('rejects %s before dispatch when foreground grant fails', async method => {
  const grant = (() => spawn(process.execPath, ['-e', 'process.exit(1)'], { stdio: 'ignore' })) as typeof spawn
  const fixture = syntheticHost("process.stdout.write(JSON.stringify({id: request.id, ok: true, result: request.method}) + '\\n')", grant)
  try {
    await expect(fixture.host.request(method, { taskId: 'a'.repeat(32) })).rejects.toThrow('DOUDIAN_FOREGROUND_UNAVAILABLE')
    await expect(fixture.host.request('status')).resolves.toBe('status')
  } finally {
    fixture.host.close()
    fixture.child().kill()
  }
})

it.each(['startPayment', 'resumePayment'])('sends CDP %s without launching a foreground helper', async method => {
  const grant = vi.fn(() => { throw new Error('foreground must not run for CDP') })
  const fixture = syntheticHost("process.stdout.write(JSON.stringify({id: request.id, ok: true, result: {method: request.method, params: request.params}}) + '\\n')", grant as unknown as typeof spawn)
  const before = vi.fn()
  try {
    await expect(fixture.host.request(method, { taskId: 'a'.repeat(32) }, { before, foreground: false }))
      .resolves.toEqual({ method, params: { taskId: 'a'.repeat(32) } })
    expect(before).toHaveBeenCalledOnce()
    expect(grant).not.toHaveBeenCalled()
  } finally {
    fixture.host.close()
    fixture.child().kill()
  }
})

it('keeps the session fence before a CDP dispatch', async () => {
  const grant = vi.fn(() => { throw new Error('foreground must not run for CDP') })
  const fixture = syntheticHost("process.stdout.write(JSON.stringify({id: request.id, ok: true, result: request.method}) + '\\n')", grant as unknown as typeof spawn)
  const after = vi.fn()
  try {
    await expect(fixture.host.request('startPayment', { taskId: 'a'.repeat(32) }, {
      before: () => { throw new Error('DOUDIAN_OWNER_CHANGED') }, after, foreground: false
    })).rejects.toThrow('DOUDIAN_OWNER_CHANGED')
    expect(grant).not.toHaveBeenCalled()
    expect(after).not.toHaveBeenCalled()
    await expect(fixture.host.request('status')).resolves.toBe('status')
  } finally {
    fixture.host.close()
    fixture.child().kill()
  }
})

it.each(['startPayment', 'resumePayment'])('checks the session fence before sending %s to the real child pipe', async method => {
  const grant = (() => spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' })) as typeof spawn
  const fixture = syntheticHost("process.stdout.write(JSON.stringify({id: request.id, ok: true, result: request.method}) + '\\n')", grant)
  const after = vi.fn()
  try {
    await expect(fixture.host.request(method, { taskId: 'a'.repeat(32) }, {
      before: () => { throw new Error('DOUDIAN_OWNER_CHANGED') }, after
    })).rejects.toThrow('DOUDIAN_OWNER_CHANGED')
    expect(after).not.toHaveBeenCalled()
    await expect(fixture.host.request('status')).resolves.toBe('status')
  } finally {
    fixture.host.close()
    fixture.child().kill()
  }
})

it.each(['pausePayment', 'resumePayment'])('forwards the exact %s method and taskId through child stdio', async method => {
  const grant = (() => spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' })) as typeof spawn
  const fixture = syntheticHost("process.stdout.write(JSON.stringify({id: request.id, ok: true, result: {method: request.method, params: request.params}}) + '\\n')", grant)
  try {
    await expect(fixture.host.request(method, { taskId: 'a'.repeat(32) })).resolves.toEqual({ method, params: { taskId: 'a'.repeat(32) } })
  } finally {
    fixture.host.close()
    fixture.child().kill()
  }
})

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
