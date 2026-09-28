import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LoginCredentials } from './login-credentials'

describe('login credential delivery', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('copies only the chosen login fields and preserves actual newlines', async () => {
    const writeText = vi.fn(async () => undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    render(<LoginCredentials login="test.employee" password="synthetic-password" hideLabel="隐藏" onHide={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: '复制账号' }))
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith('test.employee'))
    fireEvent.click(screen.getByRole('button', { name: '复制密码' }))
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith('synthetic-password'))
    fireEvent.click(screen.getByRole('button', { name: '复制账号和密码' }))
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith('账号：test.employee\n初始密码：synthetic-password\n首次登录请修改初始密码。'))
  })
  it('reports clipboard failure without discarding the displayed credential', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(async () => { throw new Error('denied') }) } })
    render(<LoginCredentials login="test.employee" password="synthetic-password" hideLabel="隐藏" onHide={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: '复制账号和密码' }))
    expect(await screen.findByText('复制失败，请选中文字后按 Ctrl+C')).toBeTruthy()
    expect(screen.getByText('初始密码：synthetic-password').classList.contains('hesc-selectable')).toBe(true)
  })
})
