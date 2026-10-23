import { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from '@/i18n/context'
import { Button } from '@/components/ui/button'
import { assistantChoiceRequest, assistantChoicesMatch, type EnterpriseAssistantBackendChoice, type EnterpriseClientRuntime } from './runtime'
import { assistantPresentationFrom } from './assistant-response'
import type { CustomerReplyResponse } from './customer-reply'

interface ConversationEvent { id: string; kind: string; text?: string; state?: string; delivery_state?: string; acknowledged_at?: number; in_reply_to?: string; knowledge_grounded?: boolean }
interface Memory { id: string; text: string; version: number; active: boolean; source_ids: string[]; kind: string }
interface Conversation {
  owner_id: string; customer_id: string; revision: number; can_grant: boolean
  events: ConversationEvent[]; memories: Memory[]; grants: string[]
}
interface Props { runtime: EnterpriseClientRuntime | null; customerId: string; disabled: boolean; refreshToken: string; configurationId?: string; backendChoice?: EnterpriseAssistantBackendChoice; onAcknowledged?: () => void; unknownRequestId?: string; onRecovered?: (text:string,grounded:boolean) => void }
const unresolved = (events: ConversationEvent[]) => events.filter(e => e.kind === 'model_request' && ['pending','unknown'].includes(e.state ?? '') && !e.acknowledged_at)

const words = {
  zh: ['客户历史与记忆','客户原话（坐席录入）','保存来源记录','记忆内容','依据记录','新增记忆','保存或纠正记忆','当前有效记忆','授权坐席编号','授权接手','撤销接手','交接引用','打开交接记录','刷新','读取或保存未完成，请检查权限并重新读取。','此处原话由坐席录入；模型结果都是未发送草稿。记忆经坐席核实，不会自动成为企业知识。','新记忆','客户原话','坐席记录','模型请求','模型草稿','未发送','结果不明','处理中','显示更早记录'],
  en: ['Customer history and memory','Customer statement (entered by seat)','Save source record','Memory text','Source record','New memory','Save or correct memory','Current memories','Seat ID','Grant handover','Revoke handover','Handover reference','Open handover','Refresh','Read or save failed. Check permissions and reload.','Statements are seat-entered; model output is an unsent draft. Seat-verified memory never becomes enterprise knowledge automatically.','New memory','Customer statement','Seat note','Model request','Model draft','Not sent','Unknown','Pending','Show earlier records'],
  ja: ['顧客履歴と記憶','顧客の発言（担当者が入力）','根拠を保存','記憶内容','根拠の記録','記憶を追加','記憶を保存・訂正','現在有効な記憶','担当者 ID','引継ぎを許可','引継ぎを取消','引継ぎ参照','引継ぎを開く','更新','読込・保存できません。権限を確認して再読込してください。','発言は担当者が入力し、モデル出力は未送信の下書きです。記憶は担当者が確認し、企業知識には自動公開されません。','新しい記憶','顧客の発言','担当者メモ','モデル要求','モデル下書き','未送信','結果不明','処理中','以前の記録を表示'],
  'zh-hant': ['客戶歷史與記憶','客戶原話（坐席輸入）','儲存來源記錄','記憶內容','依據記錄','新增記憶','儲存或更正記憶','目前有效記憶','授權坐席編號','授權接手','撤銷接手','交接參照','開啟交接記錄','重新整理','讀取或儲存未完成，請檢查權限並重新讀取。','原話由坐席輸入；模型結果都是未傳送草稿。記憶經坐席核實，不會自動成為企業知識。','新記憶','客戶原話','坐席記錄','模型請求','模型草稿','未傳送','結果不明','處理中','顯示更早記錄']
}

/** Customer data stays on the existing authenticated, encrypted workspace API. */
export function CustomerConversationPanel({runtime, customerId, disabled, refreshToken, configurationId, backendChoice, onAcknowledged, unknownRequestId, onRecovered}: Props) {
  const {locale} = useI18n()
  const w = words[locale as keyof typeof words] ?? words.en
  const [open,setOpen] = useState(false), [data,setData] = useState<Conversation | null>(null)
  const [owner,setOwner] = useState(''), [target,setTarget] = useState(customerId)
  const [reference,setReference] = useState(''), [statement,setStatement] = useState('')
  const [memory,setMemory] = useState(''), [memoryId,setMemoryId] = useState(''), [source,setSource] = useState('')
  const [memoryKind,setMemoryKind] = useState('fact')
  const [subject,setSubject] = useState(''), [busy,setBusy] = useState(false), [error,setError] = useState(false)
  const [count,setCount] = useState(40)
  const [question,setQuestion] = useState(''), [answer,setAnswer] = useState(''), [unknown,setUnknown] = useState(false)
  const epoch = useRef(0), saving = useRef(false)
  const load = useCallback(async () => {
    if (!runtime?.post) return
    const version = ++epoch.current
    try {
      const next = await runtime.post<Conversation>('/api/customer-reply-workspace', {action:'conversation_read',customer_id:target,owner_id:owner || undefined})
      if (version !== epoch.current) return
      if (next.customer_id !== target || (owner && next.owner_id !== owner) || !Number.isSafeInteger(next.revision) || !Array.isArray(next.events) || !Array.isArray(next.memories)) throw Error()
      setData(next); setUnknown(unresolved(next.events).length > 0); setError(false)
    } catch {if (version === epoch.current) {setData(null); setError(true)}}
  }, [runtime,target,owner])
  const choiceKey = JSON.stringify(backendChoice ?? configurationId)
  useEffect(() => {setQuestion('');setAnswer('');setUnknown(false);return()=>{epoch.current++}}, [load,choiceKey])
  useEffect(() => {setData(null);setMemory('');setMemoryId('');setMemoryKind('fact');setSource(''); if(open && !disabled) void load(); return () => {epoch.current++}}, [load,open,disabled,refreshToken])
  const change = async (fields: Record<string, unknown>) => {
    if (!runtime?.post || !data || disabled || saving.current) return
    saving.current = true; setBusy(true)
    const version = ++epoch.current
    try {
      const next = await runtime.post<Conversation>('/api/customer-reply-workspace', {...fields,customer_id:target,owner_id:data.owner_id,expected_revision:data.revision})
      if(next.customer_id !== target || next.owner_id !== data.owner_id || !Number.isSafeInteger(next.revision) || !Array.isArray(next.events) || !Array.isArray(next.memories)) throw Error()
      if (epoch.current === version) {
        setData(next);setUnknown(unresolved(next.events).length > 0);setError(false);setStatement('');setMemory('');setMemoryId('');setSource('')
        if(fields.action === 'conversation_acknowledge' && !owner) onAcknowledged?.()
      }
    } catch {if(epoch.current === version) {setError(true);setData(null)}}
    finally {saving.current=false;setBusy(false)}
  }
  const latest = new Map(data?.memories.map(m => [m.id,m]))
  const sources = data?.events.filter(e => ['customer_statement','seat_note'].includes(e.kind)) ?? []
  const kind = (value: string) => ({customer_statement:w[17],seat_note:w[18],model_request:w[19],model_draft:w[20]}[value] ?? value)
  const shared = ({zh:['接续提问','生成未发送草稿','结果未确认，请读取历史，勿重复提交。'],en:['Continue this conversation','Generate unsent draft','Result unknown. Read history; do not resubmit.'],ja:['会話を続ける','未送信の下書きを作成','結果不明です。再送信せず履歴を確認してください。'],'zh-hant':['接續提問','產生未傳送草稿','結果未確認，請讀取歷史，勿重複提交。']} as Record<string,string[]>)[locale] ?? ['Continue this conversation','Generate unsent draft','Result unknown. Read history; do not resubmit.']
  const memoryLabels = ({zh:['记忆类型','事实','偏好','需求','待跟进','清空已有记忆并保存，可将其作废；历史版本仍保留。'],en:['Memory type','Fact','Preference','Need','Follow-up','Clear an existing memory and save to invalidate it; earlier versions remain.'],ja:['記憶の種類','事実','好み','要望','フォローアップ','既存の記憶を空欄で保存すると無効化されます。過去の版は保持されます。'],'zh-hant':['記憶類型','事實','偏好','需求','待跟進','清空既有記憶並儲存可將其作廢；歷史版本仍保留。']} as Record<string,string[]>)[locale]!
  const acknowledge = ({zh:'已核对历史，保留未确认记录并允许新提问（不重发原请求）',en:'History reviewed: retain the unknown record and allow a new question (no replay)',ja:'履歴を確認済み：未確認記録を保持して新しい質問を許可（元の要求は再送しません）','zh-hant':'已核對歷史，保留未確認記錄並允許新提問（不重發原請求）'} as Record<string,string>)[locale]!
  const blocked = unknown || Boolean(data && unresolved(data.events).length)
  const failedLabel = ({zh:'调用前失败',en:'Failed before model call',ja:'モデル呼出し前の失敗','zh-hant':'呼叫前失敗'} as Record<string,string>)[locale]!
  const completed = !owner && unknownRequestId && data?.events.some(e=>e.id === unknownRequestId && e.state === 'draft_ready')
    ? data.events.find(e=>e.kind === 'model_draft' && e.in_reply_to === unknownRequestId) : undefined
  const recoverLabel = ({zh:'已核对原请求结果，恢复已有草稿（不重新生成）',en:'Original result reviewed: recover the existing draft (no regeneration)',ja:'元の結果を確認済み：既存の下書きを復元（再生成なし）','zh-hant':'已核對原請求結果，恢復既有草稿（不重新產生）'} as Record<string,string>)[locale]!
  const knownBeforeCall = !owner && unknownRequestId && data && (!data.events.some(e=>e.id === unknownRequestId) || data.events.some(e=>e.id === unknownRequestId && e.state === 'failed'))
  const acknowledgeBeforeCall = ({zh:'已核对历史，允许新提问（不重发原请求）',en:'History reviewed: allow a new question (no replay of the original)',ja:'履歴確認済み：新しい質問を許可（元の要求は再送しません）','zh-hant':'已核對歷史，允許新提問（不重發原請求）'} as Record<string,string>)[locale]!
  const generate = async () => {
    if(!data || !runtime?.post || busy || saving.current || disabled || blocked || !question.trim() || (backendChoice && (backendChoice.backend_id !== 'tenant_model' || backendChoice.availability !== 'available'))) return
    saving.current=true;setBusy(true);setUnknown(true);setAnswer('')
    const version=++epoch.current
    try {
      const reply = await runtime.post<CustomerReplyResponse>('/api/tenant-ai-assist', {
        ...(backendChoice ? assistantChoiceRequest(backendChoice) : {configuration_id:configurationId}),
        mode:'knowledge_answer',content:question,customer_id:target,customer_owner_id:data.owner_id,
        conversation_revision:data.revision,customer_request_id:crypto.randomUUID()
      })
      const presentation = assistantPresentationFrom(reply)
      if(!presentation.text || typeof reply.knowledge_grounded !== 'boolean' || (backendChoice && (!reply.backend_choice || !assistantChoicesMatch(backendChoice,reply.backend_choice)))) throw Error()
      if(epoch.current===version) {setAnswer(presentation.text);setUnknown(false);setQuestion('');await load()}
    } catch { /* Keep an ambiguous request blocked; history is the read-only recovery. */ }
    finally {saving.current=false;setBusy(false)}
  }
  return <details className="web-disclosure" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{w[0]}</summary>
    <p className="hesc-muted-copy">{w[15]}</p>
    <Button variant="text" disabled={disabled || busy} onClick={() => void load()}>{w[13]}</Button>
    {error ? <p role="alert">{w[14]}</p> : null}
    {data ? <>
      <output aria-label={w[11]}>{JSON.stringify({owner_id:data.owner_id,customer_id:data.customer_id})}</output>
      <ol aria-label={w[0]}>{data.events.slice(-count).map(e => <li key={e.id}>
        <strong>{kind(e.kind)}{e.delivery_state === 'not_sent' ? ` · ${w[21]}` : ''}{e.state === 'unknown' ? ` · ${w[22]}` : e.state === 'pending' ? ` · ${w[23]}` : e.state === 'failed' ? ` · ${failedLabel}` : ''}</strong>
        {e.text ? <p>{e.text}</p> : null}
      </li>)}</ol>
      {data.events.length > count ? <Button variant="text" onClick={() => setCount(count+40)}>{w[24]}</Button> : null}
      {unresolved(data.events).map(e=><Button key={e.id} disabled={disabled || busy} variant="secondary" onClick={()=>void change({action:'conversation_acknowledge',event_id:e.id})}>{acknowledge}</Button>)}
      {completed?.text ? <Button disabled={disabled || busy} variant="secondary" onClick={()=>onRecovered?.(completed.text!,completed.knowledge_grounded === true)}>{recoverLabel}</Button> : null}
      {knownBeforeCall ? <Button disabled={disabled || busy} variant="secondary" onClick={()=>onAcknowledged?.()}>{acknowledgeBeforeCall}</Button> : null}
      <fieldset disabled={disabled || busy}>
        <label>{w[1]}<textarea maxLength={12000} value={statement} onChange={e => setStatement(e.target.value)} /></label>
        <Button disabled={!statement.trim()} onClick={() => void change({action:'conversation_record',text:statement,event_id:crypto.randomUUID(),kind:'customer_statement'})}>{w[2]}</Button>
        <label>{w[7]}<select value={memoryId} onChange={e => {setMemoryId(e.target.value);const m=latest.get(e.target.value);setMemory(m?.text ?? '');setMemoryKind(m?.kind ?? 'fact');setSource(m?.source_ids[0] ?? '')}}>
          <option value="">{w[16]}</option>{[...latest.values()].map(m => <option key={m.id} value={m.id}>{m.active ? m.text : '—'} · v{m.version}</option>)}
        </select></label>
        <label>{w[4]}<select value={source} onChange={e => setSource(e.target.value)}><option value="">—</option>{sources.map(e => <option key={e.id} value={e.id}>{e.text?.slice(0,80)}</option>)}</select></label>
        <label>{w[3]}<textarea maxLength={4000} value={memory} onChange={e => setMemory(e.target.value)} /></label>
        <label>{memoryLabels[0]}<select value={memoryKind} onChange={e=>setMemoryKind(e.target.value)}>{['fact','preference','need','follow_up'].map((value,index)=><option key={value} value={value}>{memoryLabels[index+1]}</option>)}</select></label>
        <p className="hesc-muted-copy">{memoryLabels[5]}</p>
        <Button disabled={!source || (!memory.trim() && !memoryId)} onClick={() => void change({action:'conversation_memory',text:memory,memory_id:memoryId || undefined,source_ids:[source],kind:memoryKind})}>{w[6]}</Button>
        {data.can_grant ? <><label>{w[8]}<input value={subject} onChange={e => setSubject(e.target.value)} /></label>
          <Button disabled={!subject.trim()} onClick={() => void change({action:'conversation_grant',subject_id:subject.trim(),allow:true})}>{w[9]}</Button>
          <Button disabled={!subject.trim()} onClick={() => void change({action:'conversation_grant',subject_id:subject.trim(),allow:false})}>{w[10]}</Button></> : null}
      </fieldset>
      {owner ? <><label>{shared[0]}<textarea maxLength={12000} value={question} disabled={busy || disabled || blocked} onChange={e=>setQuestion(e.target.value)} /></label>
        <Button disabled={busy || disabled || blocked || !question.trim() || (backendChoice && (backendChoice.backend_id !== 'tenant_model' || backendChoice.availability !== 'available'))} onClick={()=>void generate()}>{shared[1]}</Button>
        {blocked ? <p role="status">{shared[2]}</p> : null}{answer ? <p>{answer}</p> : null}</> : null}
    </> : null}
    <label>{w[11]}<input value={reference} onChange={e => setReference(e.target.value)} /></label>
    <Button disabled={disabled || busy} onClick={() => {try {const parsed=JSON.parse(reference);if(typeof parsed.owner_id!=='string'||typeof parsed.customer_id!=='string') throw Error();setData(null);setOwner(parsed.owner_id);setTarget(parsed.customer_id);void (owner===parsed.owner_id&&target===parsed.customer_id ? load() : Promise.resolve())}catch{setError(true)}}}>{w[12]}</Button>
  </details>
}
