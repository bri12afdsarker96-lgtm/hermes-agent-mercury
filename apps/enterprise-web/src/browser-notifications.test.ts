import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  browserNotificationPermission,
  notifyInBrowser,
  requestBrowserNotificationPermission
} from './browser-notifications'

let permission: NotificationPermission
const request = vi.fn(async () => {
  permission = 'granted'
  return permission
})
const create = vi.fn()
beforeEach(() => {
  permission = 'default'
  request.mockClear()
  create.mockReset()
  vi.stubGlobal('isSecureContext', true)
  vi.stubGlobal(
    'Notification',
    class {
      static get permission() {
        return permission
      }
      static requestPermission = request
      constructor(title: string, options: NotificationOptions) {
        create(title, options)
      }
    }
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
})

it('polling never requests permission; explicit authorization enables notification with original fields', async () => {
  const payload = { title: 'Hermes 待办', body: '请跟进', tag: 'task-1', silent: true }
  expect(await notifyInBrowser(payload)).toBe(false)
  expect(request).not.toHaveBeenCalled()
  expect(await requestBrowserNotificationPermission()).toBe('granted')
  expect(await notifyInBrowser(payload)).toBe(true)
  expect(create).toHaveBeenCalledWith(payload.title, { body: payload.body, tag: payload.tag, silent: true })
})
it('denied permission is not requested again', async () => {
  permission = 'denied'
  expect(await requestBrowserNotificationPermission()).toBe('denied')
  expect(await notifyInBrowser({ title: 'test' })).toBe(false)
  expect(request).not.toHaveBeenCalled()
})
it('unsupported/insecure contexts degrade without breaking page reminders', async () => {
  vi.stubGlobal('isSecureContext', false)
  expect(browserNotificationPermission()).toBe('unsupported')
  expect(await notifyInBrowser({ title: 'test' })).toBe(false)
})
it('a rejected native notification does not throw into reminder polling', async () => {
  permission = 'granted'
  create.mockImplementation(() => {
    throw new Error('platform unsupported')
  })
  expect(await notifyInBrowser({ title: 'test' })).toBe(false)
})
