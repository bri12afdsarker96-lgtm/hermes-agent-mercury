import type { Locale } from './types'

export const shopCloudCopy: Record<Locale, Record<'synced' | 'unavailable' | 'conflict' | 'sharedDelete', string>> = {
  zh: { synced: '云端同步完成，可在其他电脑恢复本人有权使用的店铺。', unavailable: '云端同步暂不可用。云端店铺暂不可用，请稍后刷新。', conflict: '云端档案有新版本，请刷新后核验店铺。', sharedDelete: '店铺属于企业资产。移除仅影响本人的使用列表，企业云端档案和登录资料继续保留；重新登录只清理本机登录。' },
  'zh-hant': { synced: '雲端同步完成，可在其他電腦恢復本人有權使用的店鋪。', unavailable: '雲端同步暫不可用。雲端店鋪暫不可用，請稍後重新整理。', conflict: '雲端檔案有新版本，請重新整理後核驗店鋪。', sharedDelete: '店鋪屬於企業資產。移除僅影響本人的使用清單，企業雲端檔案與登入資料繼續保留；重新登入只清理本機登入。' },
  en: { synced: 'Cloud sync complete. Restore your authorized shops on another computer.', unavailable: 'Cloud sync and cloud shops are unavailable. Refresh later.', conflict: 'A newer cloud profile exists. Refresh and verify the shop.', sharedDelete: 'Shops are enterprise assets. Removing one affects your list only. The enterprise cloud profile and login are retained. Signing in again clears only this device login.' },
  ja: { synced: 'クラウド同期済み。権限のある店舗を別のパソコンで復元できます。', unavailable: 'クラウド同期とクラウド店舗を利用できません。後で更新してください。', conflict: 'クラウドに新しい情報があります。更新して店舗を確認してください。', sharedDelete: '店舗は企業の資産です。削除は自分の一覧だけに適用され、企業のクラウド情報とログインは保持されます。再ログインではこの端末のログインだけを消去します。' },
  ar: { synced: 'اكتملت المزامنة السحابية. استعد المتاجر المصرح لك بها على جهاز آخر.', unavailable: 'المزامنة والمتاجر السحابية غير متاحة. أعد التحديث لاحقاً.', conflict: 'يوجد إصدار سحابي أحدث. حدّث الصفحة وتحقق من المتجر.', sharedDelete: 'المتاجر أصول للمؤسسة. الإزالة تخص قائمتك فقط مع الاحتفاظ بملف المؤسسة وتسجيل الدخول السحابي. إعادة الدخول تمسح تسجيل هذا الجهاز فقط.' }
}
