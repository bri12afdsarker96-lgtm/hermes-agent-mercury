import { useCallback, useEffect, useState } from 'react'

import type { EnterpriseClientRuntime } from './runtime'

interface Group { group_id: string; manager_principal_id: string; member_count: number; name: string; owner_name: string }
interface Operator { group_id: string | null; group_name: string; name: string; principal_id: string }
interface Manager { name: string; principal_id: string; role: string }
interface GroupResponse { groups: Group[]; managers: Manager[]; operators: Operator[] }

function GroupRow({ group, busy, onDelete, onRename }: { group: Group; busy: boolean; onDelete: () => Promise<void>; onRename: (name: string) => Promise<void> }) {
  const [name, setName] = useState(group.name)
  useEffect(() => { setName(group.name) }, [group.name])
  return <div className="hesc-operations-group-row">
    <div className="hesc-operations-group-summary"><strong>{group.name}</strong><span className="hesc-muted-copy">负责人：{group.owner_name} · 当前坐席 {group.member_count} 人</span></div>
    <div className="hesc-operations-group-actions">
      <input aria-label={`${group.name}名称`} maxLength={100} value={name} onChange={event => setName(event.target.value)} />
      <button className="hesc-action" disabled={busy || !name.trim() || name.trim() === group.name} onClick={() => void onRename(name.trim())} type="button">保存修改</button>
      <button className="hesc-action hesc-action-danger" disabled={busy || group.member_count > 0} onClick={() => void onDelete()} title={group.member_count > 0 ? '请先调整该组全部坐席归属' : '永久删除空组'} type="button">删除组别</button>
    </div>
  </div>
}

export function OperationsGroupPanel({ runtime }: { runtime: EnterpriseClientRuntime }) {
  const [data, setData] = useState<GroupResponse>({ groups: [], managers: [], operators: [] })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [groupName, setGroupName] = useState('')
  const [managerId, setManagerId] = useState('')

  const load = useCallback(async () => {
    const next = await runtime.get<GroupResponse>('/api/operations-groups')
    setData(next)
    setManagerId(current => current || next.managers[0]?.principal_id || '')
  }, [runtime])

  useEffect(() => { void load().catch(reason => setError(reason instanceof Error ? reason.message : '员工分组暂时不可读取')) }, [load])

  const mutate = async (body: Record<string, string>) => {
    setBusy(true); setError('')
    try {
      await runtime.post!('/api/operations-groups', body)
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '员工分组操作未完成')
    } finally { setBusy(false) }
  }

  return <article className="hesc-card" data-testid="operations-group-management">
    <h2 className="hesc-section-title">员工组别与归属</h2>
    <p className="hesc-muted-copy">可新增多个组别，并指定主管或企业管理员负责。主管申请获批的坐席默认归入申请主管组；管理员直接创建的坐席默认归入管理员组。删除组别和坐席均为永久删除，不保留隐藏记录。</p>
    {error ? <p className="hesc-error-copy" role="alert">{error}</p> : null}
    <form className="hesc-operations-group-create" onSubmit={event => { event.preventDefault(); if (groupName.trim() && managerId) { void mutate({ action: 'create', name: groupName.trim(), manager_principal_id: managerId }).then(() => setGroupName('')) } }}>
      <label>新增组别名称<input aria-label="新增组别名称" disabled={busy} maxLength={100} required value={groupName} onChange={event => setGroupName(event.target.value)} /></label>
      <label>组负责人<select aria-label="新增组别负责人" disabled={busy} required value={managerId} onChange={event => setManagerId(event.target.value)}>{data.managers.map(manager => <option key={manager.principal_id} value={manager.principal_id}>{manager.name}（{manager.role === 'supervisor' ? '主管' : '企业管理员'}）</option>)}</select></label>
      <button className="hesc-action" disabled={busy || !groupName.trim() || !managerId} type="submit">新增组别</button>
    </form>
    <div className="hesc-alert-list">{data.groups.length ? data.groups.map(group => <GroupRow busy={busy} group={group} key={group.group_id} onRename={async name => mutate({ action: 'rename', group_id: group.group_id, name })} onDelete={async () => mutate({ action: 'delete', group_id: group.group_id })} />) : <p className="hesc-muted-copy">暂无组别，请先新增。</p>}</div>
    <div className="hesc-table-wrap hesc-scroll-region"><table className="hesc-table"><thead><tr><th>坐席</th><th>当前组别</th><th>调整归属</th></tr></thead><tbody>{data.operators.map(operator => <tr key={operator.principal_id}><td>{operator.name}</td><td>{operator.group_name}</td><td><select aria-label={`${operator.name}归属组`} disabled={busy} value={operator.group_id ?? ''} onChange={event => { if (event.target.value) { void mutate({ action: 'assign', principal_id: operator.principal_id, group_id: event.target.value }) } }}><option value="">未分组</option>{data.groups.map(group => <option key={group.group_id} value={group.group_id}>{group.name}（{group.owner_name}）</option>)}</select></td></tr>)}</tbody></table></div>
  </article>
}
