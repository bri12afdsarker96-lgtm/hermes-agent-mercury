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
    '任务状态已变化，请重新核对。',
    '因余额原因，打款已暂停。',
    '打款已暂停，需人工核验。',
    '任务已停止。',
    '任务已完成。',
    '本地安全环境尚未就绪，暂时无法运行。',
    '无法注册 Esc 紧急停止快捷键，打款未启动。请检查快捷键占用后重试。',
    '已按 Esc，打款未启动。',
    '暂停',
    '继续',
    '在当前操作完成后暂停，先保存工作簿再进入已暂停状态。继续恢复同一任务的同一步。已提交的打款状态保留待核验。停止会真正取消当前任务。关闭后重新选择同一工作簿并检查准备，可按 D 列已保存结果续接。',
    '执行模块尚不支持暂停和继续，请更新执行模块。',
    '操作方式',
    'CDP 网页控件',
    '原桌面兼容',
    'CDP 每单固定 5 元补差价。仅在款项记录精确匹配“暂无记录，每个订单最多打款5次”时处理，其他记录跳过；不读取聊天内容。结果回填 D 列。',
    '执行模块尚不支持 CDP 打款，请更新执行模块或手动选择原桌面兼容。'
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
    'Task state changed. Review it again.',
    'Payment paused due to a balance issue.',
    'Payment paused; manual verification is required.',
    'Task stopped.',
    'Task completed.',
    'The local security environment is not ready; this task cannot run yet.',
    'Could not register the Esc emergency stop shortcut. Payment was not started; check for a shortcut conflict and retry.',
    'Esc was pressed; payment was not started.',
    'Pause',
    'Resume',
    'Pause after the current operation completes. The workbook is saved before the task enters the paused state. Resume continues the same task at the same step. Submitted payments remain pending verification. Stop cancels the current task. After closing, choose the same workbook and prepare again to continue from the saved results in column D.',
    'The execution module does not support pause and resume yet. Update the module.',
    'Transport',
    'CDP web controls',
    'Original desktop compatibility',
    'CDP uses a fixed CNY 5 price adjustment per order. Only payment records exactly matching “暂无记录，每个订单最多打款5次” are eligible. Other records are skipped. Chat content is not read. Results are saved in column D.',
    'The execution module does not support CDP payments. Update it or manually select original desktop compatibility.'
  ]
} as const

const taskStateLabels = {
  zh: {
    idle: '空闲',
    preparing: '正在准备',
    awaiting_confirmation: '等待确认开始',
    running: '正在打款',
    pausing: '正在保存并暂停',
    paused: '打款已暂停。',
    stopping: '正在停止',
    stopped: labels.zh[24],
    completed: labels.zh[25],
    paused_balance: labels.zh[22],
    paused_review: labels.zh[23],
    failed: '任务失败。',
    unknown: '任务状态未知，请人工核验。'
  },
  en: {
    idle: 'Idle',
    preparing: 'Preparing',
    awaiting_confirmation: 'Awaiting confirmation',
    running: 'Making payments',
    pausing: 'Saving and pausing',
    paused: 'Payment paused.',
    stopping: 'Stopping',
    stopped: labels.en[24],
    completed: labels.en[25],
    paused_balance: labels.en[22],
    paused_review: labels.en[23],
    failed: 'Task failed.',
    unknown: 'Task state unknown. Manual verification is required.'
  }
} satisfies Record<'zh' | 'en', Record<DoudianTask['state'], string>>

type Capability = 'checking' | 'ready' | 'unverified' | 'unavailable'
type PaymentAction = 'chooseWorkbook' | 'preparePayment' | 'startPayment' | 'pausePayment' | 'resumePayment' | 'stop'

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
  const language = locale === 'zh' || locale === 'zh-hant' ? 'zh' : 'en'
  const t = labels[language]
  const states = taskStateLabels[language]
  const [workbook, setWorkbook] = useState<{ id: string; name: string }>()
  const [mode, setMode] = useState<'standard' | 'new-order'>('standard')
  const [transport, setTransport] = useState<NonNullable<DoudianRequest['transport']>>('cdp')
  const [amount, setAmount] = useState('')
  const [startRow, setStartRow] = useState('1')
  const [maxRows, setMaxRows] = useState('0')
  const [task, setTask] = useState<DoudianTask>()
  const [capability, setCapability] = useState<Capability>('checking')
  const [paymentControls, setPaymentControls] = useState(false)
  const [paymentCdp, setPaymentCdp] = useState(false)
  const [securityBlocked, setSecurityBlocked] = useState(false)
  const [sessionOwner, setSessionOwner] = useState(runtime)
  const [error, setError] = useState('')
  const [pendingAction, setPendingAction] = useState<PaymentAction>()
  const flight = useRef(false)
  const revision = useRef(0)
  const runtimeRef = useRef(runtime)
  runtimeRef.current = runtime
  const current = sessionOwner === runtime
  const displayedTask = current ? task : undefined
  const gate = current ? capability : 'checking'
  const busy = pendingAction !== undefined
  const paymentAmount = transport === 'cdp' ? '5' : amount
  const paymentMode = transport === 'cdp' ? 'standard' : mode

  const active = !!displayedTask &&
    ['preparing', 'awaiting_confirmation', 'running', 'pausing', 'paused', 'stopping', 'unknown'].includes(displayedTask.state)

  const canPause = gate === 'ready' && paymentControls && displayedTask?.state === 'running' && !!displayedTask.taskId
  const canResume = gate === 'ready' && paymentControls && displayedTask?.state === 'paused' && !!displayedTask.taskId
  const canStop = active && displayedTask.state !== 'stopping' && !!displayedTask.taskId
  const pausing = pendingAction === 'pausePayment' || displayedTask?.state === 'pausing'

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
    setPendingAction(undefined)
    setCapability('checking')
    setPaymentControls(false)
    setPaymentCdp(false)
    setTransport('cdp')
    setSecurityBlocked(false)

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
          setPaymentControls(result.ok && result.capabilities?.paymentControls === 1)
          setPaymentCdp(result.ok && result.capabilities?.paymentCdp === 1)
          setSecurityBlocked(!result.ok && result.error === 'DOUDIAN_LOCAL_ISOLATION_UNAVAILABLE')
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

  async function operate(action: PaymentAction) {
    if (
      !runtime?.doudian ||
      !current ||
      flight.current ||
      (action === 'chooseWorkbook' && (active || (gate !== 'ready' && gate !== 'unverified'))) ||
      ((action === 'preparePayment' || action === 'startPayment' || action === 'resumePayment') && gate !== 'ready') ||
      (action === 'preparePayment' && (!workbook || !paymentAmount.trim() || !startRow.trim() || !maxRows.trim() || active || (transport === 'cdp' && !paymentCdp))) ||
      (action === 'startPayment' &&
        (displayedTask?.kind !== 'payment' ||
          displayedTask.state !== 'awaiting_confirmation' ||
          !displayedTask.taskId)) ||
      (action === 'pausePayment' && !canPause) ||
      (action === 'resumePayment' && !canResume) ||
      (action === 'stop' && !canStop)
    ) {
      return
    }

    flight.current = true
    const observed = ++revision.current
    setPendingAction(action)
    setError('')

    try {
      if (action === 'preparePayment' || action === 'startPayment' || action === 'resumePayment') {
        const verification = await runtime.doudian({ action: 'capabilities' })

        if (observed !== revision.current || runtimeRef.current !== runtime) {
          return
        }

        const verified = paymentCapability(verification)
        setCapability(verified)
        setPaymentControls(verification.ok && verification.capabilities?.paymentControls === 1)
        setPaymentCdp(verification.ok && verification.capabilities?.paymentCdp === 1)
        setSecurityBlocked(!verification.ok && verification.error === 'DOUDIAN_LOCAL_ISOLATION_UNAVAILABLE')

        if (verified !== 'ready') {
          setError(!verification.ok && verification.error === 'DOUDIAN_LOCAL_ISOLATION_UNAVAILABLE' ? t[26] : t[12])

          return
        }

        if (action === 'resumePayment' && verification.capabilities?.paymentControls !== 1) {
          setError(t[32])

          return
        }
        if (action === 'preparePayment' && transport === 'cdp' && verification.capabilities?.paymentCdp !== 1) {
          setError(t[37])

          return
        }
      }

      if (action === 'startPayment' || action === 'resumePayment') {
        const expectedState = action === 'startPayment' ? 'awaiting_confirmation' : 'paused'
        const status = await runtime.doudian({ action: 'status' })

        if (observed !== revision.current || runtimeRef.current !== runtime) {
          return
        }

        if (
          !status.ok ||
          status.task?.kind !== 'payment' ||
          status.task.state !== expectedState ||
          status.task.taskId !== displayedTask?.taskId
        ) {
          if (status.ok) {
            setTask(status.task?.kind === 'payment' ? status.task : undefined)
          }

          setError(status.error || t[21])

          return
        }
      }

      let request: Omit<DoudianRequest, 'sessionId'>

      if (action === 'preparePayment') {
        request = { action, workbookId: workbook!.id, amount: paymentAmount, startRow, maxRows, mode: paymentMode, transport }
      } else if (action === 'chooseWorkbook') {
        request = { action }
      } else {
        request = { action, taskId: displayedTask!.taskId! }
      }

      const result = await runtime.doudian(request)

      if (observed !== revision.current || runtimeRef.current !== runtime) {
        return
      }

      if (!result.ok) {
        if (result.error === 'DOUDIAN_LOCAL_ISOLATION_UNAVAILABLE') {
          setSecurityBlocked(true)
          setCapability('unavailable')
        }

        setError(result.error === 'DOUDIAN_LOCAL_ISOLATION_UNAVAILABLE' ? t[26] :
          result.error === 'DOUDIAN_ESCAPE_UNAVAILABLE' ? t[27] : result.error === 'DOUDIAN_START_CANCELLED' ? t[28] : result.error || t[14])
      } else if (action === 'chooseWorkbook' && result.workbook) {
        setWorkbook(result.workbook)
      } else if (action !== 'chooseWorkbook' && result.task?.kind === 'payment') {
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
        setPendingAction(undefined)
      }
    }
  }

  return (
    <section className="hesc-page space-y-4" data-testid="payment-page">
      <header className="hesc-page-header">
        <h1>{t[0]}</h1>
      </header>
      <p role="status">
        {gate === 'ready' ? t[20] : gate === 'unverified' ? t[12] : gate === 'checking' ? t[15] : securityBlocked && current ? t[26] : t[16]}
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
      <p className="text-sm text-muted-foreground">{t[31]}</p>
      {gate === 'ready' && !paymentControls && <p className="text-sm text-muted-foreground">{t[32]}</p>}
      {transport === 'cdp' && <p className="text-sm text-muted-foreground">{t[36]}</p>}
      {transport === 'cdp' && gate === 'ready' && !paymentCdp && <p role="alert">{t[37]}</p>}
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-2">
          {t[33]}
          <select disabled={busy || !!active} onChange={event => setTransport(event.target.value as typeof transport)} value={transport}>
            <option value="cdp">{t[34]}</option>
            <option value="desktop">{t[35]}</option>
          </select>
        </label>
        <label className="flex flex-col gap-2">
          {t[3]}
          <select
            disabled={busy || !!active || transport === 'cdp'}
            onChange={event => setMode(event.target.value as typeof mode)}
            value={paymentMode}
          >
            <option value="standard">{t[4]}</option>
            <option value="new-order">{t[5]}</option>
          </select>
        </label>
        <label className="flex flex-col gap-2">
          {t[6]}
          <Input
            disabled={busy || !!active || transport === 'cdp'}
            inputMode="decimal"
            onChange={event => setAmount(event.target.value)}
            value={paymentAmount}
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
            busy || gate !== 'ready' || !!active || !workbook || !paymentAmount.trim() || !startRow.trim() || !maxRows.trim() || (transport === 'cdp' && !paymentCdp)
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
        <Button
          disabled={busy || !canPause}
          onClick={() => void operate('pausePayment')}
          variant="outline"
        >
          {pausing ? states.pausing : t[29]}
        </Button>
        <Button
          disabled={busy || !canResume}
          onClick={() => void operate('resumePayment')}
          variant="outline"
        >
          {t[30]}
        </Button>
        {active && displayedTask?.taskId && (
          <Button
            disabled={busy || !canStop}
            onClick={() => void operate('stop')}
            variant="outline"
          >
            {t[11]}
          </Button>
        )}
      </div>
      {displayedTask && (
        <div aria-label={t[13]} aria-live="polite" className="space-y-1">
          <p>{pausing ? states.pausing : states[displayedTask.state]}</p>
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
