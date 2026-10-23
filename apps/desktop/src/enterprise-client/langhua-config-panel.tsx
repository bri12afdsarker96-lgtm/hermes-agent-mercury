import { useEffect, useRef, useState } from 'react'
import { EnterpriseStatusBadge } from './enterprise-design-system'
import { EnterpriseClientError, type EnterpriseClientRuntime } from './runtime'

const PATH = '/api/langhua-config'
const GATEWAY = 'https://api6.beikke.com/aibot/v1'

interface Status {
  configured: boolean
  connection_id: string | null
  version: number
  enabled: boolean
  encryption_ready: true
  credential_state: 'unverified'
}

/** Pick only the finite public contract, never retain an arbitrary response. */
function statusFrom(value: unknown): Status {
  const row = value as Record<string, unknown> | null
  if (!row || typeof row !== 'object' || typeof row.configured !== 'boolean' ||
      typeof row.enabled !== 'boolean' || row.encryption_ready !== true ||
      row.credential_state !== 'unverified' || row.gateway_url !== GATEWAY ||
      !Number.isSafeInteger(row.version) || (row.version as number) < 0 ||
      (row.configured ? typeof row.connection_id !== 'string' || !row.connection_id || (row.version as number) < 1 :
        row.connection_id !== null || row.version !== 0 || row.enabled)) {
    throw new Error('invalid configuration status')
  }
  return {configured: row.configured, connection_id: row.connection_id as string | null,
    version: row.version as number, enabled: row.enabled, encryption_ready: true, credential_state: 'unverified'}
}

function failure(reason: unknown, saving: boolean): string {
  if (reason instanceof EnterpriseClientError && reason.kind === 'conflict') {
    return '配置已被更新，请刷新状态后重新输入。'
  }
  if (reason instanceof EnterpriseClientError && reason.kind === 'forbidden') {
    return '当前账号无权管理浪花连接，请联系企业管理员。'
  }
  return saving ? '保存结果未确认，请刷新状态核对。需要再次保存时，请重新输入 AppKey。' : '暂时无法读取浪花配置，请稍后刷新。'
}

/** A runtime replacement, even for the same seat, closes and remounts the form. */
export function LanghuaConfigEntry({runtime, scope}: {runtime: EnterpriseClientRuntime; scope: string}) {
  const owner = useRef({runtime, scope, generation: 0})
  if (owner.current.runtime !== runtime || owner.current.scope !== scope) {
    owner.current = {runtime, scope, generation: owner.current.generation + 1}
  }
  return <Disclosure key={owner.current.generation} runtime={runtime} />
}

function Disclosure({runtime}: {runtime: EnterpriseClientRuntime}) {
  const [open, setOpen] = useState(false)
  const details = useRef<HTMLDetailsElement>(null)
  return <details ref={details} className="web-disclosure" onToggle={event => {
    setOpen(event.currentTarget.open)
  }}>
    <summary>浪花数字员工连接配置</summary>
    {open ? <LanghuaConfigPanel runtime={runtime} isOpen={() => details.current?.open === true} /> : null}
  </details>
}

function LanghuaConfigPanel({runtime, isOpen}: {runtime: EnterpriseClientRuntime; isOpen: () => boolean}) {
  const [status, setStatus] = useState<Status | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // Uncontrolled password input: no secret in React state/shared caches.
  const keyInput = useRef<HTMLInputElement>(null)
  const mounted = useRef(false)
  const requestGeneration = useRef(0)
  const pending = useRef(false)

  async function perform(body?: {expected_version: number; enabled?: boolean; app_key?: string}) {
    if (pending.current || !mounted.current || !isOpen()) {return}
    pending.current = true // same-render double clicks must not dispatch twice
    const generation = ++requestGeneration.current
    const current = () => mounted.current && isOpen() && generation === requestGeneration.current
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const result = body === undefined ? await runtime.get<unknown>(PATH) : await runtime.post!<unknown>(PATH, body)
      if (!current()) {return}
      setStatus(statusFrom(result))
      if (body !== undefined) {setNotice('连接配置已加密保存；AppKey 资格仍未验证。')}
    } catch (reason) {
      if (!current()) {return}
      setStatus(null) // require an explicit read before another mutation
      setError(failure(reason, body !== undefined))
    } finally {
      if (current()) {
        pending.current = false
        setBusy(false)
      }
    }
  }

  useEffect(() => {
    mounted.current = true
    void perform()
    const input = keyInput.current
    return () => {
      mounted.current = false
      requestGeneration.current += 1
      pending.current = false
      if (input) {input.value = ''}
    }
    // Entry remounts whenever runtime/scope changes; no polling or auto probes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function saveKey() {
    if (!status || pending.current || !runtime.post || !keyInput.current?.value.trim()) {return}
    const appKey = keyInput.current.value
    keyInput.current.value = '' // submitted closure cannot be recalled
    void perform({expected_version: status.version, app_key: appKey})
  }

  return <article className="hesc-card" data-testid="langhua-config-panel" aria-busy={busy}>
    <div className="hesc-section-heading"><div>
      <h2 className="hesc-section-title">浪花数字员工</h2>
      <p className="hesc-muted-copy">保存企业连接配置。设备绑定和任务运行需要另行授权。</p>
    </div><EnterpriseStatusBadge tone="warning">{status?.configured ? status.enabled ? '配置已启用 · 资格未验证' : '配置已停用 · 资格未验证' : '未配置或状态未确认'}</EnterpriseStatusBadge></div>
    <p className="hesc-muted-copy">固定服务地址：{GATEWAY}</p>
    <p className="hesc-muted-copy">保存不会验证 AppKey，也不会连接、配对或操作设备。</p>
    <label className="hesc-provisioning-form">AppKey
      <input ref={keyInput} type="password" autoComplete="new-password" maxLength={4096}
        disabled={busy || !runtime.post || !status} placeholder="输入新的 AppKey，加密保存后不回显" />
    </label>
    <div className="hesc-inline-actions">
      <button className="hesc-action" type="button" disabled={busy || !runtime.post || !status} onClick={saveKey}>加密保存 AppKey</button>
      <button className="hesc-action hesc-action-secondary" type="button" disabled={busy} onClick={() => {
        if (keyInput.current) {keyInput.current.value = ''}
        void perform()
      }}>刷新状态</button>
      {status?.configured ? <button className="hesc-action hesc-action-secondary" type="button"
        disabled={busy || !runtime.post} onClick={() => {
          if (keyInput.current) {keyInput.current.value = ''}
          void perform({expected_version: status.version, enabled: !status.enabled})
        }}>{status.enabled ? '停用连接配置' : '启用连接配置'}</button> : null}
    </div>
    {notice ? <p role="status" className="hesc-success-copy">{notice}</p> : null}
    {error ? <p role="alert" className="hesc-error">{error}</p> : null}
  </article>
}
