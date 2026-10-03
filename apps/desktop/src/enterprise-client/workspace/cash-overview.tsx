import { Button } from '../../components/ui/button'
import type { EnterpriseClientRuntime } from '../runtime'
import { $receivableJump, metricSelection, useReceivablesData } from './receivables-data'
import { MoneySummary } from './money-summary'
import './receivables.css'

interface CashOverviewProps {
  runtime: EnterpriseClientRuntime
  scope: string
  onOpen(): void
}
export function CashOverview({ runtime, scope, onOpen }: CashOverviewProps) {
  const { data, busy, error, refresh } = useReceivablesData(runtime, scope, { page_size: '1' })
  return (
    <article className="hesc-card web-cash-overview" aria-label="收款金额概览" aria-busy={busy}>
      <h2 className="hesc-section-title">收款金额概览</h2>
      {busy && !data ? <p role="status">正在读取收款金额…</p> : null}
      {error ? (
        <p role="alert">
          {error}
          <Button onClick={refresh}>重试</Button>
        </p>
      ) : null}
      {data ? (
        <>
          <p>{data.as_of_date} · 北京时间 · 当前权限范围</p>
          <MoneySummary totals={data.summary_totals} disabled={busy || Boolean(error)} onSelect={(bucket, currency) => {
            $receivableJump.set({scope, selection: metricSelection(bucket, currency), nonce: Date.now()})
            onOpen()
          }} />
          {!data.summary_totals.length ? <p>暂无应收款记录。</p> : null}
        </>
      ) : null}
    </article>
  )
}
