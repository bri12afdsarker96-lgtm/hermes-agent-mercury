import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { WeComReminderPanel } from './wecom-reminder-panel'
import type { EnterpriseClientRuntime } from './runtime'

describe('WeComReminderPanel', () => {
  it('reads non-secret status and clears the webhook after a save', async () => {
    const get = vi.fn(async () => ({bot_webhook_configured: false, encryption_ready: true}))
    const post = vi.fn(async () => ({bot_webhook_configured: true, encryption_ready: true}))
    const runtime: EnterpriseClientRuntime = {
      disconnect: vi.fn(async () => undefined),
      get: get as EnterpriseClientRuntime['get'],
      post: post as NonNullable<EnterpriseClientRuntime['post']>
    }

    render(<WeComReminderPanel runtime={runtime} />)
    expect((await screen.findAllByText('未配置')).length).toBe(2)

    const input = screen.getByLabelText('机器人 Webhook')
    fireEvent.change(input, {target: {value: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=example'}})
    fireEvent.click(screen.getByRole('button', {name: '保存提醒机器人'}))

    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/wecom-bot-reminder', {
      bot_webhook_url: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=example'
    }))
    expect((input as HTMLInputElement).value).toBe('')
    expect(await screen.findByText('已配置')).toBeTruthy()
  })

  it('stores self-built-app credentials for owner-directed reminders without reading them back', async () => {
    const get = vi.fn(async (path: string) => path === '/api/wecom-config'
      ? {configured: false, encryption_ready: true}
      : {bot_webhook_configured: false, direct_reminder_configured: false, encryption_ready: true})
    const post = vi.fn(async () => ({configured: true, app_config_ref: 'reminder-app'}))
    const runtime = {get, post, disconnect: vi.fn()} as unknown as EnterpriseClientRuntime
    render(<WeComReminderPanel runtime={runtime} />)
    await screen.findByText('按创建成员直达提醒')
    fireEvent.change(screen.getByLabelText('应用标识'), {target: {value: 'reminder-app'}})
    fireEvent.change(screen.getByLabelText('企业 CorpId'), {target: {value: 'wwexample'}})
    fireEvent.change(screen.getByLabelText('应用 Secret'), {target: {value: 'secret'}})
    fireEvent.change(screen.getByLabelText('AgentId'), {target: {value: '1000002'}})
    fireEvent.change(screen.getByLabelText('回调 Token'), {target: {value: 'token'}})
    fireEvent.change(screen.getByLabelText('EncodingAESKey'), {target: {value: 'a'.repeat(43)}})
    fireEvent.click(screen.getByRole('button', {name: '保存直达提醒应用'}))

    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/wecom-config', {
      app_config_ref: 'reminder-app', corp_id: 'wwexample', corp_secret: 'secret', agent_id: '1000002',
      token: 'token', encoding_aes_key: 'a'.repeat(43)
    }))
    expect((screen.getByLabelText('应用 Secret') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('回调 Token') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('EncodingAESKey') as HTMLInputElement).value).toBe('')
  })
})
