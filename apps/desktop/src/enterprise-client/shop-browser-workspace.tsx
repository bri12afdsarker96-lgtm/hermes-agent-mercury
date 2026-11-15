import './shop-browser-workspace.css'

import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useI18n } from '@/i18n/context'
import { shopBrowserWorkspaceCopy } from '@/i18n/shop-browser-workspace'
import {
  ArrowUpRight,
  Bookmark,
  BookmarkFilled,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  Globe,
  LayoutDashboard,
  Plus,
  RefreshCw,
  X
} from '@/lib/icons'

import type { ShopBrowserRequest } from '../../electron/shop-browser-types'
import type {
  NativeBookmarkItem,
  ShopBookmarkCommand,
  ShopBookmarkSnapshot,
  ShopBrowserCommand,
  ShopBrowserSnapshot
} from '../../electron/shop-browser-workspace-types'

import type { EnterpriseClientRuntime } from './runtime'

interface Props {
  runtime: EnterpriseClientRuntime
  profileId: string
  shopVerified: boolean
  viewportRef: RefObject<HTMLDivElement | null>
  onClosed(): void
}

export function ShopBrowserWorkspacePanel({ runtime, profileId, shopVerified, viewportRef, onClosed }: Props) {
  const { locale } = useI18n()
  const copy = shopBrowserWorkspaceCopy[locale]
  const [snapshot, setSnapshot] = useState<ShopBrowserSnapshot>()
  const [bookmarks, setBookmarks] = useState<ShopBookmarkSnapshot>()
  const [address, setAddress] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [folderOpen, setFolderOpen] = useState<string | null>(null)
  const [contextOpen, setContextOpen] = useState(false)
  const [nameEditor, setNameEditor] = useState<{ id?: string; value: string } | null>(null)
  const [deleting, setDeleting] = useState<NativeBookmarkItem | null>(null)
  const [evidenceOpen, setEvidenceOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [sideWidth, setSideWidth] = useState(320)
  const [dragging, setDragging] = useState(false)
  const [externalDialogOpen, setExternalDialogOpen] = useState(false)
  const workspace = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; width: number } | null>(null)
  const lifecycle = useMemo(() => ({ runtime, profileId, alive: true, busy: false }), [runtime, profileId])
  const active = snapshot?.tabs.find(tab => tab.id === snapshot.activeTabId)

  const overlayOpen =
    contextOpen || !!folderOpen || !!nameEditor || !!deleting || evidenceOpen || dragging || externalDialogOpen

  const send = useCallback(
    async (request: Omit<ShopBrowserRequest, 'sessionId' | 'profileId'>) => {
      const reply = await lifecycle.runtime.shopBrowser!({ ...request, profileId: lifecycle.profileId })

      if (!lifecycle.alive) {
        return undefined
      }

      if (!reply.ok) {
        if (/OWNER_CHANGED|ACCESS_UNAVAILABLE|FORBIDDEN|PROFILE_NOT_FOUND/.test(reply.error ?? '')) {
          setSnapshot(undefined)
          setBookmarks(undefined)
          onClosed()
        }

        throw new Error(reply.error)
      }

      if (reply.browser) {
        setSnapshot(reply.browser)
      }

      if (reply.bookmarks) {
        setBookmarks(reply.bookmarks)
      }

      if (reply.openProfileId === null) {
        onClosed()
      }

      return reply
    },
    [lifecycle, onClosed]
  )

  const run = useCallback(
    async (operation: () => Promise<unknown>) => {
      if (lifecycle.busy) {
        return
      }

      lifecycle.busy = true
      setBusy(true)
      setError('')

      try {
        await operation()
      } catch (reason) {
        if (lifecycle.alive) {
          setError(reason instanceof Error ? reason.message : 'SHOP_BROWSER_FAILED')
        }
      } finally {
        lifecycle.busy = false

        if (lifecycle.alive) {
          setBusy(false)
        }
      }
    },
    [lifecycle]
  )

  const browser = useCallback((command: ShopBrowserCommand) => send({ action: 'browser', browser: command }), [send])

  const mutate = async (command: ShopBookmarkCommand) => {
    const reply = await send({ action: 'bookmarks', bookmark: command, expectedRevision: bookmarks?.revision })

    return reply
  }

  useEffect(() => {
    const update = () =>
      setExternalDialogOpen(!!document.querySelector('[role="dialog"][data-state="open"], [aria-modal="true"]'))

    const observer = new MutationObserver(update)
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-state', 'aria-modal']
    })
    update()

    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    lifecycle.alive = true
    void run(async () => {
      await browser({ action: 'state' })
      await send({ action: 'bookmarks', bookmark: { action: 'list' } })
    })

    const timer = setInterval(() => {
      if (!lifecycle.busy) {
        void run(() => browser({ action: 'state' }))
      }
    }, 2500)

    return () => {
      lifecycle.alive = false
      clearInterval(timer)
    }
  }, [lifecycle, browser, run, send])

  useEffect(() => {
    setAddress(active?.url === 'about:blank' ? '' : (active?.url ?? ''))
  }, [active?.id, active?.url])

  useEffect(() => {
    void browser({ action: 'suspend', value: overlayOpen }).catch(reason => {
      if (lifecycle.alive) {
        setError(reason instanceof Error ? reason.message : 'SHOP_BROWSER_FAILED')
      }
    })
  }, [overlayOpen, browser, lifecycle])

  const finishDrag = useCallback(() => {
    drag.current = null
    setDragging(false)
  }, [])

  useEffect(() => {
    if (!dragging) {
      return
    }

    const move = (event: PointerEvent) => {
      if (!drag.current || collapsed) {
        return
      }

      const width = drag.current.width + drag.current.x - event.clientX
      const max = Math.max((workspace.current?.clientWidth ?? 0) * 0.6, 320)

      if (width >= 260 && width <= max) {
        setSideWidth(width)
      }
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finishDrag)
    window.addEventListener('pointercancel', finishDrag)
    window.addEventListener('blur', finishDrag)

    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finishDrag)
      window.removeEventListener('pointercancel', finishDrag)
      window.removeEventListener('blur', finishDrag)
    }
  }, [dragging, collapsed, finishDrag])

  const bookmarked =
    !!active &&
    bookmarks?.items.flatMap(item => (item.IsFolder ? item.Children : [item])).some(item => item.Url === active.url)

  const folders = bookmarks?.items.filter(item => item.IsFolder) ?? []

  const displayTitle = (item: NativeBookmarkItem, length: number) => {
    const value = item.Title || copy.noTitle

    return value.length > length ? `${value.slice(0, length)}...` : value
  }

  const openBookmark = (item: NativeBookmarkItem) => {
    setFolderOpen(null)
    void run(() => browser({ action: 'navigate', url: item.Url }))
  }

  const removeItem = (item: NativeBookmarkItem) => {
    if (item.IsFolder && item.Children.length) {
      setDeleting(item)
    } else {
      void run(() => mutate({ action: 'delete', id: item.Id }))
    }
  }

  const saveName = () => {
    if (!nameEditor) {
      return
    }

    const editor = nameEditor
    setNameEditor(null)

    const command: ShopBookmarkCommand = editor.id
      ? { action: 'rename-folder', id: editor.id, title: editor.value }
      : { action: 'create-folder', title: editor.value }

    void run(() => mutate(command))
  }

  return (
    <section aria-label={copy.browser} className="shop-native-browser" data-testid="shop-browser-workspace">
      <div aria-label={copy.tabs} className="shop-browser-tabs" role="tablist">
        {snapshot?.tabs.map(tab => (
          <div className="shop-browser-tab" data-active={tab.id === snapshot.activeTabId} key={tab.id}>
            <button
              aria-selected={tab.id === snapshot.activeTabId}
              disabled={busy}
              onClick={() => void run(() => browser({ action: 'switch', tabId: tab.id }))}
              role="tab"
              type="button"
            >
              {tab.title || copy.untitled}
            </button>
            <button
              aria-label={`${copy.closeTab} ${tab.title || copy.untitled}`}
              disabled={busy}
              onClick={() => void run(() => browser({ action: 'close', tabId: tab.id }))}
              type="button"
            >
              <X aria-hidden="true" />
            </button>
          </div>
        ))}
        <button
          aria-label={copy.newTab}
          className="shop-browser-new-tab"
          disabled={busy}
          onClick={() => void run(() => browser({ action: 'new' }))}
          type="button"
        >
          <Plus aria-hidden="true" />
        </button>
      </div>
      <form
        className="shop-browser-toolbar"
        onSubmit={event => {
          event.preventDefault()
          void run(() => browser({ action: 'navigate', url: address }))
        }}
      >
        <button
          aria-label={copy.back}
          disabled={busy || !active?.canGoBack}
          onClick={() => void run(() => browser({ action: 'back' }))}
          type="button"
        >
          <ChevronLeft aria-hidden="true" />
        </button>
        <button
          aria-label={copy.forward}
          disabled={busy || !active?.canGoForward}
          onClick={() => void run(() => browser({ action: 'forward' }))}
          type="button"
        >
          <ChevronRight aria-hidden="true" />
        </button>
        <button
          aria-label={copy.reload}
          disabled={busy || !active}
          onClick={() => void run(() => browser({ action: 'reload' }))}
          type="button"
        >
          <RefreshCw aria-hidden="true" />
        </button>
        <button
          aria-label={copy.home}
          disabled={busy || !active}
          onClick={() => void run(() => browser({ action: 'home' }))}
          type="button"
        >
          <LayoutDashboard aria-hidden="true" />
        </button>
        <label className="shop-browser-address">
          <Globe aria-hidden="true" />
          <input aria-label={copy.address} onChange={event => setAddress(event.target.value)} value={address} />
        </label>
        <button
          aria-label={bookmarked ? copy.removeBookmark : copy.bookmark}
          className={bookmarked ? 'is-bookmarked' : ''}
          disabled={busy || !active?.url || !bookmarks}
          onClick={() =>
            void run(() => mutate({ action: 'toggle', url: active!.url, title: active!.title || copy.untitled }))
          }
          type="button"
        >
          {bookmarked ? <BookmarkFilled aria-hidden="true" /> : <Bookmark aria-hidden="true" />}
        </button>
        <button aria-label={copy.go} className="shop-browser-go" disabled={busy || !active} type="submit">
          <ArrowUpRight aria-hidden="true" />
        </button>
      </form>
      <div aria-label={copy.bookmarks} className="shop-browser-bookmarks">
        <button
          aria-label={copy.folder}
          className="shop-bookmark-new-folder"
          disabled={busy || !bookmarks}
          onClick={() => setNameEditor({ value: copy.defaultFolder })}
          type="button"
        >
          <FolderOpen aria-hidden="true" />
          <Plus aria-hidden="true" />
        </button>
        {!bookmarks?.items.length ? <span className="shop-bookmark-hint">{copy.bookmarkHint}</span> : null}
        {bookmarks?.items.map(item => (
          <ContextMenu key={item.Id} onOpenChange={setContextOpen}>
            <ContextMenuTrigger asChild>
              {item.IsFolder ? (
                <span>
                  <Popover onOpenChange={open => setFolderOpen(open ? item.Id : null)} open={folderOpen === item.Id}>
                    <PopoverTrigger asChild>
                      <button className="shop-bookmark-item shop-bookmark-folder" disabled={busy} type="button">
                        <FolderOpen aria-hidden="true" />
                        {displayTitle(item, 12)}
                        {item.Children.length ? <small> ({item.Children.length})</small> : null}
                        <ChevronDown aria-hidden="true" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="shop-bookmark-popup" sideOffset={0}>
                      {item.Children.length ? (
                        item.Children.map(child => (
                          <button
                            className="shop-bookmark-child"
                            key={child.Id}
                            onClick={() => openBookmark(child)}
                            type="button"
                          >
                            {displayTitle(child, 25)}
                          </button>
                        ))
                      ) : (
                        <p>{copy.folderEmpty}</p>
                      )}
                    </PopoverContent>
                  </Popover>
                </span>
              ) : (
                <button className="shop-bookmark-item" disabled={busy} onClick={() => openBookmark(item)} type="button">
                  <Bookmark aria-hidden="true" />
                  {displayTitle(item, 15)}
                </button>
              )}
            </ContextMenuTrigger>
            <ContextMenuContent className="shop-bookmark-menu">
              {item.IsFolder ? (
                <>
                  <ContextMenuItem onSelect={() => setNameEditor({ id: item.Id, value: item.Title })}>
                    {copy.rename}
                  </ContextMenuItem>
                  <ContextMenuItem onSelect={() => removeItem(item)}>{copy.deleteFolder}</ContextMenuItem>
                </>
              ) : (
                <>
                  {folders.length ? (
                    <>
                      <ContextMenuSub>
                        <ContextMenuSubTrigger>{copy.move}</ContextMenuSubTrigger>
                        <ContextMenuSubContent className="shop-bookmark-menu">
                          {folders.map(folder => (
                            <ContextMenuItem
                              key={folder.Id}
                              onSelect={() =>
                                void run(() => mutate({ action: 'move', id: item.Id, folderId: folder.Id }))
                              }
                            >
                              {folder.Title}
                            </ContextMenuItem>
                          ))}
                        </ContextMenuSubContent>
                      </ContextMenuSub>
                      <ContextMenuSeparator />
                    </>
                  ) : null}
                  <ContextMenuItem onSelect={() => removeItem(item)}>{copy.deleteBookmark}</ContextMenuItem>
                </>
              )}
            </ContextMenuContent>
          </ContextMenu>
        ))}
      </div>
      {error || snapshot?.error ? (
        <div className="shop-browser-error" role="alert">
          {copy.failed} ({error || snapshot?.error}){' '}
          <button
            onClick={() => void run(() => send({ action: 'bookmarks', bookmark: { action: 'list' } }))}
            type="button"
          >
            {copy.reload}
          </button>
        </div>
      ) : null}
      <div
        aria-label={active?.loading ? copy.loading : copy.ready}
        className="shop-browser-loading"
        data-loading={active?.loading}
        role="status"
      />
      <div
        className={`shop-browser-content ${collapsed ? 'is-collapsed' : ''}`}
        data-dragging={dragging}
        ref={workspace}
        style={{
          gridTemplateColumns: shopVerified ? `minmax(0, 1fr) ${collapsed ? 44 : sideWidth}px` : 'minmax(0, 1fr)'
        }}
      >
        <div aria-label={copy.browser} className="shop-browser-viewport" ref={viewportRef} />
        {shopVerified ? (
          <aside className="shop-browser-sidebar">
            <div
              aria-label={copy.resize}
              aria-orientation="vertical"
              aria-valuenow={sideWidth}
              className="shop-browser-resizer"
              onPointerDown={event => {
                event.preventDefault()
                drag.current = { x: event.clientX, width: sideWidth }
                setDragging(true)
              }}
              role="separator"
            />
            <div className="shop-browser-sidebar-body">
              <header>
                <div>
                  <strong>{copy.pending}</strong>
                  <small>{copy.pendingUnavailable}</small>
                </div>
                <button aria-label={copy.pendingRefresh} disabled type="button">
                  <RefreshCw aria-hidden="true" />
                </button>
                <button
                  aria-label={collapsed ? copy.expand : copy.collapse}
                  onClick={() => setCollapsed(value => !value)}
                  type="button"
                >
                  {collapsed ? <ChevronLeft aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
                </button>
              </header>
              <p className="shop-browser-pending-empty">{copy.pendingEvidence}</p>
              <footer>
                <i />
                {copy.ready}
              </footer>
            </div>
          </aside>
        ) : null}
      </div>
      <div className="shop-browser-local-status">
        <span>{copy.localScope}</span>
        <button onClick={() => setEvidenceOpen(true)} type="button">
          {copy.evidence}
        </button>
      </div>
      <Dialog
        onOpenChange={open => {
          if (!open) {
            setNameEditor(null)
          }
        }}
        open={!!nameEditor}
      >
        <DialogContent
          bodyClassName="shop-bookmark-name-body"
          className="shop-bookmark-name-dialog"
          onOpenAutoFocus={event => {
            event.preventDefault()
            requestAnimationFrame(() => {
              const input = document.querySelector<HTMLInputElement>('[data-bookmark-name]')
              input?.focus()
              input?.select()
            })
          }}
          showCloseButton={false}
        >
          <DialogTitle>{nameEditor?.id ? copy.renameFolder : copy.folder}</DialogTitle>
          <DialogDescription className="sr-only">{copy.folderName}</DialogDescription>
          <form
            onSubmit={event => {
              event.preventDefault()
              saveName()
            }}
          >
            <Input
              aria-label={copy.folderName}
              data-bookmark-name
              onChange={event => setNameEditor(current => (current ? { ...current, value: event.target.value } : null))}
              value={nameEditor?.value ?? ''}
            />
            <div>
              <Button onClick={() => setNameEditor(null)} type="button" variant="secondary">
                {copy.cancel}
              </Button>
              <Button type="submit">{copy.confirm}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        onOpenChange={open => {
          if (!open) {
            setDeleting(null)
          }
        }}
        open={!!deleting}
      >
        <DialogContent className="shop-bookmark-delete-dialog">
          <DialogTitle>{copy.confirmDelete}</DialogTitle>
          <DialogDescription>
            {copy.folderDeleteMessage
              .replace('{name}', deleting?.Title ?? '')
              .replace('{count}', String(deleting?.Children.length ?? 0))}
          </DialogDescription>
          <div className="shop-bookmark-dialog-actions">
            <Button onClick={() => setDeleting(null)} variant="secondary">
              {copy.cancel}
            </Button>
            <Button
              onClick={() => {
                const item = deleting
                setDeleting(null)

                if (item) {
                  void run(() => mutate({ action: 'delete', id: item.Id, confirmed: true }))
                }
              }}
            >
              {copy.confirmDelete}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog onOpenChange={setEvidenceOpen} open={evidenceOpen}>
        <DialogContent className="shop-bookmark-delete-dialog">
          <DialogTitle>{copy.evidence}</DialogTitle>
          <DialogDescription>{copy.evidenceText}</DialogDescription>
        </DialogContent>
      </Dialog>
    </section>
  )
}
