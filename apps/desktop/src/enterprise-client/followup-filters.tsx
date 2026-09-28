import { useI18n } from '@/i18n/context'
import { SearchField } from '@/components/ui/search-field'
import type { ReminderCenterTask } from './reminder-state'

const labels = {
  zh: { current:'未处理', history:'历史记录（已处理）', all:'全部', mine:'我自己的', seats:'坐席的', owner:'人员筛选', state:'状态筛选', query:'搜索业务对象或群名称', ended:'处理时间', overdue:'逾期未处理', scope:'仅显示当前账号有权查看的事项；坐席私人提醒不在此范围内。' },
  en: { current:'Unprocessed', history:'History (processed)', all:'All', mine:'Mine', seats:'Other seats', owner:'Filter by owner', state:'Filter by status', query:'Search subject or group name', ended:'Processed at', overdue:'Overdue', scope:'Only authorized records are shown. Other seats’ private reminders are not included.' },
  ja: { current:'未処理', history:'履歴（処理済み）', all:'すべて', mine:'自分', seats:'他の担当者', owner:'担当者で絞り込み', state:'状態で絞り込み', query:'業務対象・グループ名を検索', ended:'処理日時', overdue:'期限超過・未処理', scope:'閲覧権限のある項目のみ表示します。他の担当者の個人リマインダーは含みません。' },
  'zh-hant': { current:'未處理', history:'歷史記錄（已處理）', all:'全部', mine:'我自己的', seats:'坐席的', owner:'人員篩選', state:'狀態篩選', query:'搜尋業務對象或群名稱', ended:'處理時間', overdue:'逾期未處理', scope:'僅顯示目前帳號有權查看的事項；坐席私人提醒不在此範圍內。' }
}
export function useFollowupCopy() {const {locale} = useI18n(); return labels[locale as keyof typeof labels] ?? labels.en}
const stateLabels: Record<string,Record<string,string>> = {
  zh:{open:'待跟进',pending_confirmation:'待确认',followup_due:'到期待跟进',waiting_update:'等待更新 / 改期跟进',active:'待处理',exhausted:'通知失败待处理'},
  en:{open:'Pending follow-up',pending_confirmation:'Awaiting confirmation',followup_due:'Follow-up due',waiting_update:'Awaiting update / rescheduled',active:'Pending',exhausted:'Delivery failed'},
  ja:{open:'フォロー待ち',pending_confirmation:'確認待ち',followup_due:'フォロー期限到来',waiting_update:'更新待ち・日程変更済み',active:'未処理',exhausted:'通知失敗'},
  'zh-hant':{open:'待跟進',pending_confirmation:'待確認',followup_due:'到期待跟進',waiting_update:'等待更新 / 改期跟進',active:'待處理',exhausted:'通知失敗待處理'}
}
export function useFollowupStatus() {const {locale} = useI18n(); return (status:string) => (stateLabels[locale] ?? stateLabels.en)[status] ?? status}
export function isFinished(row: Pick<ReminderCenterTask,'status'>) {return ['completed','cancelled','closed'].includes(row.status)}
export interface FollowupFilters { query: string; owner: string; status: string }
export const initialFollowupFilters = (): FollowupFilters => ({query:'',owner:'all',status:'all'})
export function filterFollowups<T extends ReminderCenterTask>(rows:T[], filters:FollowupFilters, principalId:string):T[] {
  const query = filters.query.trim().normalize('NFKC').toLocaleLowerCase()
  return rows.filter(row => (!query || row.business_subject.normalize('NFKC').toLocaleLowerCase().includes(query))
    && (filters.owner === 'all' || (filters.owner === 'mine' ? row.owner_principal_id === principalId : filters.owner === 'seats' ? row.owner_principal_id !== principalId : `id:${row.owner_principal_id}` === filters.owner))
    && (filters.status === 'all' || (filters.status === 'overdue' ? row.overdue : row.status === filters.status)))
}
export function historyTime(row: ReminderCenterTask) {const time = Date.parse(row.updated_at ?? ''); return Number.isFinite(time) ? time : 0}
export function FollowupFilterBar({rows,value,onChange,statuses}: {rows:ReminderCenterTask[];value:FollowupFilters;onChange(value:FollowupFilters):void;statuses:{value:string;label:string}[]}) {
  const copy = useFollowupCopy()
  const owners = [...new Map(rows.map(row => [row.owner_principal_id,row.owner_name || row.owner_principal_id])).entries()]
  return <div className="hesc-followup-filters">
    <SearchField aria-label={copy.query} placeholder={copy.query} value={value.query} onChange={query => onChange({...value,query})}/>
    <label>{copy.owner}<select aria-label={copy.owner} value={value.owner} onChange={e => onChange({...value,owner:e.target.value})}>
      <option value="all">{copy.all}</option><option value="mine">{copy.mine}</option><option value="seats">{copy.seats}</option>
      {owners.map(([id,name]) => <option key={id} value={`id:${id}`}>{name}</option>)}
    </select></label>
    <label>{copy.state}<select aria-label={copy.state} value={value.status} onChange={e => onChange({...value,status:e.target.value})}><option value="all">{copy.all}</option>{statuses.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</select></label>
  </div>
}
