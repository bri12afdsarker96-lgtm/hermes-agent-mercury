import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n/context'
import { AssistantReplyCard } from './assistant-reply-card'

describe('shared enterprise reply cards', () => {
  it('gives every answer one identical copy-only surface and copies only the selected answer', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(
      <I18nProvider initialLocale="zh" configClient={null}>
        <AssistantReplyCard text="主回复内容" />
        <AssistantReplyCard kind="follow_up" text="后续跟进内容" />
        <AssistantReplyCard kind="alternative_reply" text="备选回复内容" />
      </I18nProvider>
    )
    const primary = screen.getByRole('region', { name: '回答建议' })
    const followup = screen.getByRole('region', { name: '继续跟进话术' })
    const alternative = screen.getByRole('region', { name: '备选回答' })
    expect(primary.className).toBe(followup.className)
    expect(primary.className).toBe(alternative.className)
    expect(screen.queryByRole('button', { name: /Markdown/ })).toBeNull()
    for (const [card, text] of [
      [primary, '主回复内容'],
      [followup, '后续跟进内容'],
      [alternative, '备选回复内容']
    ] as const) {
      expect(within(card).getAllByRole('button')).toHaveLength(1)
      fireEvent.click(within(card).getByRole('button', { name: '点击复制' }))
      await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(text))
      expect(await within(card).findByRole('status')).toHaveProperty('textContent', '已复制')
    }
  })

  it('keeps the answer and offers manual copying when clipboard access fails', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn(async () => {
          throw new Error('denied')
        })
      }
    })
    render(
      <I18nProvider initialLocale="zh" configClient={null}>
        <AssistantReplyCard text="保留的回复" />
      </I18nProvider>
    )
    fireEvent.click(screen.getByRole('button', { name: '点击复制' }))
    expect(await screen.findByRole('status')).toHaveProperty('textContent', '复制失败，请选中文字后复制')
    expect(screen.getByText('保留的回复')).toBeTruthy()
  })

  it.each([
    ['en', 'Suggested reply', 'Copy reply'],
    ['ja', '回答案', 'コピー'],
    ['zh-hant', '回答建議', '點擊複製']
  ])('uses the %s locale for card heading and copy control', (locale, title, action) => {
    render(
      <I18nProvider initialLocale={locale} configClient={null}>
        <AssistantReplyCard text="reply" />
      </I18nProvider>
    )
    expect(screen.getByRole('region', { name: title })).toBeTruthy()
    expect(screen.getByRole('button', { name: action })).toBeTruthy()
  })
})
