import { createContext, useContext } from 'react'
import { useI18n } from '@/i18n/context'

/** Shared 0.20.8 presentation, opted in by both enterprise product roots. */
export const WebPresentationContext = createContext(false)
const sessionHelp = {
  zh: '直接输入问题即可开始，也可以让 AI 摘要、改写或整理待办。对话仅保留在当前登录会话中。',
  en: 'Ask a question, or let AI summarize, rewrite or organize tasks. Conversations remain within the current signed-in session.',
  ja: '質問を入力するか、AI に要約、書き換え、タスク整理を依頼できます。会話は現在のログインセッション内にのみ保持されます。',
  'zh-hant': '直接輸入問題即可開始，也可以讓 AI 摘要、改寫或整理待辦。對話僅保留在目前登入工作階段中。',
}
const words = {
  zh: { editGroup: '编辑组名', selectKnowledge: '选择此知识', editing: '正在编辑全文：提交审核后保存修改', members: '员工与权限', session: '当前登录会话', required: '必填', subject: '请输入业务对象或群名称', amount: '请输入大于 0 的金额，最多两位小数', date: '请选择预计到账日期', current: '请输入当前密码', password: '新密码至少 6 位，且不能与当前密码相同', confirm: '两次输入的新密码必须一致', create: '创建应收款', items: '项', viewTasks: '查看对应任务' },
  en: { editGroup: 'Edit group name', selectKnowledge: 'Select this knowledge item', editing: 'Editing full text: changes are saved on review submission', members: 'Employees and permissions', session: 'Current signed-in session', required: 'Required', subject: 'Enter a business subject or group name', amount: 'Enter an amount greater than 0 with at most two decimal places', date: 'Select the expected receipt date', current: 'Enter your current password', password: 'Use at least 6 characters, different from the current password', confirm: 'Both new passwords must match', create: 'Create receivable', items: 'items', viewTasks: 'View matching tasks' },
  ja: { editGroup: 'グループ名を編集', selectKnowledge: 'この知識を選択', editing: '全文を編集中：審査提出時に変更を保存します', members: '従業員と権限', session: '現在のログインセッション', required: '必須', subject: '業務対象またはグループ名を入力してください', amount: '0 より大きい金額を小数点以下 2 桁まで入力してください', date: '入金予定日を選択してください', current: '現在のパスワードを入力してください', password: '新パスワードは 6 文字以上で現在のものと異なる必要があります', confirm: '新パスワードを一致させてください', create: '売掛金を作成', items: '件', viewTasks: '対応するタスクを表示' },
  'zh-hant': { editGroup: '編輯組名', selectKnowledge: '選擇此知識', editing: '正在編輯全文：提交審核後儲存修改', members: '員工與權限', session: '目前登入工作階段', required: '必填', subject: '請輸入業務對象或群名稱', amount: '請輸入大於 0 的金額，最多兩位小數', date: '請選擇預計到帳日期', current: '請輸入目前密碼', password: '新密碼至少 6 位，且不能與目前密碼相同', confirm: '兩次輸入的新密碼必須一致', create: '建立應收款', items: '項', viewTasks: '查看對應任務' }
}
export function useWebPresentation() {
  const enabled = useContext(WebPresentationContext)
  const { locale } = useI18n()
  return { enabled, words: { ...(words[locale as keyof typeof words] ?? words.en), session: sessionHelp[locale as keyof typeof sessionHelp] ?? sessionHelp.en } }
}
