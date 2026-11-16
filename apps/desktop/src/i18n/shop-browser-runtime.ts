import type { Locale } from './types'

const zh = {
  limit: '最大同时打开店铺数',
  retained: '本机保留',
  closeAll: '关闭全部店铺浏览器',
  browserOnly: '控制本机浏览器保留数量，按最近使用顺序回收。',
  unavailable: '接待服务未接入',
  unavailableDetail: '原生上线、下线、启用和不重复消息依赖接待节点与远程业务接口，当前状态未知。',
  reception: '接待状态',
  enabled: '启用',
  noRepeat: '不重复消息',
  online: '上线',
  offline: '下线',
  switchShop: '切换店铺浏览器',
  failed: '店铺浏览器设置暂不可用'
}

export const shopBrowserRuntimeCopy: Record<Locale, Record<keyof typeof zh, string>> = {
  zh,
  'zh-hant': {
    limit: '最大同時開啟店鋪數',
    retained: '本機保留',
    closeAll: '關閉全部店鋪瀏覽器',
    browserOnly: '控制本機瀏覽器保留數量，按最近使用順序回收。',
    unavailable: '接待服務未接入',
    unavailableDetail: '原生上線、下線、啟用和不重複訊息依賴接待節點與遠端業務介面，目前狀態未知。',
    reception: '接待狀態',
    enabled: '啟用',
    noRepeat: '不重複訊息',
    online: '上線',
    offline: '下線',
    switchShop: '切換店鋪瀏覽器',
    failed: '店鋪瀏覽器設定暫不可用'
  },
  en: {
    limit: 'Maximum open shops',
    retained: 'Retained locally',
    closeAll: 'Close all shop browsers',
    browserOnly: 'Limits local browser workspaces and closes the least recently used.',
    unavailable: 'Reception service unavailable',
    unavailableDetail:
      'Native online, offline, enable and duplicate-message controls require reception workers and remote business APIs. Their current state is unknown.',
    reception: 'Reception state',
    enabled: 'Enabled',
    noRepeat: 'No duplicate messages',
    online: 'Online',
    offline: 'Offline',
    switchShop: 'Switch shop browser',
    failed: 'Shop browser settings are unavailable'
  },
  ja: {
    limit: '同時に開く店舗の上限',
    retained: 'ローカルに保持',
    closeAll: '店舗ブラウザーをすべて閉じる',
    browserOnly: 'ローカルのブラウザー数を制限し、最も長く使用していないものから閉じます。',
    unavailable: '接客サービス未接続',
    unavailableDetail:
      'オンライン、オフライン、有効化、重複メッセージの制御には接客ワーカーと業務APIが必要です。現在の状態は不明です。',
    reception: '接客状態',
    enabled: '有効',
    noRepeat: 'メッセージ重複防止',
    online: 'オンライン',
    offline: 'オフライン',
    switchShop: '店舗ブラウザーの切替',
    failed: '店舗ブラウザー設定を利用できません'
  },
  ar: {
    limit: 'الحد الأقصى للمتاجر المفتوحة',
    retained: 'المحفوظ محلياً',
    closeAll: 'إغلاق جميع متصفحات المتاجر',
    browserOnly: 'يحد عدد المتصفحات المحلية ويغلق الأقل استخداماً مؤخراً.',
    unavailable: 'خدمة استقبال الرسائل غير متصلة',
    unavailableDetail:
      'تتطلب أدوات الاتصال وقطع الاتصال والتفعيل ومنع تكرار الرسائل عمال استقبال وواجهات أعمال بعيدة. الحالة الحالية غير معروفة.',
    reception: 'حالة الاستقبال',
    enabled: 'مفعّل',
    noRepeat: 'منع تكرار الرسائل',
    online: 'اتصال',
    offline: 'قطع الاتصال',
    switchShop: 'تبديل متصفح المتجر',
    failed: 'إعدادات متصفح المتجر غير متاحة'
  }
}
