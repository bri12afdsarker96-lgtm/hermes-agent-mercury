import { Button } from '../../components/ui/button'
import { moneyMetrics, primaryMoneyMetrics, type MoneyBucket, type MoneyTotals, type ReceivableSelection } from './receivables-data'

interface MoneySummaryProps {
  totals: MoneyTotals[]
  disabled: boolean
  selection?: ReceivableSelection
  onSelect(bucket: MoneyBucket, currency: string): void
}

export function MoneySummary({totals, disabled, selection, onSelect}: MoneySummaryProps) {
  return <>{totals.map(total => <section key={total.currency} aria-label={`${total.currency} 金额统计`}>
    {total.currency !== 'CNY' ? <h3>{total.currency}</h3> : null}
    <div className="hesc-receivable-metrics web-primary-money">
      {primaryMoneyMetrics.map(([key, label]) => <button type="button" className="hesc-card" key={key}
        aria-label={`${total.currency} ${label} ${total[key]}，查看对应任务`} disabled={disabled}
        aria-pressed={Boolean(selection && !selection.due_date && selection.detail_view === 'all' && selection.bucket === key && (!selection.currency || selection.currency === total.currency))}
        onClick={() => onSelect(key, total.currency)}>
        <span>{label}</span><strong>{total.currency === 'CNY' ? '¥ ' : ''}{total[key]}{total.currency !== 'CNY' ? <small> {total.currency}</small> : null}</strong>
      </button>)}
    </div>
    <div className="web-money-composition" aria-label={`${total.currency} 金额构成`}>
      <span>未收构成：</span>
      {moneyMetrics.filter(([key]) => ['outstanding', 'inactive'].includes(key)).map(([key, label]) =>
        <Button key={key} variant="link" disabled={disabled} aria-label={`${total.currency} ${label} ${total[key]}，查看对应任务`} onClick={() => onSelect(key, total.currency)}>{label} {total[key]}</Button>)}
      <Button variant="link" disabled={disabled} aria-label={`${total.currency} 应收总额 ${total.receivable}，查看对应任务`} onClick={() => onSelect('all', total.currency)}>应收总额 {total.receivable}</Button>
    </div>
  </section>)}</>
}
