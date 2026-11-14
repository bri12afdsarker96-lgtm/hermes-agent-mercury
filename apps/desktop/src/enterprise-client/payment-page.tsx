import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n/context'

import type { DoudianReply, DoudianRequest, DoudianTask } from '../../electron/doudian-types'

import type { DoudianPageProps } from './doudian-entry-state'

const labels = {
  zh: [
    '小额打款',
    '选择工作簿',
    '未选择工作簿',
    '模式',
    '小额打款',
    '新订单小额打款',
    '金额',
    '起始行',
    '最多行（0 表示不限）',
    '检查并准备',
    '确认开始打款',
    '停止',
    '执行模块与当前企业会话不兼容，请更新执行模块。',
    '工作簿和任务状态',
    '操作失败',
    '正在检查执行模块',
    '执行模块不可用或企业权限不足',
    '执行模块不兼容',
    '保存数量',
    '请使用工作簿副本。',
    '企业会话已核验，请核对准备结果后确认开始。',
    '任务状态已变化，请重新核对。'
  ],
  en: [
    'Small payments',
    'Choose workbook',
    'No workbook selected',
    'Mode',
    'Small payments',
    'New-order small payments',
    'Amount',
    'Starting row',
    'Maximum rows (0 means unlimited)',
    'Check and prepare',
    'Confirm payment',
    'Stop',
    'The execution module is incompatible with this enterprise session. Update the module.',
    'Workbook and task status',
    'Operation failed',
    'Checking execution module',
    'Execution module unavailable or enterprise access denied',
    'Execution module incompatible',
    'Saved',
    'Use a copy of the workbook.',
    'Enterprise session verified. Review the prepared task before confirming.',
    'Task state changed. Review it again.'
  ]
} as const

type Capability = 'checking' | 'ready' | 'unverified' | 'unavailable'

function paymentCapability(result: DoudianReply): Capability {
  if (!result.ok || result.capabilities?.protocol !== 1 || result.capabilities.authorized !== true) {
    return 'unavailable'
  }

  return result.capabilities.authorizationMode === 'enterprise-session-v1' ? 'ready' : 'unverified'
}

export function PaymentPage({ runtime }: DoudianPageProps) {
  return <PaymentWorkspace runtime={runtime} />
}

function PaymentWorkspace({ runtime }: DoudianPageProps) {
  const { locale } = useI18n()
  const t = locale === 'zh' || locale === 'zh-hant' ? labels.zh : labels.en
  const [workbook, setWorkbook] = useState<{ id: string; name: string }>()
  const [mode, setMode] = useState<'standard' | 'new-order'>('standard')
  const [amount, setAmount] = useState('')
  const [startRow, setStartRow] = useState('1')
  const [maxRows, setMaxRows] = useState('0')
  const [task, setTask] = useState<DoudianTask>()
  const [capability, setCapability] = useState<Capability>('checking')
  const [sessionOwner, setSessionOwner] = useState(runtime)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const flight = useRef(false)
  const revision = useRef(0)
  const runtimeRef = useRef(runtime)
  runtimeRef.current = runtime
  const current = sessionOwner === runtime
  const displayedTask = current ? task : undefined
  const gate = current ? capability : 'checking'

  // Fence pending operations and clear the previous session's state.
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    let alive = true
    revision.current++
    flight.current = false
    setSessionOwner(runtime)
    setWorkbook(undefined)
    setTask(undefined)
    setError('')
    setBusy(false)
    setCapability('checking')

    if (!runtime?.doudian) {
      setCapability('unavailable')

      return () => {
        alive = false
      }
    }

    void runtime
      .doudian({ action: 'capabilities' })
      .then(result => {
        if (alive) {
          setCapability(paymentCapability(result))
        }
      })
      .catch(() => {
        if (alive) {
          setCapability('unavailable')
        }
      })

    return () => {
      alive = false
      revision.current++
    } // Invalidate any pending operation.
  }, [runtime])

  useEffect(() => {
    if (!runtime?.doudian || !current || (gate !== 'ready' && gate !== 'unverified')) {
      return
    }

    let alive = true
    let polling = false

    const poll = async () => {
      if (polling || flight.current) {
        return
      }

      polling = true
      const observed = revision.current

      try {
        const result = await runtime.doudian!({ action: 'status' })

        if (alive && observed === revision.current) {
          if (result.ok) {
            setTask(result.task?.kind === 'payment' ? result.task : undefined)
          } else {
            setError(result.error || t[14])
          }
        }
      } catch {
        if (alive && observed === revision.current) {
          setError(t[14])
        }
      } finally {
        polling = false
      }
    }

    void poll()
    const timer = setInterval(() => void poll(), 1500)

    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [runtime, current, gate, t])

  async function operate(action: 'chooseWorkbook' | 'preparePayment' | 'startPayment' | 'stop') {
    if (
      !runtime?.doudian ||
      !current ||
      flight.current ||
      (action === 'chooseWorkbook' && gate !== 'ready' && gate !== 'unverified') ||
      ((action === 'preparePayment' || action === 'startPayment') && gate !== 'ready') ||
      (action === 'preparePayment' && (!workbook || !amount.trim() || !startRow.trim() || !maxRows.trim() || active)) ||
      (action === 'startPayment' &&
        (displayedTask?.kind !== 'payment' ||
          displayedTask.state !== 'awaiting_confirmation' ||
          !displayedTask.taskId)) ||
      (action === 'stop' && !displayedTask?.taskId)
    ) {
      return
    }

    flight.current = true
    const observed = ++revision.current
    setBusy(true)
    setError('')

    try {
      if (action === 'preparePayment' || action === 'startPayment') {
        const verification = await runtime.doudian({ action: 'capabilities' })

        if (observed !== revision.current || runtimeRef.current !== runtime) {
          return
        }

        const verified = paymentCapability(verification)
        setCapability(verified)

        if (verified !== 'ready') {
          setError(t[12])

          return
        }
      }

      if (action === 'startPayment') {
        const status = await runtime.doudian({ action: 'status' })

        if (observed !== revision.current || runtimeRef.current !== runtime) {
          return
        }

        if (
          !status.ok ||
          status.task?.kind !== 'payment' ||
          status.task.state !== 'awaiting_confirmation' ||
          status.task.taskId !== displayedTask?.taskId
        ) {
          setTask(status.ok && status.task?.kind === 'payment' ? status.task : undefined)
          setError(status.error || t[21])

          return
        }
      }

      let request: Omit<DoudianRequest, 'sessionId'>

      if (action === 'preparePayment') {
        request = { action, workbookId: workbook!.id, amount, startRow, maxRows, mode }
      } else if (action === 'startPayment' || action === 'stop') {
        request = { action, taskId: displayedTask!.taskId! }
      } else {
        request = { action }
      }

      const result = await runtime.doudian(request)

      if (observed !== revision.current || runtimeRef.current !== runtime) {
        return
      }

      if (!result.ok) {
        setError(result.error || t[14])
      } else if (action === 'chooseWorkbook' && result.workbook) {
        setWorkbook(result.workbook)
      } else if (
        (action === 'preparePayment' || action === 'startPayment' || action === 'stop') &&
        result.task?.kind === 'payment'
      ) {
        setTask(result.task)
      } else if (action !== 'chooseWorkbook') {
        setError(t[14])
      }
    } catch {
      if (observed === revision.current) {
        if (action === 'preparePayment' || action === 'startPayment') {
          setCapability('unavailable')
        }

        setError(t[14])
      }
    } finally {
      if (observed === revision.current) {
        flight.current = false
        setBusy(false)
      }
    }
  }

  const active =
    displayedTask &&
    ['preparing', 'awaiting_confirmation', 'running', 'stopping', 'unknown'].includes(displayedTask.state)

  return (
    <section className="hesc-page space-y-4" data-testid="payment-page">
      <header className="hesc-page-header">
        <h1>{t[0]}</h1>
      </header>
      <p role="status">
        {gate === 'ready' ? t[20] : gate === 'unverified' ? t[12] : gate === 'checking' ? t[15] : t[16]}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          disabled={busy || (gate !== 'ready' && gate !== 'unverified') || !!active}
          onClick={() => void operate('chooseWorkbook')}
          variant="outline"
        >
          {t[1]}
        </Button>
        <span className="break-all">{workbook?.name ?? t[2]}</span>
      </div>
      <p className="text-sm text-muted-foreground">{t[19]}</p>
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-2">
          {t[3]}
          <select
            disabled={busy || !!active}
            onChange={event => setMode(event.target.value as typeof mode)}
            value={mode}
          >
            <option value="standard">{t[4]}</option>
            <option value="new-order">{t[5]}</option>
          </select>
        </label>
        <label className="flex flex-col gap-2">
          {t[6]}
          <Input
            disabled={busy || !!active}
            inputMode="decimal"
            onChange={event => setAmount(event.target.value)}
            value={amount}
          />
        </label>
        <label className="flex flex-col gap-2">
          {t[7]}
          <Input
            disabled={busy || !!active}
            inputMode="numeric"
            onChange={event => setStartRow(event.target.value)}
            value={startRow}
          />
        </label>
        <label className="flex flex-col gap-2">
          {t[8]}
          <Input
            disabled={busy || !!active}
            inputMode="numeric"
            onChange={event => setMaxRows(event.target.value)}
            value={maxRows}
          />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={
            busy || gate !== 'ready' || !!active || !workbook || !amount.trim() || !startRow.trim() || !maxRows.trim()
          }
          onClick={() => void operate('preparePayment')}
        >
          {t[9]}
        </Button>
        <Button
          disabled={
            busy ||
            gate !== 'ready' ||
            displayedTask?.kind !== 'payment' ||
            displayedTask.state !== 'awaiting_confirmation' ||
            !displayedTask.taskId
          }
          onClick={() => void operate('startPayment')}
        >
          {t[10]}
        </Button>
        {active && displayedTask?.taskId && (
          <Button
            disabled={busy || displayedTask.state === 'stopping'}
            onClick={() => void operate('stop')}
            variant="outline"
          >
            {t[11]}
          </Button>
        )}
      </div>
      {displayedTask && (
        <div aria-label={t[13]} aria-live="polite" className="space-y-1">
          <p>{displayedTask.state}</p>
          <p>{displayedTask.summary}</p>
          <p>
            {t[18]}: {displayedTask.saved}
          </p>
          {displayedTask.error && <p>{displayedTask.error}</p>}
          {displayedTask.messages.map((message, index) => (
            <p key={index}>{message}</p>
          ))}
        </div>
      )}
      {error && (
        <p role="alert">
          {t[14]}: {error}
        </p>
      )}
    </section>
  )
}
