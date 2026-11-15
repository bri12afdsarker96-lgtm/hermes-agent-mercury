import { randomUUID } from 'node:crypto'

import { isShopBrowserUrl } from './shop-browser-types'

export interface ShopExecutionPage {
  url(): string
  identify(): Promise<{ shopId: string; shopName: string } | null>
  command(method: string, params: Record<string, unknown>): Promise<unknown>
  close(): Promise<void>
}

export interface ShopExecutionTransport {
  identify(): Promise<{ shopId: string; shopName: string } | null>
  command(targetId: string, method: string, params: Record<string, unknown>): Promise<unknown>
  close(): Promise<void>
}

export interface BoundShopExecution extends ShopExecutionTransport {
  connectionId: string
  profileId: string
  shopId: string
  shopName: string
  validate(): Promise<void>
}

const commands = new Set([
  'Runtime.evaluate',
  'Page.navigate',
  'Page.captureScreenshot',
  'Page.bringToFront',
  'Input.dispatchMouseEvent',
  'Input.dispatchKeyEvent',
  'Input.insertText'
])

/** One TD task can address only the pages created from its bound shop session. */
export async function createShopExecutionTransport(
  url: string,
  createPage: (url: string) => Promise<ShopExecutionPage>,
  isCurrent: () => boolean
): Promise<ShopExecutionTransport> {
  const pages = new Map<string, ShopExecutionPage>()
  let closed = false
  let creating = 0

  const current = () => {
    if (closed || !isCurrent()) {
      throw new Error('SHOP_PROFILE_OWNER_CHANGED')
    }
  }

  const makePage = async (target: string) => {
    current()

    if (!isShopBrowserUrl(target)) {
      throw new Error('SHOP_BROWSER_URL_REJECTED')
    }
    const page = await createPage(target)

    try {
      current()
    } catch (error) {
      await page.close()
      throw error
    }

    return page
  }

  pages.set('root', await makePage(url))

  const close = async () => {
    if (closed) {
      return
    }
    closed = true
    const owned = [...pages.values()]
    pages.clear()
    await Promise.all(owned.map(page => page.close()))
  }

  return {
    async identify() {
      current()
      const identity = await pages.get('root')!.identify()
      current()

      return identity
    },
    async command(targetId, method, params) {
      current()

      if (!params || typeof params !== 'object' || Array.isArray(params)) {
        throw new Error('SHOP_BROWSER_INVALID_COMMAND')
      }
      const page = pages.get(targetId)

      if (!page) {
        throw new Error('SHOP_BROWSER_TARGET_NOT_FOUND')
      }

      if (method === 'Target.createTarget') {
        if (pages.size + creating >= 9 || typeof params.url !== 'string') {
          throw new Error('SHOP_BROWSER_TARGET_LIMIT')
        }
        creating++

        try {
          const child = await makePage(params.url)
          const id = randomUUID().replaceAll('-', '')
          pages.set(id, child)

          return { targetId: id }
        } finally {
          creating--
        }
      }

      if (method === 'Target.closeTarget') {
        const id = params.targetId

        if (typeof id !== 'string' || !pages.has(id)) {
          throw new Error('SHOP_BROWSER_TARGET_NOT_FOUND')
        }

        if (id === 'root') {
          await close()
        } else {
          const child = pages.get(id)!
          pages.delete(id)
          await child.close()
        }

        return { success: true }
      }

      if (!commands.has(method)) {
        throw new Error('SHOP_BROWSER_COMMAND_REJECTED')
      }

      if (!isShopBrowserUrl(page.url())) {
        throw new Error('SHOP_PROFILE_PAGE_NOT_READY')
      }

      if (method === 'Page.navigate' && (typeof params.url !== 'string' || !isShopBrowserUrl(params.url))) {
        throw new Error('SHOP_BROWSER_URL_REJECTED')
      }

      if (
        method === 'Runtime.evaluate' &&
        (typeof params.expression !== 'string' ||
          params.expression.length > 2_000_000 ||
          params.returnByValue !== true ||
          params.awaitPromise !== true)
      ) {
        throw new Error('SHOP_BROWSER_INVALID_COMMAND')
      }

      // Hidden capture pages do not take focus from the enterprise workbench.
      if (method === 'Page.bringToFront') {
        return {}
      }
      const result = await page.command(method, params)
      current()

      return result
    },
    close
  }
}
