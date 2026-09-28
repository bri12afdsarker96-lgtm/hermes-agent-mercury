/**
 * Browser implementation of the enterprise desktop bridge.
 *
 * The formal EnterpriseClientApp deliberately speaks only to the opaque
 * Electron bridge.  This adapter preserves that contract for the web build:
 * credentials are exchanged once with the same-origin service.  The server
 * keeps the issued bearer inside an HttpOnly, Secure, SameSite cookie; this
 * module holds only an opaque page-local session id.  No raw credential is
 * written to localStorage, sessionStorage, URL fragments, logs, or React state.
 */

type BrowserSession = Record<never, never>

type BridgeResult =
  | { data: unknown; kind: 'ok' }
  | { code: string; kind: 'error'; message: string; status: number }

const sessions = new Map<string, BrowserSession>()
const apiPrefix = '/api/'

function newSessionId(): string {
  return crypto.randomUUID()
}

function safeApiPath(path: string): string | null {
  if (!path.startsWith(apiPrefix) || path.includes('\\') || path.includes('\u0000')) {
    return null
  }

  return path
}

function failure(status: number): Extract<BridgeResult, { kind: 'error' }> {
  return { code: 'request_failed', kind: 'error', message: 'enterprise request failed', status }
}

async function readJson(response: Response): Promise<unknown> {
  const type = response.headers.get('content-type') ?? ''

  if (!type.includes('application/json')) {
    return null
  }

  try {
    return await response.json()
  } catch {
    return null
  }
}

function headersFor(_session: BrowserSession, json = false): Headers {
  const headers = new Headers()

  if (json) {
    headers.set('Content-Type', 'application/json')
  }

  return headers
}

const READ_RETRY_DELAYS_MS = [300, 900] as const

function sleep(milliseconds: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, milliseconds))
}

/**
 * Reads are idempotent and are the only browser requests retried here.  A
 * short packet-loss or cross-border routing hiccup must not turn a valid
 * cookie into a fake "login required" state.  Writes remain exactly-once from
 * the browser's perspective: the server may have completed a timed-out POST.
 */
async function fetchReadWithRetry(path: string, init: RequestInit): Promise<Response> {
  let lastFailure: unknown

  for (let attempt = 0; attempt <= READ_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const response = await fetch(path, init)

      if (response.status < 500 || attempt === READ_RETRY_DELAYS_MS.length) {
        return response
      }
      lastFailure = new Error(`read returned ${response.status}`)
    } catch (reason) {
      lastFailure = reason
      if (attempt === READ_RETRY_DELAYS_MS.length) {
        throw reason
      }
    }

    await sleep(READ_RETRY_DELAYS_MS[attempt])
  }

  throw lastFailure instanceof Error ? lastFailure : new Error('read unavailable')
}

async function protectedFetch(sessionId: string, path: string, init: RequestInit = {}): Promise<BridgeResult> {
  const transportPath = path === '/api/password-change' ? '/api/browser-password-change' : path
  const safePath = safeApiPath(transportPath)
  const session = sessions.get(sessionId)

  if (!safePath || !session) {
    return failure(401)
  }

  // A broken upstream connection must never leave the browser's upload form in
  // its busy state indefinitely.  File mutations intentionally are not retried
  // here: a response can be lost after the server has durably staged the file.
  // The user gets a recoverable timeout instead of a duplicate upload.
  const controller = new AbortController()
  const deadlineMs = init.body instanceof FormData ? 60_000 : 20_000
  const deadline = window.setTimeout(() => controller.abort(), deadlineMs)

  try {
    const request = {
      ...init,
      credentials: 'same-origin',
      headers: headersFor(session, init.body !== undefined && !(init.body instanceof FormData)),
      signal: controller.signal
    } satisfies RequestInit
    const response = (init.method ?? 'GET').toUpperCase() === 'GET'
      ? await fetchReadWithRetry(safePath, request)
      : await fetch(safePath, request)
    const data = await readJson(response)

    if (!response.ok) {
      return failure(response.status)
    }

    // A password rotation invalidates the old cookie and replaces it with a
    // fresh HttpOnly session.  The new token never enters this bridge.
    if (path === '/api/password-change') {
      return { data: { must_change_password: false }, kind: 'ok' }
    }

    return { data, kind: 'ok' }
  } catch {
    return failure(controller.signal.aborted ? 504 : 0)
  } finally {
    window.clearTimeout(deadline)
  }
}

async function loginWithPassword(payload: { loginName: string; password: string }): Promise<
  | { baseUrl: string; mustChangePassword: boolean; ok: true; sessionId: string }
  | { code: string; message: string; ok: false }
> {
  try {
    const response = await fetch('/api/browser-login', {
      body: JSON.stringify({ name: payload.loginName, password: payload.password }),
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      method: 'POST'
    })
    const body = await readJson(response)

    if (!response.ok || !body || typeof body !== 'object') {
      const code = response.status === 403 ? 'invalid_credentials'
        : response.status === 429 ? 'rate_limited'
          : response.status >= 500 ? 'service_unavailable'
            : 'request_failed'
      return { code, message: 'login failed', ok: false }
    }

    const result = body as { must_change_password?: unknown }

    const sessionId = newSessionId()
    sessions.set(sessionId, {})

    return {
      baseUrl: window.location.origin,
      mustChangePassword: result.must_change_password === true,
      ok: true,
      sessionId
    }
  } catch {
    return { code: 'service_unavailable', message: 'login failed', ok: false }
  }
}

function installSpeechBridge() {
  return {
    async status() {
      return { available: 'speechSynthesis' in window }
    },
    async speak({ requestId: _requestId, text }: { requestId: string; sessionId: string; text: string }) {
      if (!('speechSynthesis' in window)) {
        return { ok: false }
      }

      window.speechSynthesis.cancel()
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = 'zh-CN'
      window.speechSynthesis.speak(utterance)
      return { ok: true }
    },
    async stop({ requestId: _requestId }: { requestId: string; sessionId: string }) {
      window.speechSynthesis?.cancel()
      return { ok: true }
    }
  }
}

function installDownloadBridge() {
  return async ({ path, sessionId }: { path: string; sessionId: string }) => {
    const safePath = safeApiPath(path)
    const session = sessions.get(sessionId)

    if (!safePath || !session) {
      return { saved: false }
    }

    try {
      const response = await fetch(safePath, {
        credentials: 'same-origin',
        headers: headersFor(session)
      })

      if (!response.ok) {
        return { saved: false }
      }

      const blob = await response.blob()
      const source = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.download = '未外呼订单列表.csv'
      link.href = source
      link.style.display = 'none'
      document.body.append(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(source), 1_000)
      return { saved: true }
    } catch {
      return { saved: false }
    }
  }
}

/** Install before EnterpriseClientApp mounts.  It intentionally provides only
 * the enterprise contract; generic Electron APIs are absent in the browser. */
export function installEnterpriseWebBridge(): void {
  document.documentElement.dataset.hermesSurface = 'web'
  // The web build is not an Electron install.  A signed installer URL is set
  // only as part of the final client release, after this web-first validation
  // round.  Leaving it absent prevents a stale or partial installer from ever
  // being exposed as a download.
  delete document.documentElement.dataset.hermesDesktopDownloadUrl

  const enterprise = {
    async autoConnect() {
      try {
        const response = await fetchReadWithRetry('/api/whoami', { credentials: 'same-origin' })
        const body = await readJson(response)

        if (!response.ok || !body || typeof body !== 'object') {
          // A confirmed 401 is the only unauthenticated result. A gateway
          // timeout/5xx is connectivity, not a reason to throw the member back
          // to the login form or make them manually reconnect.
          const code = response.status === 401
            ? 'no_native_session'
            : response.status === 429
              ? 'rate_limited'
              : response.status >= 500
                ? 'service_unavailable'
                : 'request_failed'
          return { code, message: code === 'no_native_session' ? 'login required' : 'service unavailable', ok: false } as const
        }

        const identity = body as { must_change_password?: unknown }
        const sessionId = newSessionId()
        sessions.set(sessionId, {})
        return {
          baseUrl: window.location.origin,
          mustChangePassword: identity.must_change_password === true,
          ok: true,
          sessionId
        } as const
      } catch {
        return { code: 'service_unavailable', message: 'service unavailable', ok: false } as const
      }
    },
    async beginLogin() {
      return { code: 'browser_password_login', message: 'password login required', ok: false } as const
    },
    async disconnect(sessionId: string) {
      sessions.delete(sessionId)
      return { ok: true }
    },
    download: installDownloadBridge(),
    loginWithPassword,
    async multipart(request: {
      fields: Record<string, string>
      files: Array<{ bytes: ArrayBuffer; contentType: string; field: 'call_file' | 'main_file'; filename: string }>
      path: string
      sessionId: string
    }): Promise<BridgeResult> {
      const form = new FormData()

      for (const [key, value] of Object.entries(request.fields)) {
        form.set(key, value)
      }

      for (const file of request.files) {
        form.append(file.field, new Blob([file.bytes], { type: file.contentType }), file.filename)
      }

      return protectedFetch(request.sessionId, request.path, { body: form, method: 'POST' })
    },
    async request(request: { body?: unknown; method?: string; path: string; sessionId: string }): Promise<BridgeResult> {
      const method = request.method === 'POST' ? 'POST' : 'GET'
      const body = method === 'POST' ? JSON.stringify(request.body ?? {}) : undefined

      return protectedFetch(request.sessionId, request.path, { body, method })
    },
    speech: installSpeechBridge(),
    async upload(request: {
      bytes: ArrayBuffer
      contentType: string
      filename: string
      path: string
      sessionId: string
    }): Promise<BridgeResult> {
      const form = new FormData()
      form.set('file', new Blob([request.bytes], { type: request.contentType }), request.filename)

      return protectedFetch(request.sessionId, request.path, { body: form, method: 'POST' })
    }
  }

  window.hermesDesktop = {
    enterprise,
    notify: async () => false,
    revealLogs: async () => undefined,
    reportEnterpriseActivity: () => undefined,
    setTitleBarTheme: () => undefined
  } as unknown as Window['hermesDesktop']
}
