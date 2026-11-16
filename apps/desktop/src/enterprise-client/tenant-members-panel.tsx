import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useI18n } from '@/i18n/context'
import { nativeBusinessAdminCopy } from '@/i18n/native-business-admin'

import { EnterpriseModalDialog } from './enterprise-design-system'
import { $enterprisePackageInstallFrozen, registerEnterpriseInstallActivity } from './enterprise-install-readiness'
import { CopyLoginText, LoginCredentials } from './login-credentials'
import { canSetSeatStatus, NativeSeatPasswordReset, NativeSeatStatus, seatActionGates } from './native-agents'
import { enterpriseRoleLabel } from './role-presentation'
import type { EnterpriseClientRuntime, EnterpriseIdentity } from './runtime'
import { WebDisclosure } from './web-sections'

interface Member { principal_id: string; name: string; login_name: string; role: string; status: string; tenant_id?: string }
interface Credentials { login_name: string; temporary_password: string }

export function TenantMembersPanel({ runtime, identity }: { runtime: EnterpriseClientRuntime; identity: EnterpriseIdentity }) {
  const { locale } = useI18n()
  const copy = nativeBusinessAdminCopy[locale]
  const actionScope = useMemo(() => ({runtime, tenant: identity.tenant_id, principal: identity.principal_id, role: identity.role, alive: true}), [runtime, identity.tenant_id, identity.principal_id, identity.role])
  const { reset: resetGate, status: statusGate } = seatActionGates(runtime)
  const [resetTarget, setResetTarget] = useState<Member>()
  const [statusTarget, setStatusTarget] = useState<Member>()
  const [members, setMembers] = useState<Member[]>([])
  const [membersScope, setMembersScope] = useState<typeof actionScope>()
  const [refreshNeeded, setRefreshNeeded] = useState(false)
  const [visibleScope, setVisibleScope] = useState(actionScope)
  const [name, setName] = useState('')
  const [loginName, setLoginName] = useState('')
  const [role, setRole] = useState('operator')
  const [credentials, setCredentials] = useState<Credentials | null>(null)
  const [confirm, setConfirm] = useState<Member | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const alive = useRef(true)
  const pending = useRef(false)
  const listSequence = useRef(0)
  const work = useRef({busy,credentials,name,loginName})
  work.current={busy,credentials,name,loginName}
  const load = useCallback(async () => {
    if (!actionScope.alive) { return }
    const sequence = ++listSequence.current

    try {
      const data=await runtime.get<{principals:Member[]}>('/api/principals')

      if(alive.current && actionScope.alive && sequence===listSequence.current){setMembers(data.principals);setMembersScope(actionScope);setRefreshNeeded(false)}
    } catch (reason) {
      if(alive.current && actionScope.alive && sequence===listSequence.current){throw reason}
    }
  },[runtime,actionScope])

  useEffect(() => {
    alive.current=true
    actionScope.alive=true
    setMembers([])
    setResetTarget(undefined)
    setStatusTarget(undefined)
    setName('')
    setLoginName('')
    setRole('operator')
    setCredentials(null)
    setConfirm(null)
    setError('')
    setRefreshNeeded(false)
    setBusy(pending.current)
    setVisibleScope(actionScope)
    void load().catch(reason => {if(alive.current && actionScope.alive){setError(reason.message)}})
    const activity=registerEnterpriseInstallActivity({blocker:()=>work.current.busy?'账号操作正在进行，请等待完成。':work.current.credentials?'请先保存员工初始账号密码，再进行更新。':work.current.name||work.current.loginName?'员工账号草稿尚未提交。':null})
    return () => {alive.current=false;actionScope.alive=false;activity.dispose()}
  },[load,actionScope])

  async function perform(action:()=>Promise<void>) {
    if(pending.current || $enterprisePackageInstallFrozen.get()){return}
    pending.current=true;setBusy(true);setError('')
    try {await action();await load()} catch(reason) {if(alive.current && actionScope.alive){setError(reason instanceof Error?reason.message:'账号操作未完成')}}
    finally {pending.current=false;if(alive.current){setBusy(false)}}
  }

  if (visibleScope !== actionScope) {return <article className="hesc-card" data-testid="tenant-members" />}

  return <article className="hesc-card" data-testid="tenant-members">
    <h2>员工账号与角色</h2><p>主管负责团队协作与知识审核，坐席使用企业 AI 和个人提醒。账号首次登录必须修改初始密码。删除坐席会永久清除账号、主管申请、个人提醒和运营聚合记录。</p>
    <WebDisclosure label="开通员工账号"><form className="hesc-provisioning-form" onSubmit={event=>{event.preventDefault();void perform(async()=>{
      const created=await runtime.post!<Credentials>('/api/principals',{name:name.trim(),login_name:loginName.trim(),role})
      if(alive.current && actionScope.alive){setCredentials({login_name:created.login_name,temporary_password:created.temporary_password});setName('');setLoginName('')}
    })}}>
      <label>员工姓名<input required maxLength={80} value={name} onChange={event=>setName(event.target.value)}/></label>
      <label>员工登录账号<input required autoComplete="off" placeholder="例如：earlybird.zhangsan" value={loginName} onChange={event=>setLoginName(event.target.value)}/></label>
      <label>员工角色<select value={role} onChange={event=>setRole(event.target.value)}><option value="operator">坐席／员工</option><option value="supervisor">主管</option></select></label>
      <button className="hesc-action" disabled={busy || Boolean(credentials)} type="submit">{busy?'正在处理…':'开通员工账号'}</button>
    </form></WebDisclosure>
    {credentials ? <LoginCredentials key={credentials.login_name} login={credentials.login_name} password={credentials.temporary_password} hideLabel="已保存，隐藏密码" onHide={() => setCredentials(null)} /> : null}
    {error?<p className="hesc-error-copy" role="alert">{error}</p>:null}
    {refreshNeeded ? <button className="hesc-action" onClick={()=>{setError('');void load().catch(()=>{if(actionScope.alive){setError(copy.failed)}})}} type="button">刷新员工列表</button> : null}
    <div className="hesc-table-wrap hesc-scroll-region"><table className="hesc-table"><thead><tr><th>员工</th><th>登录账号</th><th>角色</th><th>状态</th><th>操作</th></tr></thead><tbody>{(membersScope===actionScope ? members : []).map(member=><tr key={member.principal_id}><td>{member.name}</td><td><span className="hesc-selectable">{member.login_name}</span> <CopyLoginText label="复制账号" text={member.login_name} /></td><td>{enterpriseRoleLabel(member.role)}</td><td>{member.status==='active'?'已启用':'已停用'}</td><td>{['operator','supervisor'].includes(member.role)&&member.status==='active'?<button className="hesc-action hesc-action-danger" disabled={busy} onClick={()=>setConfirm(member)} type="button">删除账号</button>:null}{(!member.tenant_id || member.tenant_id===identity.tenant_id) && canSetSeatStatus(identity,member) ? <><button className="hesc-action" disabled={busy || !runtime.post || member.status !== 'active'} onClick={()=>setResetTarget(member)} type="button">{copy.resetPassword}</button><button className="hesc-action" disabled={busy || !runtime.post} onClick={()=>setStatusTarget(member)} type="button">{member.status==='active'?copy.deactivateSeat:copy.activateSeat}</button></>:null}</td></tr>)}</tbody></table></div>
    {resetTarget ? <NativeSeatPasswordReset gate={resetGate} identity={identity} member={resetTarget} onClose={()=>setResetTarget(undefined)} onSaved={()=>{setResetTarget(undefined);void load().catch(()=>{if(actionScope.alive){setError(copy.failed)}})}} parentScope={actionScope} runtime={runtime} /> : null}
    {statusTarget ? <NativeSeatStatus gate={statusGate} identity={identity} member={statusTarget} onClose={()=>setStatusTarget(undefined)} onSaved={()=>{setStatusTarget(undefined);setMembersScope(undefined);setRefreshNeeded(true);void load().catch(()=>{if(actionScope.alive){setError(copy.failed)}})}} parentScope={actionScope} runtime={runtime} /> : null}
    {confirm?<EnterpriseModalDialog label="确认删除员工" onClose={()=>setConfirm(null)}><h2>确认删除员工</h2><p>删除 {confirm.name}（{confirm.login_name}）会永久清除该账号、主管申请、个人提醒及运营聚合记录，无法恢复。</p><div className="hesc-dialog-actions"><button className="hesc-action" onClick={()=>setConfirm(null)} type="button">取消</button><button className="hesc-action hesc-action-danger" disabled={busy} onClick={()=>void perform(async()=>{try {await runtime.post!('/api/principals-delete',{principal_id:confirm.principal_id})} catch (reason) {if (reason instanceof Error && reason.message.includes('提交内容不符合要求')) {throw new Error('删除账号未完成，请刷新员工列表后重试。')} throw reason}

 if(alive.current && actionScope.alive){setConfirm(null)}})} type="button">确认永久删除</button></div></EnterpriseModalDialog>:null}
  </article>
}
