import { describe, expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { requireLoopbackOrigin, selectEnterpriseOrigin } from './enterprise-local-origin'
import { resolveEnterpriseUrl } from './enterprise-transport'
import productionDeployment from '../assets/enterprise-deployment.json'

const packaged = 'https://enterprise.example.test'

describe('local enterprise origin boundary', () => {
  it.each([
    ['http://127.0.0.1:18080', 'http://127.0.0.1:18080'],
    ['http://localhost:80', 'http://127.0.0.1:80'],
    ['http://[::1]:18080', 'http://[::1]:18080'],
  ])('accepts explicit development loopback %s', (value, expected) => {
    expect(selectEnterpriseOrigin({ isPackaged: false, packagedOrigin: packaged, localBuild: false, envOrigin: value }))
      .toEqual({ origin: expected, source: 'env', local: true })
  })

  it.each([
    'https://ppbb096.site', 'http://192.168.1.5:18080', 'http://localhost',
    'http://127.1:18080', 'http://127.0.0.2:18080', 'http://localhost:0',
    'http://localhost:65536', 'http://localhost:18080/path', 'http://localhost:18080?x=1',
    'http://user@localhost:18080', '', 'https://localhost:18080',
  ])('rejects invalid development origin %s without falling back', value => {
    expect(() => selectEnterpriseOrigin({ isPackaged: false, packagedOrigin: packaged, localBuild: false, envOrigin: value })).toThrow(/local enterprise origin/)
  })

  it('ignores even an invalid env value in packaged production', () => {
    expect(selectEnterpriseOrigin({ isPackaged: true, packagedOrigin: packaged, localBuild: false, envOrigin: 'http://localhost:18080' }))
      .toEqual({ origin: packaged, source: 'packaged', local: false })
    expect(selectEnterpriseOrigin({ isPackaged: true, packagedOrigin: '', localBuild: false, envOrigin: 'http://localhost:18080' }).origin).toBeNull()
    const actual = selectEnterpriseOrigin({ isPackaged: true, packagedOrigin: productionDeployment.enterprise_api_origin, localBuild: false, envOrigin: 'http://localhost:18080' })
    expect(actual.origin).toBe(new URL(productionDeployment.enterprise_api_origin).origin)
    expect(actual.local).toBe(false)
  })

  it('never reaches the request boundary after an invalid development origin', () => {
    const request = vi.fn()
    const start = () => {
      const selected = selectEnterpriseOrigin({ isPackaged: false, packagedOrigin: packaged, localBuild: false, envOrigin: 'http://192.168.1.5:18080' })
      request(selected.origin)
    }
    expect(start).toThrow(/loopback/)
    expect(request).not.toHaveBeenCalled()
  })

  it('routes a real enterprise URL to an isolated loopback listener', async () => {
    const server = createServer((request, response) => {
      response.writeHead(request.url === '/api/health' ? 200 : 404, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ local: true }))
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Missing test listener')
      const selected = selectEnterpriseOrigin({ isPackaged: false, packagedOrigin: packaged, localBuild: false,
        envOrigin: `http://localhost:${address.port}` })
      const response = await fetch(resolveEnterpriseUrl(selected.origin!, '/api/health'))
      expect(await response.json()).toEqual({ local: true })
      expect(selected.source).toBe('env')
    } finally {
      const closed = once(server, 'close')
      server.close()
      await closed
    }
  })

  it('uses only validated build-time configuration in local packages', () => {
    expect(selectEnterpriseOrigin({ isPackaged: true, packagedOrigin: 'http://127.0.0.1:18080', localBuild: true, envOrigin: packaged }))
      .toEqual({ origin: 'http://127.0.0.1:18080', source: 'local-build', local: true })
    expect(() => requireLoopbackOrigin(packaged)).toThrow()
  })
})
