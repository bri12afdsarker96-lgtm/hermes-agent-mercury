import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n/context'

import type { DoudianTask } from '../../electron/doudian-types'

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
    '原激活授权尚无法核验，准备和开始已阻断。企业权限和模块状态不能替代此核验。',
    '工作簿和任务状态',
    '操作失败',
    '正在检查执行模块',
    '执行模块不可用或企业权限不足',
    '原激活授权未核验',
    '保存数量',
    '请使用工作簿副本。'
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
    'Original activation authorization cannot be verified. Preparation and start are blocked; enterprise permissions and module status do not replace this check.',
    'Workbook and task status',
    'Operation failed',
    'Checking execution module',
    'Execution module unavailable or enterprise access denied',
    'Original activation not verified',
    'Saved',
    'Use a copy of the workbook.'
  ]
} as const

export function PaymentPage({ runtime }: DoudianPageProps) {
  const { locale } = useI18n()
  const t = locale === 'zh' || locale === 'zh-hant' ? labels.zh : labels.en
  const [workbook, setWorkbook] = useState<{ id: string; name: string }>()
  const [mode, setMode] = useState<'standard' | 'new-order'>('standard')
  const [amount, setAmount] = useState('')
  const [startRow, setStartRow] = useState('1')
  const [maxRows, setMaxRows] = useState('0')
  const [task, setTask] = useState<DoudianTask>()
  const [capability, setCapability] = useState<'checking' | 'ready' | 'unavailable'>('checking')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const flight = useRef(false)
  const revision = useRef(0)

  // Fence pending operations and clear the previous session's state.
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    let alive = true
    revision.current++
    flight.current = false
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
          setCapability(
            result.ok && result.capabilities?.protocol === 1 && result.capabilities.authorized === true
              ? 'ready'
              : 'unavailable'
          )
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
    if (!runtime?.doudian || capability !== 'ready') {
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
  }, [runtime, capability, t])

  async function operate(action: 'chooseWorkbook' | 'stop') {
    if (
      !runtime?.doudian ||
      flight.current ||
      (action === 'chooseWorkbook' && capability !== 'ready') ||
      (action === 'stop' && !task?.taskId)
    ) {
      return
    }
    flight.current = true
    const observed = ++revision.current
    setBusy(true)
    setError('')

    try {
      const result = await runtime.doudian(action === 'stop' ? { action, taskId: task!.taskId! } : { action })

      if (observed !== revision.current) {
        return
      }

      if (!result.ok) {
        setError(result.error || t[14])
      } else if (action === 'chooseWorkbook' && result.workbook) {
        setWorkbook(result.workbook)
      } else if (action === 'stop' && result.task?.kind === 'payment') {
        setTask(result.task)
      }
    } catch {
      if (observed === revision.current) {
        setError(t[14])
      }
    } finally {
      if (observed === revision.current) {
        flight.current = false
        setBusy(false)
      }
    }
  }

  const active = task && ['preparing', 'awaiting_confirmation', 'running', 'stopping', 'unknown'].includes(task.state)

  return (
    <section className="hesc-page space-y-4" data-testid="payment-page">
      <header className="hesc-page-header">
        <h1>{t[0]}</h1>
      </header>
      <p role="status">{t[12]}</p>
      <p>{capability === 'checking' ? t[15] : capability === 'unavailable' ? t[16] : t[17]}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          disabled={busy || capability !== 'ready' || !!active}
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
          <select onChange={event => setMode(event.target.value as typeof mode)} value={mode}>
            <option value="standard">{t[4]}</option>
            <option value="new-order">{t[5]}</option>
          </select>
        </label>
        <label className="flex flex-col gap-2">
          {t[6]}
          <Input inputMode="decimal" onChange={event => setAmount(event.target.value)} value={amount} />
        </label>
        <label className="flex flex-col gap-2">
          {t[7]}
          <Input inputMode="numeric" onChange={event => setStartRow(event.target.value)} value={startRow} />
        </label>
        <label className="flex flex-col gap-2">
          {t[8]}
          <Input inputMode="numeric" onChange={event => setMaxRows(event.target.value)} value={maxRows} />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button disabled title={t[12]}>
          {t[9]}
        </Button>
        <Button disabled title={t[12]}>
          {t[10]}
        </Button>
        {active && task?.taskId && (
          <Button disabled={busy || task.state === 'stopping'} onClick={() => void operate('stop')} variant="outline">
            {t[11]}
          </Button>
        )}
      </div>
      {task && (
        <div aria-label={t[13]} aria-live="polite" className="space-y-1">
          <p>{task.state}</p>
          <p>{task.summary}</p>
          <p>
            {t[18]}: {task.saved}
          </p>
          {task.error && <p>{task.error}</p>}
          {task.messages.map((message, index) => (
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
