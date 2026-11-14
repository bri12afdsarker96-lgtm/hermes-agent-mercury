import type { Locale } from './types'

const zh = {
  title: '早鸟原版打款',
  open: '打开早鸟打款窗口',
  stop: '停止并关闭打款窗口',
  license: '打款前请核对订单与金额。',
  modes: '小额打款 / 新订单小额打款',
  checking: '正在检查原打款模块',
  missing: '原打款模块未接入或版本不支持',
  ready: '原打款模块已就绪',
  opened: '原版窗口已打开，打款操作在该窗口中完成。',
  closed: '原版窗口已关闭',
  failed: '原打款模块不可用或企业会话失效；请检查后重试。',
  retry: '重新检查模块',
  stopping: '正在安全停止并关闭窗口'
}

export const paymentOriginalCopy: Record<Locale, { [K in keyof typeof zh]: string }> = {
  zh,
  en: {
    title: 'Original Early Bird payments',
    open: 'Open Early Bird payment window',
    stop: 'Stop and close payment window',
    license: 'Check the order and amount before payment.',
    modes: 'Small payment / New-order small payment',
    checking: 'Checking original payment module',
    missing: 'Original payment module missing or unsupported',
    ready: 'Original payment module ready',
    opened: 'Original window is open. Payment operations remain in that window.',
    closed: 'Original window closed',
    failed: 'Payment module unavailable or enterprise session expired. Check and retry.',
    retry: 'Check module again',
    stopping: 'Safely stopping and closing window'
  },
  'zh-hant': {
    title: '早鳥原版打款',
    open: '開啟早鳥打款視窗',
    stop: '停止並關閉打款視窗',
    license: '打款前請核對訂單與金額。',
    modes: '小額打款 / 新訂單小額打款',
    checking: '正在檢查原打款模組',
    missing: '原打款模組未接入或版本不支援',
    ready: '原打款模組已就緒',
    opened: '原版視窗已開啟，打款操作在該視窗中完成。',
    closed: '原版視窗已關閉',
    failed: '原打款模組不可用或企業工作階段已失效；請檢查後重試。',
    retry: '重新檢查模組',
    stopping: '正在安全停止並關閉視窗'
  },
  ja: {
    title: '早鳥オリジナル支払い',
    open: '早鳥の支払い画面を開く',
    stop: '停止して支払い画面を閉じる',
    license: '支払い前に注文と金額を確認してください。',
    modes: '少額支払い / 新規注文の少額支払い',
    checking: '元の支払いモジュールを確認中',
    missing: '元の支払いモジュールが未接続または未対応です',
    ready: '元の支払いモジュールの準備完了',
    opened: '元の画面が開いています。支払い操作はその画面で行います。',
    closed: '元の画面を閉じました',
    failed: '支払いモジュールを利用できないか、企業セッションが失効しました。確認して再試行してください。',
    retry: 'モジュールを再確認',
    stopping: '安全に停止して画面を閉じています'
  },
  ar: {
    title: 'مدفوعات Early Bird الأصلية',
    open: 'فتح نافذة الدفع الأصلية',
    stop: 'إيقاف وإغلاق نافذة الدفع',
    license: 'تحقق من الطلب والمبلغ قبل الدفع.',
    modes: 'دفعة صغيرة / دفعة صغيرة لطلب جديد',
    checking: 'جارٍ فحص وحدة الدفع الأصلية',
    missing: 'وحدة الدفع الأصلية غير متصلة أو غير مدعومة',
    ready: 'وحدة الدفع الأصلية جاهزة',
    opened: 'النافذة الأصلية مفتوحة. تتم عملية الدفع في تلك النافذة.',
    closed: 'أغلقت النافذة الأصلية',
    failed: 'وحدة الدفع غير متاحة أو انتهت جلسة المؤسسة. تحقق ثم أعد المحاولة.',
    retry: 'إعادة فحص الوحدة',
    stopping: 'جارٍ الإيقاف الآمن وإغلاق النافذة'
  }
}
