import { useCallback, useEffect, useState } from 'react'

import { KnowledgeGapsPanel } from './knowledge-gaps-panel'
import type { EnterpriseClientRuntime } from './runtime'

interface CollectionsResponse {
  collections?: string[]
}
interface KnowledgeEntry {
  chunks?: number
  source?: string
}
interface EntriesResponse {
  entries?: KnowledgeEntry[]
}
interface KnowledgeUploadResponse {
  filename?: string
  upload_id?: string
}
type LoadState = 'error' | 'loading' | 'ready' | 'unavailable'

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024

function requestStateLabel(state: LoadState): string {
  if (state === 'loading') {
    return '正在读取'
  }

  if (state === 'error') {
    return '读取失败'
  }

  if (state === 'ready') {
    return '已连接'
  }

  return '等待企业服务连接'
}

export function KnowledgePage({ runtime }: { runtime: EnterpriseClientRuntime | null }) {
  const [collections, setCollections] = useState<string[]>([])
  const [collectionsState, setCollectionsState] = useState<LoadState>('unavailable')
  const [entries, setEntries] = useState<KnowledgeEntry[]>([])
  const [entriesState, setEntriesState] = useState<LoadState>('unavailable')
  const [error, setError] = useState<string | null>(null)
  const [collectionName, setCollectionName] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [selectedCollection, setSelectedCollection] = useState<string | null>(null)
  const [uploadNotice, setUploadNotice] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  const refreshCollections = useCallback(async () => {
    if (!runtime) {
      return
    }

    const response = await runtime.get<CollectionsResponse>('/api/knowledge-committed')
    const nextCollections = response.collections ?? []

    setCollections(nextCollections)
    setSelectedCollection(current =>
      current && nextCollections.includes(current) ? current : (nextCollections[0] ?? null)
    )
  }, [runtime])

  async function uploadKnowledge() {
    const collection = collectionName.trim()

    if (!runtime?.post || !runtime.upload || !selectedFile || !collection || uploading) {
      return
    }

    if (selectedFile.size > MAX_UPLOAD_BYTES) {
      setError('文件超过 50 MiB 上传上限，请拆分后再试')

      return
    }

    setError(null)
    setUploadNotice(null)
    setUploading(true)

    try {
      const uploaded = await runtime.upload<KnowledgeUploadResponse>('/api/knowledge-upload', {
        bytes: await selectedFile.arrayBuffer(),
        contentType: selectedFile.type || 'application/octet-stream',
        filename: selectedFile.name
      })

      const uploadId = uploaded.upload_id

      if (!uploadId) {
        throw new Error('服务端未返回知识上传标识')
      }

      await runtime.post('/api/knowledge-commit', {
        collection,
        source: uploaded.filename ?? selectedFile.name,
        upload_id: uploadId
      })
      await refreshCollections()
      setCollectionName('')
      setSelectedFile(null)
      setUploadNotice(`“${uploaded.filename ?? selectedFile.name}”已提交到知识集合“${collection}”。`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'knowledge upload failed')
    } finally {
      setUploading(false)
    }
  }

  useEffect(() => {
    let active = true

    if (!runtime) {
      setCollections([])
      setCollectionsState('unavailable')
      setSelectedCollection(null)

      return () => {
        active = false
      }
    }

    setCollectionsState('loading')
    setError(null)
    void refreshCollections()
      .then(() => {
        if (!active) {
          return
        }

        setCollectionsState('ready')
      })
      .catch(reason => {
        if (!active) {
          return
        }

        setCollections([])
        setSelectedCollection(null)
        setCollectionsState('error')
        setError(reason instanceof Error ? reason.message : 'cannot load knowledge collections')
      })

    return () => {
      active = false
    }
  }, [refreshCollections, runtime])

  useEffect(() => {
    let active = true

    if (!runtime || !selectedCollection) {
      setEntries([])
      setEntriesState('unavailable')

      return () => {
        active = false
      }
    }

    setEntries([])
    setEntriesState('loading')
    void runtime
      .get<EntriesResponse>(`/api/knowledge-committed?collection=${encodeURIComponent(selectedCollection)}`)
      .then(response => {
        if (!active) {
          return
        }

        setEntries(response.entries ?? [])
        setEntriesState('ready')
      })
      .catch(reason => {
        if (!active) {
          return
        }

        setEntries([])
        setEntriesState('error')
        setError(reason instanceof Error ? reason.message : 'cannot load knowledge entries')
      })

    return () => {
      active = false
    }
  }, [runtime, selectedCollection])

  return (
    <section className="hesc-page" data-testid="enterprise-client-knowledge">
      <header className="hesc-page-header">
        <div>
          <h1>知识空间</h1>
          <p>已提交的知识集合和来源条目直接来自 Hermes_AI，不展示本地样例库。</p>
        </div>
        <span
          className="hesc-status"
          data-tone={collectionsState === 'ready' ? 'success' : collectionsState === 'error' ? 'error' : 'warning'}
        >
          {requestStateLabel(collectionsState)}
        </span>
      </header>

      {error ? (
        <div className="hesc-error" role="status">
          <div>
            <strong>知识服务响应异常</strong>
            <span>{error}</span>
          </div>
        </div>
      ) : null}

      <article className="hesc-card">
        <h2 className="hesc-section-title">上传企业知识</h2>
        <p className="hesc-muted-copy">文件先在本企业边界内预览和入库；上传成功后才会提交到指定知识集合。</p>
        <form
          className="hesc-provisioning-form"
          onSubmit={event => {
            event.preventDefault()
            void uploadKnowledge()
          }}
        >
          <label>
            知识集合
            <input
              disabled={!runtime?.upload || !runtime?.post || uploading}
              onChange={event => setCollectionName(event.target.value)}
              placeholder="例如：员工手册"
              value={collectionName}
            />
          </label>
          <label>
            选择文件
            <input
              accept=".txt,.md,.pdf,.doc,.docx,.csv,.xlsx"
              disabled={!runtime?.upload || !runtime?.post || uploading}
              onChange={event => setSelectedFile(event.currentTarget.files?.[0] ?? null)}
              type="file"
            />
          </label>
          <button
            className="hesc-action"
            disabled={!collectionName.trim() || !selectedFile || !runtime?.upload || !runtime?.post || uploading}
            type="submit"
          >
            {uploading ? '正在上传并提交' : '上传并提交'}
          </button>
        </form>
        {uploadNotice ? <p className="hesc-provisioning-notice" role="status">{uploadNotice}</p> : null}
      </article>

      <div className="hesc-knowledge-layout">
        <aside aria-label="知识集合" className="hesc-card hesc-knowledge-collections">
          <h2 className="hesc-section-title">知识集合</h2>
          {collectionsState === 'loading' ? <p className="hesc-muted-copy">正在读取服务端集合…</p> : null}
          {collectionsState === 'ready' && collections.length === 0 ? (
            <p className="hesc-muted-copy">服务端当前没有已提交的知识集合。</p>
          ) : null}
          <div className="hesc-collection-list">
            {collections.map(collection => (
              <button
                aria-current={collection === selectedCollection ? 'true' : undefined}
                key={collection}
                onClick={() => setSelectedCollection(collection)}
                type="button"
              >
                {collection}
              </button>
            ))}
          </div>
        </aside>

        <article className="hesc-card hesc-knowledge-entries">
          <div className="hesc-section-heading">
            <h2 className="hesc-section-title">{selectedCollection ?? '选择一个知识集合'}</h2>
            <span
              className="hesc-status"
              data-tone={entriesState === 'ready' ? 'success' : entriesState === 'error' ? 'error' : 'warning'}
            >
              {requestStateLabel(entriesState)}
            </span>
          </div>
          {entriesState === 'loading' ? <p className="hesc-muted-copy">正在读取已提交来源…</p> : null}
          {entriesState === 'ready' && entries.length === 0 ? (
            <p className="hesc-muted-copy">该集合没有返回已提交来源。</p>
          ) : null}
          {entries.length > 0 ? (
            <div className="hesc-table-wrap">
              <table className="hesc-table">
                <thead>
                  <tr>
                    <th scope="col">来源</th>
                    <th scope="col">切片数</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry, index) => (
                    <tr key={`${entry.source ?? 'source'}-${index}`}>
                      <td>{entry.source ?? '服务端未提供来源标识'}</td>
                      <td>{entry.chunks ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </article>
      </div>

      <KnowledgeGapsPanel runtime={runtime} />
    </section>
  )
}
