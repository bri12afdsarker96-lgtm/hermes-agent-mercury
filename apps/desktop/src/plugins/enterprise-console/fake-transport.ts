/**
 * FakeHermesTransport — a `HermesTransport` for tests and previews. It resolves
 * canned responses by path prefix (query string ignored) and holds no
 * credential, so component/page tests exercise the console without any network
 * or token. Unknown paths reject with a 404 `HermesApiError`.
 */

import { HermesApiError } from './fetch-transport'
import { BaseHermesTransport } from './transport'

export type FakeRoutes = Record<string, unknown>

export class FakeHermesTransport extends BaseHermesTransport {
  readonly #routes: FakeRoutes

  constructor(routes: FakeRoutes = {}) {
    super()
    this.#routes = routes
  }

  request<T>(path: string): Promise<T> {
    const key = Object.keys(this.#routes).find(route => path === route || path.startsWith(route))

    if (key === undefined) {
      return Promise.reject(new HermesApiError(404, 'error', `no fake route for ${path}`))
    }

    return Promise.resolve(this.#routes[key] as T)
  }
}
