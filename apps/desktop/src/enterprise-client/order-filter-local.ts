import { unzipSync } from 'fflate'

const REL_XML_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

export const LOCAL_ORDER_MAX_FILE_BYTES = 50 * 1024 * 1024
export const LOCAL_ORDER_MAX_TOTAL_BYTES = 100 * 1024 * 1024
export const LOCAL_ORDER_MAX_CALL_FILES = 20

export interface LocalOrderTable {
  headers: string[]
  rows: Array<Record<string, string>>
}

export interface LocalOrderFilterResult {
  download_name: string
  preview_columns: string[]
  preview_rows: Array<Record<string, string>>
  rows: Array<Record<string, string>>
  summary: {
    call_files: number
    call_unique_orders: number
    main_rows: number
    main_unique_orders: number
    missing_orders: number
  }
}

function dedupeHeaders(headers: string[]): string[] {
  const seen = new Map<string, number>()
  return headers.map((raw, index) => {
    const base = raw.trim() || `列${index + 1}`
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    return count === 0 ? base : `${base}_${count + 1}`
  })
}

function normalizeHeader(value: string): string {
  return value.replace(/\s+/g, '').toLowerCase()
}

function normalizeOrderValue(value: string | undefined): string {
  let text = (value ?? '').replace(/\s+/g, '').trim()
  if (text.endsWith('.0') && /^\d+$/.test(text.slice(0, -2))) text = text.slice(0, -2)
  return text
}

function columnIndex(reference: string | null): number {
  const letters = (reference ?? '').match(/[A-Z]+/i)?.[0]?.toUpperCase() ?? ''
  let value = 0
  for (const letter of letters) value = value * 26 + letter.charCodeAt(0) - 64
  return value
}

function firstNonEmptyRow(rows: string[][]): number {
  return rows.findIndex(row => row.some(cell => cell.trim()))
}

function makeTable(rawRows: string[][]): LocalOrderTable {
  const headerIndex = firstNonEmptyRow(rawRows)
  if (headerIndex < 0) return {headers: [], rows: []}
  const headers = dedupeHeaders(rawRows[headerIndex].map(cell => cell.trim()))
  const rows = rawRows.slice(headerIndex + 1).flatMap(raw => {
    if (!raw.some(cell => cell.trim())) return []
    const row: Record<string, string> = {}
    for (let index = 0; index < headers.length; index += 1) row[headers[index]] = (raw[index] ?? '').trim()
    return [row]
  })
  return {headers, rows}
}

function csvDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  return [',', '\t', ';', '|'].reduce((best, candidate) => (
    firstLine.split(candidate).length > firstLine.split(best).length ? candidate : best
  ), ',')
}

function parseDelimited(text: string): string[][] {
  const delimiter = csvDelimiter(text)
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"'
        index += 1
      } else quoted = !quoted
    } else if (!quoted && char === delimiter) {
      row.push(cell)
      cell = ''
    } else if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && text[index + 1] === '\n') index += 1
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += char
  }
  if (cell || row.length > 0) rows.push([...row, cell])
  return rows
}

function parseJsonLines(text: string): LocalOrderTable {
  const rows: Array<Record<string, string>> = []
  const headers: string[] = []
  const seen = new Set<string>()
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue
    try {
      const record: unknown = JSON.parse(raw)
      if (!record || Array.isArray(record) || typeof record !== 'object') continue
      const row: Record<string, string> = {}
      for (const [key, value] of Object.entries(record)) {
        row[key] = value == null ? '' : String(value)
        if (!seen.has(key)) {
          seen.add(key)
          headers.push(key)
        }
      }
      rows.push(row)
    } catch {
      // Keep the same tolerant behavior as the former server parser for a bad JSONL line.
    }
  }
  return {headers, rows}
}

function xmlDocument(bytes: Uint8Array, label: string): XMLDocument {
  const document = new DOMParser().parseFromString(new TextDecoder().decode(bytes), 'application/xml')
  if (document.getElementsByTagName('parsererror').length) throw new Error(`${label} 文件结构无效。`)
  return document
}

function xmlElements(root: Document | Element, localName: string): Element[] {
  const namespaced = Array.from(root.getElementsByTagNameNS('*', localName))
  return namespaced.length ? namespaced : Array.from(root.getElementsByTagName(localName))
}

function xmlText(root: Element, localName: string): string {
  return xmlElements(root, localName).map(node => node.textContent ?? '').join('')
}

function xlsxSharedStrings(files: Record<string, Uint8Array>): string[] {
  const bytes = files['xl/sharedStrings.xml']
  if (!bytes) return []
  return xmlElements(xmlDocument(bytes, 'XLSX'), 'si').map(item => xmlText(item, 't'))
}

function firstXlsxSheet(files: Record<string, Uint8Array>): Uint8Array {
  const workbookBytes = files['xl/workbook.xml']
  const relationshipsBytes = files['xl/_rels/workbook.xml.rels']
  if (!workbookBytes || !relationshipsBytes) throw new Error('XLSX 缺少工作表信息。')
  const relationships = new Map<string, string>()
  for (const relationship of xmlElements(xmlDocument(relationshipsBytes, 'XLSX'), 'Relationship')) {
    const id = relationship.getAttribute('Id')
    const target = relationship.getAttribute('Target')
    if (id && target) relationships.set(id, target)
  }
  const sheet = xmlElements(xmlDocument(workbookBytes, 'XLSX'), 'sheet')[0]
  const relationId = sheet?.getAttributeNS(REL_XML_NS, 'id') ?? sheet?.getAttribute('r:id')
  const target = relationId ? relationships.get(relationId) : undefined
  if (!target || target.includes('..')) throw new Error('XLSX 工作表关系缺失。')
  const cleanTarget = target.replace(/^\/+/, '')
  const path = cleanTarget.startsWith('xl/') ? cleanTarget : `xl/${cleanTarget}`
  const bytes = files[path]
  if (!bytes) throw new Error('XLSX 工作表不存在。')
  return bytes
}

function xlsxCellText(cell: Element, shared: string[]): string {
  const type = cell.getAttribute('t')
  if (type === 's') {
    const index = Number.parseInt(xmlText(cell, 'v'), 10)
    return Number.isSafeInteger(index) && index >= 0 ? shared[index] ?? '' : ''
  }
  if (type === 'inlineStr') return xmlText(cell, 't')
  if (type === 'b') return xmlText(cell, 'v') === '1' ? 'TRUE' : 'FALSE'
  return xmlText(cell, 'v')
}

function parseXlsx(buffer: ArrayBuffer): LocalOrderTable {
  const files = unzipSync(new Uint8Array(buffer))
  const shared = xlsxSharedStrings(files)
  const sheet = xmlDocument(firstXlsxSheet(files), 'XLSX')
  const rawRows: string[][] = []
  for (const rowNode of xmlElements(sheet, 'row')) {
    const byIndex = new Map<number, string>()
    let maxIndex = 0
    for (const cell of xmlElements(rowNode, 'c')) {
      const index = columnIndex(cell.getAttribute('r'))
      if (!index) continue
      byIndex.set(index, xlsxCellText(cell, shared).trim())
      maxIndex = Math.max(maxIndex, index)
    }
    if (maxIndex) rawRows.push(Array.from({length: maxIndex}, (_, index) => byIndex.get(index + 1) ?? ''))
  }
  return makeTable(rawRows)
}

function readFileBytes(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error(`无法读取 ${file.name}。`))
    reader.onload = () => reader.result instanceof ArrayBuffer ? resolve(reader.result) : reject(new Error(`无法读取 ${file.name}。`))
    reader.readAsArrayBuffer(file)
  })
}

export function validateLocalOrderFiles(callFiles: File[], mainFile: File | null): string | null {
  if (!callFiles.length) return '至少需要一份飞鸽外呼记录表。'
  if (callFiles.length > LOCAL_ORDER_MAX_CALL_FILES) return `飞鸽外呼记录最多 ${LOCAL_ORDER_MAX_CALL_FILES} 份。`
  if (!mainFile) return '需要主系统订单总表。'
  const files = [...callFiles, mainFile]
  if (files.some(file => file.size > LOCAL_ORDER_MAX_FILE_BYTES)) return '单个文件不能超过 50 MiB。'
  if (files.reduce((total, file) => total + file.size, 0) > LOCAL_ORDER_MAX_TOTAL_BYTES) return '全部文件合计不能超过 100 MiB。'
  return null
}

export async function parseLocalOrderTable(file: File): Promise<LocalOrderTable> {
  const suffix = file.name.toLowerCase().split('.').pop()
  const bytes = await readFileBytes(file)
  if (suffix === 'xlsx') return parseXlsx(bytes)
  const text = new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, '')
  if (suffix === 'jsonl') return parseJsonLines(text)
  if (suffix === 'csv' || suffix === 'txt' || suffix === 'tsv') return makeTable(parseDelimited(text))
  throw new Error('仅支持 CSV、TXT、TSV、XLSX 或 JSONL 文件。')
}

export function chooseLocalOrderColumn(headers: string[], preferred = '订单号'): string | null {
  if (!headers.length) return null
  const normalized = new Map(headers.filter(Boolean).map(header => [normalizeHeader(header), header]))
  for (const candidate of [preferred, '订单号', '订单编号', '订单id', '订单ID', '订单编码']) {
    const matched = normalized.get(normalizeHeader(candidate))
    if (matched) return matched
  }
  return headers.find(header => {
    const normalizedHeader = normalizeHeader(header)
    return normalizedHeader.includes('订单') && (normalizedHeader.includes('号') || normalizedHeader.includes('编号') || normalizedHeader.includes('id'))
  }) ?? headers[0]
}

export function runLocalOrderFilter(callTables: LocalOrderTable[], mainTable: LocalOrderTable): LocalOrderFilterResult {
  const calledOrders = new Set<string>()
  for (const table of callTables) {
    const column = chooseLocalOrderColumn(table.headers)
    if (!column) throw new Error('飞鸽外呼记录表找不到订单号列。')
    for (const row of table.rows) {
      const order = normalizeOrderValue(row[column])
      if (order) calledOrders.add(order)
    }
  }
  const mainColumn = chooseLocalOrderColumn(mainTable.headers)
  if (!mainColumn) throw new Error('主系统订单总表找不到订单号列。')
  const seenMain = new Set<string>()
  const seenMissing = new Set<string>()
  const rows: Array<Record<string, string>> = []
  for (const row of mainTable.rows) {
    const order = normalizeOrderValue(row[mainColumn])
    if (!order) continue
    seenMain.add(order)
    if (!calledOrders.has(order) && !seenMissing.has(order)) {
      seenMissing.add(order)
      rows.push({...row})
    }
  }
  const previewColumns = [...mainTable.headers]
  for (const row of rows) for (const header of Object.keys(row)) if (!previewColumns.includes(header)) previewColumns.push(header)
  return {
    download_name: '未外呼订单列表.csv',
    preview_columns: previewColumns.length ? previewColumns : [mainColumn],
    preview_rows: rows.slice(0, 100),
    rows,
    summary: {
      call_files: callTables.length,
      call_unique_orders: calledOrders.size,
      main_rows: mainTable.rows.length,
      main_unique_orders: seenMain.size,
      missing_orders: rows.length
    }
  }
}

function csvValue(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

export function downloadLocalOrderResult(result: LocalOrderFilterResult): void {
  const lines = [result.preview_columns, ...result.rows.map(row => result.preview_columns.map(column => row[column] ?? ''))]
    .map(row => row.map(value => csvValue(value)).join(','))
  const url = URL.createObjectURL(new Blob([`\uFEFF${lines.join('\r\n')}`], {type: 'text/csv;charset=utf-8'}))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = result.download_name
  anchor.style.display = 'none'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
