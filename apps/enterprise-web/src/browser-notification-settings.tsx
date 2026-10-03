import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { EnterpriseModalDialog } from '@/enterprise-client/enterprise-design-system'
import { useI18n } from '@/i18n/context'
import { browserNotificationPermission, requestBrowserNotificationPermission } from './browser-notifications'

const copy = {
  zh: {
    title: '系统通知',
    enable: '启用系统通知',
    close: '关闭',
    failed: '授权未完成，请检查浏览器站点设置后重试。',
    hint: '保持网页打开时接收待办系统通知；关闭网页后不保证送达。提示音仍使用内置音频，并受浏览器自动播放和系统静音设置影响。',
    default: '尚未授权。点击下方按钮后，请在浏览器提示中选择允许。',
    granted: '已获得浏览器通知权限。若未出现通知，请检查系统通知或勿扰设置。',
    denied: '通知已被浏览器阻止。请在地址栏的站点权限中允许通知后重新打开此设置。',
    unsupported: '当前浏览器或连接不支持系统通知。请使用支持通知的浏览器通过 HTTPS 访问；页面内提醒仍可用。'
  },
  en: {
    title: 'System notifications',
    enable: 'Enable notifications',
    close: 'Close',
    failed: 'Permission was not completed. Check site settings and retry.',
    hint: 'Keep this page open for task notifications; delivery is not guaranteed after closing it. The bundled sound is subject to browser autoplay and system mute settings.',
    default: 'Not authorized. Click below, then allow notifications in the browser prompt.',
    granted:
      'Browser permission granted. If notifications are missing, check system notification and Do Not Disturb settings.',
    denied: 'Blocked by the browser. Allow notifications in site permissions, then reopen these settings.',
    unsupported:
      'Notifications are unavailable in this browser or connection. Use a supported browser over HTTPS; in-page reminders still work.'
  },
  ja: {
    title: 'システム通知',
    enable: '通知を有効にする',
    close: '閉じる',
    failed: '許可を完了できませんでした。サイト設定を確認して再試行してください。',
    hint: '通知にはページを開いたままにしてください。閉じた後の配信は保証されません。内蔵音声は自動再生とミュート設定の制限を受けます。',
    default: '未許可です。下のボタンを押し、ブラウザで通知を許可してください。',
    granted: 'ブラウザ通知は許可済みです。表示されない場合はシステム通知や集中モードを確認してください。',
    denied: '通知がブロックされています。サイトの権限で許可し、この設定を開き直してください。',
    unsupported:
      'このブラウザまたは接続では通知を利用できません。対応ブラウザで HTTPS にアクセスしてください。ページ内リマインダーは利用できます。'
  },
  'zh-hant': {
    title: '系統通知',
    enable: '啟用系統通知',
    close: '關閉',
    failed: '授權未完成，請檢查瀏覽器網站設定後重試。',
    hint: '保持網頁開啟時接收待辦系統通知；關閉網頁後不保證送達。提示音仍使用內建音訊，並受瀏覽器自動播放和系統靜音設定影響。',
    default: '尚未授權。點擊下方按鈕後，請在瀏覽器提示中選擇允許。',
    granted: '已取得瀏覽器通知權限。若未出現通知，請檢查系統通知或勿擾設定。',
    denied: '通知已被瀏覽器阻擋。請在網址列的網站權限中允許通知後重新開啟此設定。',
    unsupported: '目前瀏覽器或連線不支援系統通知。請使用支援通知的瀏覽器透過 HTTPS 存取；頁面內提醒仍可用。'
  }
}

export function BrowserNotificationSettings() {
  const { locale } = useI18n()
  const text = copy[locale as keyof typeof copy] ?? copy.en
  const [open, setOpen] = useState(false)
  const [permission, setPermission] = useState(browserNotificationPermission)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const refresh = () => setPermission(browserNotificationPermission())
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [])
  const enable = async () => {
    setBusy(true)
    setFailed(false)
    try {
      setPermission(await requestBrowserNotificationPermission())
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          setPermission(browserNotificationPermission())
          setFailed(false)
          setOpen(true)
        }}
      >
        {text.title}
      </Button>
      {open ? (
        <EnterpriseModalDialog label={text.title} onClose={() => setOpen(false)}>
          <div className="hesc-panel-heading">
            <h2>{text.title}</h2>
            <Button aria-label={text.close} size="icon-sm" variant="ghost" onClick={() => setOpen(false)}>
              ×
            </Button>
          </div>
          <p role="status">{text[permission]}</p>
          <p>{text.hint}</p>
          {failed ? <p role="alert">{text.failed}</p> : null}
          {permission === 'default' ? (
            <Button disabled={busy} onClick={() => void enable()}>
              {text.enable}
            </Button>
          ) : null}
        </EnterpriseModalDialog>
      ) : null}
    </>
  )
}
