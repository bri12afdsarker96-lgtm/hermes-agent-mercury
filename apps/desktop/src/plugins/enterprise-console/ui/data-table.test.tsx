import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DataTable, type DataTableColumn } from './data-table'

afterEach(cleanup)

interface Usage {
  id: string
  name: string
  tokens: number
}

const ROWS: Usage[] = [
  { id: 'u-1', name: 'Alpha', tokens: 1200 },
  { id: 'u-2', name: 'Beta', tokens: 34 }
]

const COLUMNS: DataTableColumn<Usage>[] = [
  { cell: row => row.name, header: 'Name', key: 'name' },
  { align: 'end', cell: row => String(row.tokens), figure: true, header: 'Tokens', key: 'tokens', width: '8rem' }
]

describe('DataTable', () => {
  it('renders a real table with a thead, a tbody and column-scoped headers', () => {
    const { container } = render(<DataTable caption="Usage" columns={COLUMNS} rowKey={row => row.id} rows={ROWS} />)
    const table = container.querySelector('[data-slot="data-table"]')

    expect(table).toBeTruthy()
    expect(table?.tagName).toBe('TABLE')
    expect(table?.querySelector('thead')).toBeTruthy()
    expect(table?.querySelector('tbody')).toBeTruthy()

    const headers = Array.from(table?.querySelectorAll('th') ?? [])

    expect(headers.map(th => th.textContent)).toEqual(['Name', 'Tokens'])
    expect(headers.every(th => th.getAttribute('scope') === 'col')).toBe(true)
  })

  it('names the table with a visually hidden caption', () => {
    const { container } = render(
      <DataTable caption="Usage by tenant" columns={COLUMNS} rowKey={row => row.id} rows={ROWS} />
    )

    const caption = container.querySelector('caption')

    expect(caption?.textContent).toBe('Usage by tenant')
    expect(caption?.className).toContain('sr-only')
  })

  it('renders one body row per item and asks rowKey for each identity', () => {
    const rowKey = vi.fn((row: Usage) => row.id)
    const { container } = render(<DataTable columns={COLUMNS} rowKey={rowKey} rows={ROWS} />)
    const bodyRows = container.querySelectorAll('tbody tr')

    expect(bodyRows.length).toBe(2)
    expect(bodyRows[0].querySelectorAll('td').length).toBe(2)
    expect(bodyRows[0].textContent).toContain('Alpha')
    expect(bodyRows[1].textContent).toContain('34')
    expect(rowKey.mock.calls.map(call => call[0].id)).toEqual(['u-1', 'u-2'])
  })

  it('applies align and figure to both the header and the body cells of a column', () => {
    const { container } = render(<DataTable columns={COLUMNS} rowKey={row => row.id} rows={ROWS} />)
    const [nameHeader, tokensHeader] = Array.from(container.querySelectorAll('th'))
    const firstRowCells = Array.from(container.querySelectorAll('tbody tr')[0].querySelectorAll('td'))

    expect(nameHeader.className).toContain('text-start')
    expect(nameHeader.hasAttribute('data-ec-figure')).toBe(false)
    expect(tokensHeader.className).toContain('text-end')
    expect(tokensHeader.hasAttribute('data-ec-figure')).toBe(true)

    expect(firstRowCells[0].className).toContain('text-start')
    expect(firstRowCells[0].hasAttribute('data-ec-figure')).toBe(false)
    expect(firstRowCells[1].className).toContain('text-end')
    expect(firstRowCells[1].hasAttribute('data-ec-figure')).toBe(true)
  })

  it('passes a caller-supplied column width through to the header cell', () => {
    const { container } = render(<DataTable columns={COLUMNS} rowKey={row => row.id} rows={ROWS} />)
    const [nameHeader, tokensHeader] = Array.from(container.querySelectorAll('th'))

    expect(tokensHeader.style.width).toBe('8rem')
    expect(nameHeader.style.width).toBe('')
  })

  it('renders the caller-owned empty slot when there are no rows', () => {
    const { container, getByText } = render(
      <DataTable columns={COLUMNS} empty={<span>Nothing yet</span>} rowKey={row => row.id} rows={[]} />
    )

    expect(getByText('Nothing yet')).toBeTruthy()
    expect(container.querySelectorAll('tbody tr').length).toBe(1)
    expect(container.querySelector('tbody td')?.getAttribute('colspan')).toBe('2')
  })

  it('invents no empty state when the caller supplies none', () => {
    const { container } = render(<DataTable columns={COLUMNS} rowKey={row => row.id} rows={[]} />)

    expect(container.querySelectorAll('tbody tr').length).toBe(0)
    expect(container.querySelectorAll('th').length).toBe(2)
  })

  it('leaves rows inert when no onRowSelect is given', () => {
    const { container } = render(<DataTable columns={COLUMNS} rowKey={row => row.id} rows={ROWS} />)
    const row = container.querySelectorAll('tbody tr')[0]

    expect(row.hasAttribute('tabindex')).toBe(false)
    expect(row.hasAttribute('aria-selected')).toBe(false)
  })

  it('makes rows selectable by pointer and by keyboard, and marks the selected one', () => {
    const onRowSelect = vi.fn()

    const { container } = render(
      <DataTable columns={COLUMNS} onRowSelect={onRowSelect} rowKey={row => row.id} rows={ROWS} selectedKey="u-2" />
    )

    const [first, second] = Array.from(container.querySelectorAll('tbody tr'))

    expect(first.getAttribute('tabindex')).toBe('0')
    expect(first.getAttribute('aria-selected')).toBe('false')
    expect(second.getAttribute('aria-selected')).toBe('true')

    fireEvent.click(first)
    expect(onRowSelect).toHaveBeenCalledTimes(1)
    expect(onRowSelect.mock.calls[0][0]).toEqual(ROWS[0])

    fireEvent.keyDown(second, { key: 'Enter' })
    expect(onRowSelect).toHaveBeenCalledTimes(2)
    expect(onRowSelect.mock.calls[1][0]).toEqual(ROWS[1])

    fireEvent.keyDown(second, { key: ' ' })
    expect(onRowSelect).toHaveBeenCalledTimes(3)

    fireEvent.keyDown(second, { key: 'a' })
    expect(onRowSelect).toHaveBeenCalledTimes(3)
  })

  it('keeps a wide table inside its own horizontal scroll container', () => {
    const wide: DataTableColumn<Usage>[] = Array.from({ length: 12 }, (_, index) => ({
      cell: row => row.name,
      header: `Col ${index}`,
      key: `c${index}`
    }))

    const { container } = render(<DataTable columns={wide} rowKey={row => row.id} rows={ROWS} />)
    const scroller = container.querySelector('[data-slot="data-table-scroll"]')

    expect(scroller).toBeTruthy()
    expect(scroller?.className).toContain('overflow-x-auto')
    expect(scroller?.querySelector('[data-slot="data-table"]')).toBeTruthy()
    expect(container.querySelectorAll('th').length).toBe(12)
  })
})
