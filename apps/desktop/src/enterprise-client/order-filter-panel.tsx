import { useCallback, useState } from 'react'

import {
  downloadLocalOrderResult,
  parseLocalOrderTable,
  runLocalOrderFilter,
  validateLocalOrderFiles,
  type LocalOrderFilterResult
} from './order-filter-local'

function errorText(reason: unknown): string {
  return reason instanceof Error && reason.message ? reason.message : '订单筛选暂时不可用。'
}

/** Browser-only set difference: selected source files never leave the current device. */
export function OrderFilterPanel() {
  const [callFiles, setCallFiles] = useState<File[]>([])
  const [mainFile, setMainFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<LocalOrderFilterResult | null>(null)

  const run = useCallback(async () => {
    if (busy) return
    const validation = validateLocalOrderFiles(callFiles, mainFile)
    if (validation || !mainFile) {
      setError(validation)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const callTables = await Promise.all(callFiles.map(parseLocalOrderTable))
      const mainTable = await parseLocalOrderTable(mainFile)
      setResult(runLocalOrderFilter(callTables, mainTable))
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }, [busy, callFiles, mainFile])

  return <article className="hesc-card" data-testid="order-filter-panel">
    <div className="hesc-section-heading">
      <div>
        <h2 className="hesc-section-title">未外呼订单筛选</h2>
        <p className="hesc-muted-copy">选择 1–20 份飞鸽外呼记录和 1 份主系统订单总表。按“订单号”合并去重后，输出主表中未外呼的订单；订单号按文本处理，保留前导 0。</p>
      </div>
    </div>
    <div className="hesc-ai-reminder-note" role="status"><strong>仅在本地处理</strong><span>所选文件只在当前浏览器内存中解析和下载，不上传、不保存到企业服务器；刷新或关闭页面后数据即丢弃。</span></div>
    <div className="hesc-provisioning-form">
      <label>飞鸽外呼记录（可多选）<input accept=".csv,.txt,.tsv,.xlsx,.jsonl" disabled={busy} multiple onChange={event => { setCallFiles(Array.from(event.target.files ?? [])); setResult(null) }} type="file" /></label>
      <label>主系统订单总表<input accept=".csv,.txt,.tsv,.xlsx,.jsonl" disabled={busy} onChange={event => { setMainFile(event.target.files?.[0] ?? null); setResult(null) }} type="file" /></label>
      <button className="hesc-action" disabled={busy || !mainFile || callFiles.length === 0} onClick={() => void run()} type="button">{busy ? '正在本地合并并筛选…' : '在本地生成未外呼订单列表'}</button>
    </div>
    <p className="hesc-muted-copy">{callFiles.length ? `已选择 ${callFiles.length} 份外呼记录` : '尚未选择外呼记录'}；{mainFile ? `主表：${mainFile.name}` : '尚未选择主订单表'}。单文件最多 50 MiB，合计最多 100 MiB。</p>
    {error ? <div className="hesc-error" role="status"><div><strong>订单筛选未完成</strong><span>{error}</span></div></div> : null}
    {result ? <div className="hesc-order-filter-result">
      <p className="hesc-success-copy" role="status">已在本地合并 {result.summary.call_files} 份外呼记录（{result.summary.call_unique_orders} 个去重订单），主表 {result.summary.main_rows} 行；未外呼 {result.summary.missing_orders} 单。</p>
      <div className="hesc-inline-actions">
        <button className="hesc-action" onClick={() => downloadLocalOrderResult(result)} type="button">下载 {result.download_name}</button>
      </div>
      <p className="hesc-muted-copy">匹配结果仅写入下载文件，不在页面预览订单数据。</p>
    </div> : null}
  </article>
}
