import type { Locale } from './types'

const zh = {
  review: '订单截图',
  openReview: '打开订单截图',
  checking: '正在检查原版模块',
  ready: '原版模块已就绪',
  missing: '原版模块未就绪',
  forbidden: '企业账号无访问权限',
  license: '早鸟Ai专用版 1.0.54 · 原激活码校验尚未接入，仅供测试',
  stop: '停止并关闭当前窗口',
  retry: '重新检查',
  opened: '原版窗口已打开',
  closed: '原版窗口已关闭',
  stopping: '正在安全停止',
  busy: '其他早鸟功能正在使用，请先关闭当前功能窗口',
  failed: '未能确认窗口状态，请重试；不会自动重开或重发任务。'
}

export const doudianOriginalCopy: Record<Locale, { [K in keyof typeof zh]: string }> = {
  zh,
  'zh-hant': {
    review: '訂單截圖',
    openReview: '開啟訂單截圖',
    checking: '正在檢查原版模組',
    ready: '原版模組已就緒',
    missing: '原版模組未就緒',
    forbidden: '企業帳號無存取權限',
    license: '早鳥Ai專用版 1.0.54 · 原啟用碼驗證尚未接入，僅供測試',
    stop: '停止並關閉目前視窗',
    retry: '重新檢查',
    opened: '原版視窗已開啟',
    closed: '原版視窗已關閉',
    stopping: '正在安全停止',
    busy: '其他早鳥功能正在使用，請先關閉目前功能視窗',
    failed: '未能確認視窗狀態，請重試；不會自動重開或重送任務。'
  },
  en: {
    review: 'Order screenshots',
    openReview: 'Open order screenshots',
    checking: 'Checking original module',
    ready: 'Original module ready',
    missing: 'Original module unavailable',
    forbidden: 'Enterprise account access denied',
    license: 'Early Bird Ai 1.0.54 · Original activation verification is not connected; testing only',
    stop: 'Stop and close current window',
    retry: 'Check again',
    opened: 'Original window open',
    closed: 'Original window closed',
    stopping: 'Stopping safely',
    busy: 'Another Early Bird feature is in use. Close its window first.',
    failed: 'Window state could not be confirmed. Retry; tasks are never automatically restarted.'
  },
  ja: {
    review: '注文スクリーンショット',
    openReview: '注文スクリーンショットを開く',
    checking: '元のモジュールを確認中',
    ready: '元のモジュールの準備完了',
    missing: '元のモジュールを利用できません',
    forbidden: '企業アカウントのアクセスが拒否されました',
    license: '早鳥Ai専用版 1.0.54 · 元の認証コード検証は未接続、テスト専用',
    stop: '停止して現在の画面を閉じる',
    retry: '再確認',
    opened: '元の画面が開いています',
    closed: '元の画面を閉じました',
    stopping: '安全に停止中',
    busy: '別の早鳥機能を使用中です。先にその画面を閉じてください。',
    failed: '画面の状態を確認できません。再試行してください。タスクは自動で再開されません。'
  },
  ar: {
    review: 'لقطات الطلبات',
    openReview: 'فتح لقطات الطلبات',
    checking: 'جارٍ فحص الوحدة الأصلية',
    ready: 'الوحدة الأصلية جاهزة',
    missing: 'الوحدة الأصلية غير متاحة',
    forbidden: 'حساب المؤسسة غير مخول بالوصول',
    license: 'Early Bird Ai 1.0.54 · التحقق من التفعيل الأصلي غير متصل، للاختبار فقط',
    stop: 'إيقاف وإغلاق النافذة الحالية',
    retry: 'إعادة الفحص',
    opened: 'النافذة الأصلية مفتوحة',
    closed: 'النافذة الأصلية مغلقة',
    stopping: 'جارٍ الإيقاف الآمن',
    busy: 'ميزة أخرى قيد الاستخدام. أغلق نافذتها أولاً.',
    failed: 'تعذر تأكيد حالة النافذة. أعد المحاولة؛ لن تعاد المهام تلقائياً.'
  }
}
