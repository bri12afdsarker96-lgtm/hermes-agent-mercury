import { useCallback, useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader } from '@/components/ui/loader'
import { LogView } from '@/components/ui/log-view'
import { useI18n } from '@/i18n/context'
import { FolderOpen, LogIn, Play, RefreshCw, Square } from '@/lib/icons'

import type { DoudianReply, DoudianRequest, DoudianShop, DoudianTask } from '../../electron/doudian-types'

import { useDoudianEntryCopy } from './doudian-entry-copy'
import { DoudianShopManagement } from './doudian-shop-management'
import { authorizationErrors, DoudianEntryStatus } from './doudian-entry-state'
import type { EnterpriseClientRuntime } from './runtime'

interface Props {
  runtime: EnterpriseClientRuntime
  standalone?: boolean
}
const active = (task: DoudianTask | undefined) => !!task && ['preparing', 'running', 'stopping'].includes(task.state)

export function DoudianWorkbench({ runtime, standalone = false }: Props) {
  const { t } = useI18n()
  const entry = useDoudianEntryCopy()
  const copy = t.doudian
  const [capabilities, setCapabilities] = useState<DoudianReply['capabilities']>()
  const [shops, setShops] = useState<DoudianShop[]>([])
  const [shopId, setShopId] = useState('')
  const [workbook, setWorkbook] = useState<DoudianReply['workbook']>()
  const [task, setTask] = useState<DoudianTask>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [unknown, setUnknown] = useState(false)
  const [startRow, setStartRow] = useState('2')
  const [maxRows, setMaxRows] = useState('0')
  const [concurrency, setConcurrency] = useState('1')
  const [optionsChanged, setOptionsChanged] = useState(false)
  const [managingShops, setManagingShops] = useState(false)
  const lifecycle = useMemo(() => ({ runtime, alive: true, inFlight: false }), [runtime])
  const [owner, setOwner] = useState(runtime)
  const service = runtime.doudian
  const locked = managingShops || busy || active(task) || task?.state === 'awaiting_confirmation' || unknown
  const optionsSupported = capabilities?.reviewOptions === 1
  const validRange = /^\d+$/.test(startRow) && Number(startRow) >= 1 && Number(startRow) <= 1000000 &&
    /^\d+$/.test(maxRows) && Number(maxRows) <= 1000000

  const errorText = (code: string) =>
    ({
      DOUDIAN_MODULE_MISSING: copy.moduleMissing,
      DOUDIAN_MODULE_INVALID: copy.moduleInvalid,
      DOUDIAN_WINDOWS_REQUIRED: copy.windowsOnly,
      DOUDIAN_FORBIDDEN: copy.forbidden,
      DOUDIAN_OWNER_CHANGED: copy.ownerChanged,
      DOUDIAN_HOST_LOST: copy.hostLost,
      DOUDIAN_RESULT_UNKNOWN: copy.resultUnknown,
      LICENSE_REQUIRED: copy.licenseRequired,
      TASK_BUSY: copy.busy,
      WORKBOOK_BUSY: copy.workbookBusy,
      REVIEW_OPTIONS_UNSUPPORTED: entry.rangeReason,
      INVALID_RANGE: entry.invalidRange
    })[code] ?? `${copy.failed}: ${code}`

  const call = useCallback(
    async (request: Omit<DoudianRequest, 'sessionId'>) => {
      if (!service) {
        return undefined
      }

      const reply = await service(request)

      if (!lifecycle.alive) {
        return undefined
      }

      if (standalone && request.action === 'capabilities' && reply.ok &&
        (!reply.capabilities || reply.capabilities.protocol !== 1 || typeof reply.capabilities.authorized !== 'boolean')) {
        setError('DOUDIAN_PROTOCOL_ERROR')

        return undefined
      }

      if (!reply.ok) {
        setError(reply.error ?? 'DOUDIAN_FAILED')

        if (['DOUDIAN_HOST_LOST', 'DOUDIAN_RESULT_UNKNOWN'].includes(reply.error ?? '')) {
          setUnknown(true)
        }

        return undefined
      }

      if (reply.task) {
        setTask(reply.task)
        setUnknown(false)
      }

      return reply
    },
    [service, lifecycle, standalone]
  )

  const refresh = useCallback(async () => {
    const result = await call({ action: 'capabilities' })

    if (!result) {
      return
    }

    setCapabilities(result.capabilities)
    const status = await call({ action: 'status' })

    if (status) {
      setError('')
    }

    if (result.capabilities?.authorized) {
      const result = await call({ action: 'shops' })

      if (result) {
        const next = result.shops ?? []
        setShops(next)
        setShopId(previous => (next.some(shop => shop.id === previous) ? previous : ''))
      }
    }
  }, [call])

  const action = useCallback(
    async (run: () => Promise<unknown>) => {
      if (lifecycle.inFlight) {
        return
      }

      lifecycle.inFlight = true
      setBusy(true)
      setError('')

      try {
        await run()
      } catch {
        if (lifecycle.alive) {
          setError('DOUDIAN_RESULT_UNKNOWN')
          setUnknown(true)
        }
      } finally {
        lifecycle.inFlight = false

        if (lifecycle.alive) {
          setBusy(false)
        }
      }
    },
    [lifecycle]
  )

  useEffect(() => {
    lifecycle.alive = true
    setCapabilities(undefined)
    setShops([])
    setShopId('')
    setWorkbook(undefined)
    setTask(undefined)
    setUnknown(false)
    setStartRow('2')
    setMaxRows('0')
    setConcurrency('1')
    setOptionsChanged(false)
    setManagingShops(false)
    setOwner(runtime)
    void action(refresh)

    return () => {
      lifecycle.alive = false
    }
  }, [runtime, lifecycle, action, refresh]) // Main owns task lifetime; navigation only stops polling.
  const taskActive = active(task)
  useEffect(() => {
    if (!taskActive && !unknown) {
      return
    }

    const timer = setInterval(() => {
      if (!lifecycle.inFlight) {
        void action(async () => {
          await call({ action: 'status' })
        })
      }
    }, 3000)

    return () => clearInterval(timer)
  }, [taskActive, unknown, lifecycle, action, call])

  if (!service) {
    if (standalone) {return <DoudianEntryStatus reason={entry.noBridge} state="host-missing" />}

    return <p role="status">{copy.desktopOnly}</p>
  }

  if (owner !== runtime) {
    return <Loader />
  }

  if (standalone && !capabilities) {
    return <DoudianEntryStatus reason={error ? errorText(error) : ''} state={error ? (authorizationErrors.includes(error) ? 'unauthorized' : 'host-missing') : 'checking'} />
  }

  if (standalone && authorizationErrors.includes(error)) {
    return <DoudianEntryStatus reason={errorText(error)} state="unauthorized" />
  }

  if (standalone && (capabilities?.protocol !== 1 || typeof capabilities.authorized !== 'boolean')) {
    return <DoudianEntryStatus reason={entry.invalid} state="host-missing" />
  }

  return (
    <div className="space-y-4" data-testid="doudian-workbench">
      {standalone ? <>
        {!task || task.state === 'idle' ? <DoudianEntryStatus state={capabilities?.authorized ? 'idle' : 'unauthorized'} /> : null}
        <div aria-label={entry.results} className="flex flex-wrap gap-4">
          <span>{entry.currentRow}: {entry.notProvided}</span>
          <span>{entry.failedCount}: {entry.notProvided}</span>
        </div>
      </> : null}
      <fieldset className="flex flex-wrap gap-4" disabled={locked || !optionsSupported}>
        <legend>{entry.range}</legend>
        <label>{entry.startRow}<Input max={1000000} min={1} onChange={event => { setStartRow(event.target.value); setOptionsChanged(true) }} type="number" value={startRow} /></label>
        <label>{entry.maxRows}<Input max={1000000} min={0} onChange={event => { setMaxRows(event.target.value); setOptionsChanged(true) }} type="number" value={maxRows} /></label>
        <label>{entry.concurrency}<select className="block border border-(--ui-stroke-tertiary) bg-(--ui-bg-quaternary) p-2" onChange={event => { setConcurrency(event.target.value); setOptionsChanged(true) }} value={concurrency}>
          {[1, 2, 4, 8].map(value => <option key={value} value={value}>{value}</option>)}
        </select></label>
      </fieldset>
      {capabilities && !optionsSupported ? <p role="status">{entry.rangeReason}</p> : null}
      {optionsSupported && !validRange ? <p role="alert">{entry.invalidRange}</p> : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={busy} onClick={() => void action(refresh)} variant="secondary">
          <RefreshCw />
          {copy.refresh}
        </Button>
        <Button
          disabled={locked || !capabilities?.authorized || capabilities.shopManagement !== 1}
          onClick={() => setManagingShops(value => !value)}
          variant="secondary"
        >
          <LogIn />
          {copy.manageShops}
        </Button>
        {busy ? <Loader /> : null}
        {capabilities ? (
          <span>
            {copy.moduleVersion} {capabilities.version}
          </span>
        ) : null}
      </div>
      {managingShops ? <DoudianShopManagement onChanged={refresh} onClose={() => setManagingShops(false)} operationsSupported={capabilities?.shopOperations === 1} runtime={runtime} /> : null}
      {error ? (
        <p className="text-(--ui-text-primary)" role="alert">
          {errorText(error)}
        </p>
      ) : null}
      {capabilities && !capabilities.authorized ? <p role="status">{copy.licenseRequired}</p> : null}
      {capabilities && (!capabilities.chrome || !capabilities.spreadsheet) ? (
        <p role="status">{copy.dependenciesMissing}</p>
      ) : null}
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex min-w-48 max-w-full flex-col gap-2">
          {copy.shop}
          <select
            aria-label={copy.shop}
            className="max-w-full border border-(--ui-stroke-tertiary) bg-(--ui-bg-quaternary) p-2"
            disabled={locked}
            onChange={event => setShopId(event.target.value)}
            value={shopId}
          >
            <option value="">{copy.selectShop}</option>
            {shops.map(shop => (
              <option key={shop.id} value={shop.id}>
                {shop.name} ({shop.platformId})
              </option>
            ))}
          </select>
        </label>
        <Button
          disabled={locked || !capabilities?.authorized}
          onClick={() =>
            void action(async () => {
              const reply = await call({ action: 'chooseWorkbook' })

              if (reply?.workbook) {
                setWorkbook(reply.workbook)
              }
            })
          }
          variant="secondary"
        >
          <FolderOpen />
          {copy.chooseWorkbook}
        </Button>
        <span className="min-w-0 break-all">{workbook?.name ?? copy.noWorkbook}</span>
        <Button
          disabled={
            locked ||
            !shopId ||
            !workbook ||
            !capabilities?.chrome ||
            !capabilities.spreadsheet ||
            !capabilities.authorized ||
            (optionsSupported && !validRange)
          }
          onClick={() =>
            void action(async () => {
              if (!optionsSupported && optionsChanged) {
                setError('REVIEW_OPTIONS_UNSUPPORTED')
                return
              }
              await call({ action: 'prepare', shopId, workbookId: workbook!.id,
                ...(optionsSupported ? { startRow, maxRows, concurrency } : {}) })
            })
          }
        >
          <Play />
          {copy.prepare}
        </Button>
      </div>
      {task && task.state !== 'idle' ? (
        <section aria-label={copy.task} className="space-y-3 border-t border-(--ui-stroke-tertiary) pt-4">
          <div className="flex flex-wrap items-center gap-4" role="status">
            <span>{copy.states[unknown ? 'unknown' : task.state]}</span>
            <span>
              {copy.saved}: {task.saved}
            </span>
            {(active(task) || task.state === 'awaiting_confirmation' || unknown) && task.taskId ? (
              <Button
                disabled={busy || task.state === 'stopping'}
                onClick={() =>
                  void action(async () => {
                    await call({ action: 'stop', taskId: task.taskId! })
                  })
                }
                variant="secondary"
              >
                <Square />
                {copy.stop}
              </Button>
            ) : null}
          </div>
          {task.summary ? <p className="whitespace-pre-wrap break-words">{task.summary}</p> : null}
          {standalone && ['completed', 'stopped', 'failed'].includes(task.state) ? <p>{task.saved > 0 ? `${entry.written}: ${task.saved}。` : ''}{entry.resume}</p> : null}
          {task.state === 'awaiting_confirmation' && !unknown ? (
            <Button
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  await call({ action: 'start', taskId: task.taskId! })
                })
              }
            >
              <Play />
              {copy.confirmStart}
            </Button>
          ) : null}
          {task.error ? (
            <p className="break-words" role="alert">
              {task.error}
            </p>
          ) : null}
          {task.messages.length ? (
            <details>
              <summary>{copy.progress}</summary>
              <LogView className="max-h-64">{task.messages.join('\n')}</LogView>
            </details>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}
