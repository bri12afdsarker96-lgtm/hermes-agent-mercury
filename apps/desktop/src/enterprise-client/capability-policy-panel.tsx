import { useEffect, useState } from 'react'

import type { EnterpriseClientRuntime } from './runtime'

interface CapabilityPolicyCell {
  enabled?: boolean
  manageable?: boolean
  status?: string
}

interface CapabilityPolicyResponse {
  mode?: string
  policy?: Record<string, Record<string, CapabilityPolicyCell>>
  revision?: number
  target_roles?: string[]
}

type LoadState = 'error' | 'loading' | 'ready' | 'unavailable'

function stateLabel(state: LoadState): string {
  if (state === 'loading') {
    return '正在读取'
  }

  if (state === 'ready') {
    return '已连接'
  }

  if (state === 'error') {
    return '读取失败'
  }

  return '等待企业服务连接'
}

export function CapabilityPolicyPanel({ runtime }: { runtime: EnterpriseClientRuntime | null }) {
  const [error, setError] = useState<string | null>(null)
  const [policy, setPolicy] = useState<CapabilityPolicyResponse | null>(null)
  const [state, setState] = useState<LoadState>('unavailable')

  useEffect(() => {
    let active = true

    if (!runtime) {
      setError(null)
      setPolicy(null)
      setState('unavailable')

      return () => {
        active = false
      }
    }

    setError(null)
    setState('loading')
    void runtime
      .get<CapabilityPolicyResponse>('/api/tenant-capability-policy')
      .then(response => {
        if (!active) {
          return
        }

        setPolicy(response)
        setState('ready')
      })
      .catch(reason => {
        if (!active) {
          return
        }

        setPolicy(null)
        setState('error')
        setError(reason instanceof Error ? reason.message : 'cannot load tenant capability policy')
      })

    return () => {
      active = false
    }
  }, [runtime])

  const entries = Object.entries(policy?.policy ?? {}).flatMap(([role, capabilities]) =>
    Object.entries(capabilities).map(([capabilityId, capability]) => ({ capability, capabilityId, role }))
  )

  return (
    <article className="hesc-card hesc-audit-card" data-testid="enterprise-client-capability-policy">
      <div className="hesc-section-heading">
        <div>
          <h2 className="hesc-section-title">租户能力策略</h2>
          <p className="hesc-muted-copy">
            只读呈现服务端策略矩阵与修订号。非 LIVE 能力不会在客户端被伪装成可管理开关。
          </p>
        </div>
        <span
          className="hesc-status"
          data-tone={state === 'ready' ? 'success' : state === 'error' ? 'error' : 'warning'}
        >
          {stateLabel(state)}
        </span>
      </div>

      {error ? (
        <div className="hesc-error" role="status">
          <div>
            <strong>能力策略服务响应异常</strong>
            <span>{error}</span>
          </div>
        </div>
      ) : null}

      {state === 'loading' ? <p className="hesc-muted-copy">正在读取租户能力策略矩阵…</p> : null}
      {policy ? (
        <dl className="hesc-detail-list">
          <div>
            <dt>策略模式</dt>
            <dd>{policy.mode ?? '—'}</dd>
          </div>
          <div>
            <dt>当前修订</dt>
            <dd>{policy.revision ?? '—'}</dd>
          </div>
          <div>
            <dt>受管角色</dt>
            <dd>{policy.target_roles?.join('、') || '—'}</dd>
          </div>
        </dl>
      ) : null}

      {state === 'ready' && entries.length === 0 ? (
        <p className="hesc-muted-copy">服务端未返回当前租户的可见策略项。</p>
      ) : null}
      {entries.length > 0 ? (
        <div className="hesc-table-wrap">
          <table className="hesc-table">
            <thead>
              <tr>
                <th scope="col">角色</th>
                <th scope="col">能力</th>
                <th scope="col">系统成熟度</th>
                <th scope="col">策略状态</th>
                <th scope="col">可管理</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(({ capability, capabilityId, role }) => (
                <tr key={`${role}-${capabilityId}`}>
                  <td>{role}</td>
                  <td>{capabilityId}</td>
                  <td>{capability.status ?? '—'}</td>
                  <td>{capability.enabled ? '已启用' : '未启用'}</td>
                  <td>{capability.manageable ? '是' : '否'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </article>
  )
}
