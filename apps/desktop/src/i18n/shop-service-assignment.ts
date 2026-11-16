import type { Locale } from './types'

type AssignmentCopy = Record<
  'title' | 'ownership' | 'creator' | 'servicing' | 'unassigned' | 'unknown' |
  'target' | 'choose' | 'transfer' | 'pending' | 'loading' | 'membersFailed' |
  'transferFailed' | 'refreshFailed' | 'success' | 'retry' | 'accessChange', string
>

export const shopServiceAssignmentCopy: Record<Locale, AssignmentCopy> = {
  zh: {
    title: '服务店铺转移', ownership: '店铺档案属于本企业', creator: '创建者', servicing: '当前服务员工',
    accessChange: '转移成功后，原服务员工将失去该店铺的查看与操作权限；仅接手员工和企业管理员可查看与操作。',
    unassigned: '尚未分配', unknown: '暂无记录', target: '转移给', choose: '选择有效成员',
    transfer: '转移服务店铺', pending: '正在转移', loading: '正在加载成员',
    membersFailed: '店铺或成员列表加载失败，请刷新后重试。', retry: '重新加载', transferFailed: '转移结果未确认，请重新加载档案核对服务员工。',
    refreshFailed: '转移已提交，档案刷新失败，请刷新确认当前服务员工。', success: '服务店铺已转移。'
  },
  'zh-hant': {
    title: '服務店鋪轉移', ownership: '店鋪檔案屬於本企業', creator: '建立者', servicing: '目前服務員工',
    accessChange: '轉移成功後，原服務員工將失去該店鋪的檢視與操作權限；僅接手員工和企業管理員可檢視與操作。',
    unassigned: '尚未分配', unknown: '暫無紀錄', target: '轉移給', choose: '選擇有效成員',
    transfer: '轉移服務店鋪', pending: '正在轉移', loading: '正在載入成員',
    membersFailed: '店鋪或成員清單載入失敗，請重新整理後重試。', retry: '重新載入', transferFailed: '轉移結果尚未確認，請重新載入檔案核對服務員工。',
    refreshFailed: '轉移已提交，檔案重新整理失敗，請重新整理確認目前服務員工。', success: '服務店鋪已轉移。'
  },
  en: {
    title: 'Shop service assignment', ownership: 'This shop profile belongs to the organization',
    accessChange: 'After a successful transfer, the previous service member loses access to view or operate this shop. Only the receiving member and organization administrators can view and operate it.',
    creator: 'Created by', servicing: 'Current service member', unassigned: 'Unassigned', unknown: 'Unavailable',
    target: 'Assign to', choose: 'Select an active member', transfer: 'Transfer shop service',
    pending: 'Transferring', loading: 'Loading members', membersFailed: 'Could not load shops or members. Refresh and try again.', retry: 'Reload',
    transferFailed: 'The transfer result is unconfirmed. Reload the profile to verify the service member.',
    refreshFailed: 'Transfer submitted. Could not refresh the profile. Refresh to confirm the current service member.',
    success: 'Shop service transferred.'
  },
  ja: {
    title: '店舗担当の移管', ownership: 'この店舗プロファイルは企業の資産です', creator: '作成者',
    accessChange: '移管が完了すると、元の担当者はこの店舗を閲覧・操作できなくなります。移管先の担当者と企業管理者のみが閲覧・操作できます。',
    servicing: '現在の担当者', unassigned: '未割り当て', unknown: '記録なし', target: '移管先',
    choose: '有効なメンバーを選択', transfer: '店舗担当を移管', pending: '移管中', loading: 'メンバーを読み込み中',
    membersFailed: '店舗またはメンバーを読み込めませんでした。更新して再試行してください。', retry: '再読み込み',
    transferFailed: '移管結果は未確認です。プロファイルを再読み込みして担当者を確認してください。',
    refreshFailed: '移管を送信しましたが、プロファイルを更新できませんでした。更新して担当者を確認してください。',
    success: '店舗担当を移管しました。'
  },
  ar: {
    title: 'نقل مسؤولية خدمة المتجر', ownership: 'ملف المتجر ملك للمؤسسة', creator: 'المنشئ',
    accessChange: 'بعد نجاح النقل، يفقد موظف الخدمة السابق صلاحية عرض هذا المتجر أو تشغيله. يحق فقط للموظف المستلم ومسؤولي المؤسسة عرضه وتشغيله.',
    servicing: 'موظف الخدمة الحالي', unassigned: 'غير معين', unknown: 'غير متوفر', target: 'نقل إلى',
    choose: 'اختر عضواً نشطاً', transfer: 'نقل خدمة المتجر', pending: 'جارٍ النقل', loading: 'جارٍ تحميل الأعضاء',
    membersFailed: 'تعذر تحميل المتاجر أو الأعضاء. حدّث الصفحة وحاول مجدداً.', retry: 'إعادة التحميل',
    transferFailed: 'نتيجة النقل غير مؤكدة. أعد تحميل الملف للتحقق من موظف الخدمة.',
    refreshFailed: 'تم إرسال النقل وتعذر تحديث الملف. حدّث الصفحة للتحقق من موظف الخدمة الحالي.',
    success: 'تم نقل خدمة المتجر.'
  }
}
