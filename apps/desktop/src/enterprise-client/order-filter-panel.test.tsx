import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { OrderFilterPanel } from './order-filter-panel'

describe('OrderFilterPanel', () => {
  it('parses source files and calculates the set difference without a server runtime', async () => {
    render(<OrderFilterPanel />)
    const call = new File(['订单号\n0001\n'], 'calls.csv', {type: 'text/csv'})
    const main = new File(['订单号,客户\n0001,甲\n0002,乙\n'], 'main.csv', {type: 'text/csv'})
    fireEvent.change(screen.getByLabelText('飞鸽外呼记录（可多选）'), {target: {files: [call]}})
    fireEvent.change(screen.getByLabelText('主系统订单总表'), {target: {files: [main]}})
    fireEvent.click(screen.getByRole('button', {name: '在本地生成未外呼订单列表'}))
    await waitFor(() => expect(screen.getByText(/已在本地合并 1 份外呼记录/)).toBeTruthy())
    expect(screen.getByText('仅在本地处理')).toBeTruthy()
    expect(screen.getByText('匹配结果仅写入下载文件，不在页面预览订单数据。')).toBeTruthy()
    expect(screen.queryByText('0002')).toBeNull()
  })
})
