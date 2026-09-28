import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'

import { parseLocalOrderTable, runLocalOrderFilter, validateLocalOrderFiles } from './order-filter-local'

describe('local order filter', () => {
  it('keeps leading zeros while removing orders found in call records', () => {
    const result = runLocalOrderFilter(
      [{headers: ['订单号'], rows: [{订单号: '0001'}]}],
      {headers: ['订单号', '客户'], rows: [{订单号: '0001', 客户: '甲'}, {订单号: '0002', 客户: '乙'}]}
    )
    expect(result.preview_rows).toEqual([{订单号: '0002', 客户: '乙'}])
    expect(result.summary).toMatchObject({call_unique_orders: 1, missing_orders: 1})
  })

  it('keeps the browser-only size and file-count limits before parsing', () => {
    const files = Array.from({length: 21}, (_, index) => new File(['x'], `call-${index}.csv`))
    expect(validateLocalOrderFiles(files, new File(['x'], 'main.csv'))).toContain('最多 20 份')
  })

  it('reads a local XLSX first sheet without sending it through a runtime', async () => {
    const xlsx = zipSync({
      'xl/workbook.xml': strToU8('<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>'),
      'xl/_rels/workbook.xml.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
      'xl/worksheets/sheet1.xml': strToU8('<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>订单号</t></is></c><c r="B1" t="inlineStr"><is><t>客户</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>0001</t></is></c><c r="B2" t="inlineStr"><is><t>张三</t></is></c></row></sheetData></worksheet>')
    })
    await expect(parseLocalOrderTable(new File([xlsx], 'orders.xlsx'))).resolves.toEqual({
      headers: ['订单号', '客户'], rows: [{订单号: '0001', 客户: '张三'}]
    })
  })
})
