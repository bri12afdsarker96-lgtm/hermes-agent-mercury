export type BrowserNotificationPermission = NotificationPermission | 'unsupported'

export function browserNotificationPermission(): BrowserNotificationPermission {
  return window.isSecureContext && 'Notification' in window ? Notification.permission : 'unsupported'
}

export async function requestBrowserNotificationPermission(): Promise<BrowserNotificationPermission> {
  const permission = browserNotificationPermission()
  // Only called from an explicit settings button, never from reminder polling.
  return permission === 'default' ? Notification.requestPermission() : permission
}

export async function notifyInBrowser({
  title,
  body,
  tag,
  silent
}: {
  title: string
  body?: string
  tag?: string
  silent?: boolean
}): Promise<boolean> {
  if (browserNotificationPermission() !== 'granted') {
    return false
  }
  try {
    const notification = new Notification(title, { body, tag, silent })
    notification.onclick = () => {
      window.focus()
      notification.close()
    }
    return true
  } catch {
    // Permission/OS/browser restrictions must not break in-page reminders or MP3.
    return false
  }
}
