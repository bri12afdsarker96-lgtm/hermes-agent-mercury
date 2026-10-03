import { useEffect, useId, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n/context'
import { useWebPresentation } from './web-presentation'

export interface WebSection { id: string; label: string; content: ReactNode }
export function WebDisclosure({ label, children }: {label: string; children: ReactNode}) {
  const web = useWebPresentation()
  return web.enabled ? <details className="web-disclosure"><summary>{label}</summary>{children}</details> : <>{children}</>
}
/** Presentation only: keep every panel mounted so switching never drops drafts. */
export function WebSections({ items, label, initial, request }: { items: WebSection[]; label: string; initial?: string; request?: {id:string; nonce:number} }) {
  const web = useWebPresentation()
  const prefix = useId()
  const [selected, setSelected] = useState(initial ?? items[0]?.id)
  useEffect(() => { if (request?.nonce) setSelected(request.id) }, [request?.id, request?.nonce])
  const active = items.some(item => item.id === selected) ? selected : items[0]?.id
  if (!web.enabled) return <>{items.map(item => <div key={item.id}>{item.content}</div>)}</>
  return <div className="web-sections">
    <div className="web-section-tabs" role="tablist" aria-label={label}>
      {items.map((item, index) => <Button key={item.id} id={`${prefix}-${item.id}-tab`} role="tab" aria-selected={active === item.id} aria-controls={`${prefix}-${item.id}`} tabIndex={active === item.id ? 0 : -1} variant={active === item.id ? 'default' : 'outline'} onClick={() => setSelected(item.id)} onKeyDown={event => {
        const next = event.key === 'ArrowRight' ? (index + 1) % items.length : event.key === 'ArrowLeft' ? (index + items.length - 1) % items.length : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : -1
        if (next < 0) return
        event.preventDefault(); setSelected(items[next].id)
        document.getElementById(`${prefix}-${items[next].id}-tab`)?.focus()
      }}>{item.label}</Button>)}
    </div>
    {items.map(item => <div key={item.id} id={`${prefix}-${item.id}`} role="tabpanel" aria-labelledby={`${prefix}-${item.id}-tab`} hidden={active !== item.id} className="web-section-panel">{item.content}</div>)}
  </div>
}

const labels = {
  zh: { tasks:'待处理任务', create:'新建提醒', history:'处理历史', notifications:'通知设置与记录', ai:'AI 整理', manual:'手动填写', staff:'员工', groups:'组别', approvals:'待审批', tools:'工作工具', channels:'企业通知渠道', knowledge:'知识列表与审核', upload:'上传知识', gaps:'知识缺口', diagnostics:'服务与通知诊断', usage:'AI 使用概况', organization:'组织与坐席活跃度', today:'今日', week:'本周', total:'累计', pending:'待跟进', overdue:'逾期', preview:'任务预览', settings:'页面分区' },
  en: { tasks:'Pending tasks', create:'New reminder', history:'Processed history', notifications:'Notification settings and records', ai:'AI planning', manual:'Manual entry', staff:'Employees', groups:'Groups', approvals:'Pending approvals', tools:'Work tools', channels:'Enterprise notification channels', knowledge:'Knowledge and review', upload:'Upload knowledge', gaps:'Knowledge gaps', diagnostics:'Service and notification diagnostics', usage:'AI usage', organization:'Organization and seat activity', today:'Today', week:'This week', total:'All time', pending:'Follow-up', overdue:'Overdue', preview:'Task preview', settings:'Page sections' },
  ja: { tasks:'未処理タスク', create:'リマインダー作成', history:'処理履歴', notifications:'通知設定と記録', ai:'AI 整理', manual:'手動入力', staff:'従業員', groups:'グループ', approvals:'承認待ち', tools:'作業ツール', channels:'企業通知チャネル', knowledge:'知識一覧と審査', upload:'知識アップロード', gaps:'知識不足', diagnostics:'サービスと通知の診断', usage:'AI 利用状況', organization:'組織と担当者の利用状況', today:'今日', week:'今週', total:'累計', pending:'フォロー待ち', overdue:'期限超過', preview:'タスクプレビュー', settings:'ページ区分' },
  'zh-hant': { tasks:'待處理任務', create:'新增提醒', history:'處理歷史', notifications:'通知設定與記錄', ai:'AI 整理', manual:'手動填寫', staff:'員工', groups:'組別', approvals:'待審批', tools:'工作工具', channels:'企業通知渠道', knowledge:'知識列表與審核', upload:'上傳知識', gaps:'知識缺口', diagnostics:'服務與通知診斷', usage:'AI 使用概況', organization:'組織與坐席活躍度', today:'今日', week:'本週', total:'累計', pending:'待跟進', overdue:'逾期', preview:'任務預覽', settings:'頁面分區' }
}
export function useWebLayoutCopy() { const { locale } = useI18n(); return labels[locale as keyof typeof labels] ?? labels.en }
