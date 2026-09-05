import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { KnowledgePage } from './knowledge-page'
import type { EnterpriseClientRuntime } from './runtime'

describe('KnowledgePage', () => {
  it('reads committed collections and selected entries through the product runtime adapter', async () => {
    const get = vi.fn(async (path: string): Promise<unknown> => {
      if (path === '/api/knowledge-committed') {
        return { collections: ['policies'] }
      }

      if (path === '/api/knowledge-committed?collection=policies') {
        return { entries: [{ chunks: 12, source: 'policy-handbook.pdf' }] }
      }

      throw new Error(`unexpected path: ${path}`)
    })

    const runtime: EnterpriseClientRuntime = {
      disconnect: vi.fn(async () => undefined),
      get: get as unknown as EnterpriseClientRuntime['get']
    }

    render(<KnowledgePage runtime={runtime} />)

    expect((await screen.findByRole('button', { name: 'policies' })).getAttribute('aria-current')).toBe('true')
    expect((await screen.findByText('policy-handbook.pdf')).textContent).toBe('policy-handbook.pdf')
    expect(screen.getByText('12').textContent).toBe('12')
    expect(get).toHaveBeenCalledWith('/api/knowledge-committed')
    expect(get).toHaveBeenCalledWith('/api/knowledge-committed?collection=policies')
  })

  it('uploads and commits a knowledge file only through the fenced Desktop runtime', async () => {
    const get = vi.fn(async (path: string): Promise<unknown> => {
      if (path === '/api/knowledge-committed') {
        return { collections: [] }
      }

      throw new Error(`unexpected path: ${path}`)
    })

    const post = vi.fn(async (path: string): Promise<unknown> => {
      if (path === '/api/knowledge-commit') {
        return { status: 'committed' }
      }

      throw new Error(`unexpected path: ${path}`)
    })

    const upload = vi.fn(async (): Promise<unknown> => ({ filename: '员工手册.txt', upload_id: 'upload-1' }))

    const runtime: EnterpriseClientRuntime = {
      disconnect: vi.fn(async () => undefined),
      get: get as EnterpriseClientRuntime['get'],
      post: post as NonNullable<EnterpriseClientRuntime['post']>,
      upload: upload as NonNullable<EnterpriseClientRuntime['upload']>
    }

    const file = new File(['企业知识'], '员工手册.txt', { type: 'text/plain' })
    Object.defineProperty(file, 'arrayBuffer', {
      value: async () => new TextEncoder().encode('企业知识').buffer
    })

    render(<KnowledgePage runtime={runtime} />)
    await screen.findByText('服务端当前没有已提交的知识集合。')

    fireEvent.change(screen.getByPlaceholderText('例如：员工手册'), { target: { value: '员工手册' } })
    fireEvent.change(screen.getByLabelText('选择文件'), { target: { files: [file] } })
    fireEvent.click(screen.getByRole('button', { name: '上传并提交' }))

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1))
    expect(upload).toHaveBeenCalledWith('/api/knowledge-upload', expect.objectContaining({
      contentType: 'text/plain',
      filename: '员工手册.txt'
    }))
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/knowledge-commit', {
      collection: '员工手册',
      source: '员工手册.txt',
      upload_id: 'upload-1'
    }))
    expect(await screen.findByText(/已提交到知识集合/)).toBeTruthy()
  })
})
