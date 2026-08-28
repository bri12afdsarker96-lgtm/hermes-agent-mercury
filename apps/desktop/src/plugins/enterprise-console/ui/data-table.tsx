/**
 * The Enterprise Console's one and only tabular primitive.
 *
 * WHY IT EXISTS: the approved design shows the same 40px-row, hairline-divided,
 * quiet-header grid on a dozen console pages (usage, tasks, identity, alerts).
 * Hand-rolling that markup per page would drift — different paddings, different
 * dividers, different header weights — so the geometry is pinned once here and
 * derived from `./console.css` (`--ec-row-h`) and the host's `--ui-*` theme
 * tokens, which means the table follows light/dark and user skins for free.
 *
 * WHAT IT DELIBERATELY IS NOT: this is a dumb table, not a table engine. There
 * is no sorting, no pagination, no virtualisation, no column resizing and no
 * responsive column hiding, and no table library is used or wanted — the repo
 * rejected @tanstack/react-table on purpose. Each of those features would pull
 * state and a plugin surface into what is currently a pure render of `rows`,
 * and once one lands the rest follow. If a page needs sorted or paged data it
 * sorts or pages the array it passes in; the ordering decision belongs to the
 * page, which knows the domain, not to the renderer.
 *
 * It also invents no empty-state copy: an empty `rows` array renders whatever
 * the caller passed as `empty`, and nothing at all if they passed nothing.
 *
 * Selection note: rows carry `tabIndex`/`aria-selected` rather than wrapping
 * every cell in a button, because a `<button>` per cell destroys the row's
 * table semantics (and its alignment) for the screen-reader users who benefit
 * from them most. The row stays a real `<tr>` inside a real `<table>` and is
 * operated with Enter/Space, which is the closest honest mapping available
 * without escalating to a full `role="grid"` widget the design does not ask for.
 */

import { cn } from '@hermes/plugin-sdk'
import type { KeyboardEvent, ReactNode } from 'react'

export interface DataTableColumn<T> {
  /** Horizontal alignment of the column body and its header. Numerics use `end`. */
  align?: 'end' | 'start'
  /**
   * Formats one row into this column's cell content. Named `cell` and not
   * `render` on purpose: the repo bans `.render(…)` calls inside JSX (that
   * shape is the plugin-contribution hazard behind React #310), and the
   * escape hatch it names lives behind the plugin fence.
   */
  cell: (row: T) => ReactNode
  /** Machine figures: opts the column into `[data-ec-figure]` tabular numerals. */
  figure?: boolean
  header: ReactNode
  key: string
  /** Any CSS width, passed straight through to the header cell. */
  width?: string
}

export interface DataTableProps<T> {
  /** Accessible name for the table. Rendered as a visually hidden `<caption>`. */
  caption?: string
  columns: DataTableColumn<T>[]
  /** Rendered in place of the rows when `rows` is empty. No default copy. */
  empty?: ReactNode
  onRowSelect?: (row: T) => void
  rowKey: (row: T) => string
  rows: T[]
  selectedKey?: string
}

const CELL = 'px-5 py-2.5 align-middle'

function alignClass(align: DataTableColumn<unknown>['align']) {
  return align === 'end' ? 'text-end' : 'text-start'
}

export function DataTable<T>({ caption, columns, empty, onRowSelect, rowKey, rows, selectedKey }: DataTableProps<T>) {
  const selectable = Boolean(onRowSelect)

  function handleKeyDown(event: KeyboardEvent<HTMLTableRowElement>, row: T) {
    if (!onRowSelect || (event.key !== 'Enter' && event.key !== ' ')) {
      return
    }

    // Space would otherwise scroll the console page out from under the row.
    event.preventDefault()
    onRowSelect(row)
  }

  function renderRow(row: T) {
    const key = rowKey(row)
    const selected = selectable && selectedKey !== undefined && selectedKey === key

    return (
      <tr
        aria-selected={selectable ? selected : undefined}
        className={cn(
          'h-(--ec-row-h) border-b border-(--ui-stroke-tertiary) last:border-b-0',
          'hover:bg-(--ui-row-hover-background)',
          selectable && 'cursor-pointer',
          selected && 'bg-(--ui-row-active-background)'
        )}
        data-selected={selected ? '' : undefined}
        key={key}
        onClick={onRowSelect ? () => onRowSelect(row) : undefined}
        onKeyDown={selectable ? event => handleKeyDown(event, row) : undefined}
        tabIndex={selectable ? 0 : undefined}
      >
        {columns.map(column => (
          <td
            className={cn(CELL, alignClass(column.align))}
            data-ec-figure={column.figure ? '' : undefined}
            key={column.key}
          >
            {column.cell(row)}
          </td>
        ))}
      </tr>
    )
  }

  function renderEmpty() {
    if (empty === undefined || empty === null) {
      return null
    }

    return (
      <tr data-slot="data-table-empty">
        <td className={CELL} colSpan={columns.length}>
          {empty}
        </td>
      </tr>
    )
  }

  return (
    <div className="w-full overflow-x-auto" data-slot="data-table-scroll">
      <table className="w-full border-collapse text-start" data-slot="data-table">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr className="h-(--ec-row-h) border-b border-(--ui-stroke-tertiary) bg-(--ui-bg-secondary)">
            {columns.map(column => (
              <th
                className={cn(CELL, alignClass(column.align), 'text-xs font-medium text-(--ui-text-secondary)')}
                data-ec-figure={column.figure ? '' : undefined}
                key={column.key}
                scope="col"
                style={column.width ? { width: column.width } : undefined}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{rows.length === 0 ? renderEmpty() : rows.map(renderRow)}</tbody>
      </table>
    </div>
  )
}
