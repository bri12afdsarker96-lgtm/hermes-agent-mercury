import { useEffect, useState } from 'react'

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
type LoadState = 'error' | 'loading' | 'ready' | 'unavailable'

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
  const [selectedCollection, setSelectedCollection] = useState<string | null>(null)

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
    void runtime
      .get<CollectionsResponse>('/api/knowledge-committed')
      .then(response => {
        if (!active) {
          return
        }

        const nextCollections = response.collections ?? []
        setCollections(nextCollections)
        setSelectedCollection(current =>
          current && nextCollections.includes(current) ? current : (nextCollections[0] ?? null)
        )
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
  }, [runtime])

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
