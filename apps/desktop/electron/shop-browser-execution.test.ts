import { describe, expect, it, vi } from 'vitest'

import { createShopExecutionTransport } from './shop-browser-execution'

function fixture() {
  let current = true
  const pages: {
    url: () => string
    identify: ReturnType<typeof vi.fn>
    command: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
  }[] = []

  const create = vi.fn(async (url: string) => {
    const page = {
      url: () => url,
      identify: vi.fn(async () => ({ shopId: '123', shopName: 'Shop' })),
      command: vi.fn(async () => ({ data: 'capture' })),
      close: vi.fn(async () => {})
    }

    pages.push(page)

    return page
  })

  return {
    pages,
    create,
    current: () => current,
    revoke: () => {
      current = false
    }
  }
}

describe('TD bound shop browser transport', () => {
  it('uses only its own root and child pages and never brings a hidden page forward', async () => {
    const f = fixture()
    const browser = await createShopExecutionTransport('https://fxg.jinritemai.com/', f.create, f.current)
    const { targetId } = (await browser.command('root', 'Target.createTarget', {
      url: 'https://fxg.jinritemai.com/ffa/maftersale/comment'
    })) as { targetId: string }
    await browser.command(targetId, 'Page.captureScreenshot', { format: 'png' })
    expect(f.pages[0].command).not.toHaveBeenCalled()
    expect(f.pages[1].command).toHaveBeenCalledWith('Page.captureScreenshot', { format: 'png' })
    await browser.command(targetId, 'Page.bringToFront', {})
    expect(f.pages[1].command).toHaveBeenCalledTimes(1)
    await expect(browser.command('foreign-page', 'Page.captureScreenshot', {})).rejects.toThrow('TARGET_NOT_FOUND')
    await browser.command('root', 'Target.closeTarget', { targetId })
    expect(f.pages[1].close).toHaveBeenCalledOnce()
    await browser.close()
    expect(f.pages[0].close).toHaveBeenCalledOnce()
  })

  it('rejects external navigation, browser shutdown and cookie access', async () => {
    const f = fixture()
    const browser = await createShopExecutionTransport(
      'https://im.jinritemai.com/pc_seller_v2/main/workspace',
      f.create,
      f.current
    )

    for (const method of ['Browser.close', 'Network.getAllCookies', 'Target.getTargets', 'Storage.getCookies']) {
      await expect(browser.command('root', method, {})).rejects.toThrow('COMMAND_REJECTED')
    }

    await expect(browser.command('root', 'Page.navigate', { url: 'http://127.0.0.1/' })).rejects.toThrow('URL_REJECTED')
    await expect(browser.command('root', 'Target.createTarget', { url: 'file:///C:/secret' })).rejects.toThrow(
      'URL_REJECTED'
    )
    expect(f.create).toHaveBeenCalledTimes(1)
    expect(f.pages[0].command).not.toHaveBeenCalled()
    await browser.close()
  })

  it('rejects stale commands and discards a late result after authority changes', async () => {
    const f = fixture()
    const browser = await createShopExecutionTransport('https://fxg.jinritemai.com/', f.create, f.current)
    let finish!: (value: unknown) => void
    f.pages[0].command.mockImplementation(
      () =>
        new Promise(resolve => {
          finish = resolve
        })
    )
    const pending = browser.command('root', 'Runtime.evaluate', {
      expression: '1',
      awaitPromise: true,
      returnByValue: true
    })
    f.revoke()
    finish({ result: { value: 1 } })
    await expect(pending).rejects.toThrow('OWNER_CHANGED')
    await expect(browser.identify()).rejects.toThrow('OWNER_CHANGED')
    await browser.close()
  })

  it('counts pending page creations toward the concurrency bound', async () => {
    const f = fixture()
    const browser = await createShopExecutionTransport('https://fxg.jinritemai.com/', f.create, f.current)
    let release!: () => void
    const barrier = new Promise<void>(resolve => {
      release = resolve
    })
    const create = f.create.getMockImplementation()!
    f.create.mockImplementation(async url => {
      await barrier

      return create(url)
    })
    const pending = Array.from({ length: 8 }, () =>
      browser.command('root', 'Target.createTarget', { url: 'https://fxg.jinritemai.com/' })
    )
    await expect(
      browser.command('root', 'Target.createTarget', { url: 'https://fxg.jinritemai.com/' })
    ).rejects.toThrow('TARGET_LIMIT')
    release()
    await Promise.all(pending)
    expect(f.pages).toHaveLength(9)
    await browser.close()
    expect(f.pages.every(page => page.close.mock.calls.length === 1)).toBe(true)
  })
})
