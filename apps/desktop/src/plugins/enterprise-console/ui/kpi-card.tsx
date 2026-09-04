/**
 * KpiCard — the dashboard metric tile from the approved Enterprise Desktop
 * design. One of only three genuinely-new components in this layer; everything
 * else adopts an existing app primitive.
 *
 * Two product rules are encoded here rather than left to call sites, because
 * both are easy to violate by accident and expensive to catch later:
 *
 * 1. A FIGURE IS NEVER FABRICATED. The workbench KPI strip has no server
 *    aggregation endpoint yet, so `value` is nullable and a null renders an
 *    em dash, not a zero. Note `compactNumber(null)` returns '0' — passing a
 *    missing value straight through would silently invent "0 pending items",
 *    which reads as real data. The guard below is the whole point.
 *
 * 2. A NUMBER CARRIES A COMPARISON. The design's rule is that a figure without
 *    a baseline is not shipped, so `delta` pairs a signed change with the
 *    period it is measured against ("较昨日"). Direction is carried by a glyph
 *    AND by text, never by colour alone.
 *
 * Delta colouring is deliberately inverted against finance convention: in a
 * worklist, MORE arriving work is pressure, not success. `--ec-delta-up` is
 * therefore red. That is the approved design's explicit choice, not a bug.
 */

import type { icons } from '@hermes/plugin-sdk'
import { cn, Skeleton } from '@hermes/plugin-sdk'

/** Product area whose accent hue the tile carries. Maps to `--ec-module-*`. */
export type KpiAccent = 'brand' | 'followup' | 'knowledge' | 'takeover'

export interface KpiDelta {
  /** 'flat' still renders — "no change against the baseline" is a real answer. */
  direction: 'down' | 'flat' | 'up'
  /** The baseline being compared against, e.g. 较昨日 / 较上月. */
  label: string
  value: number
}

export interface KpiCardProps {
  accent?: KpiAccent
  delta?: KpiDelta
  icon: icons.IconComponent
  label: string
  /** First paint, before the server has answered. Holds the real geometry. */
  loading?: boolean
  /**
   * null / undefined means "the server has no answer for this yet" and renders
   * an em dash. It must never be coerced to 0.
   */
  value?: null | number | string
}

const DELTA_GLYPH: Record<KpiDelta['direction'], string> = { down: '↓', flat: '—', up: '↑' }

/** Direction in words, so the meaning survives without colour or glyph. */
const DELTA_TEXT: Record<KpiDelta['direction'], string> = { down: '减少', flat: '持平', up: '增加' }

function formatValue(value: KpiCardProps['value']): string {
  if (value === null || value === undefined) {
    return '—'
  }

  return typeof value === 'number' ? value.toLocaleString() : value
}

export function KpiCard({ accent = 'brand', delta, icon: Icon, label, loading = false, value }: KpiCardProps) {
  return (
    <div
      className="flex items-start gap-3 rounded-(--ec-panel-radius) border border-(--ui-stroke-secondary) bg-(--ui-bg-card) p-(--ec-panel-pad)"
      data-ec-accent={accent}
      data-slot="ec-kpi-card"
    >
      <span
        aria-hidden="true"
        className="flex size-(--ec-tile) shrink-0 items-center justify-center rounded-lg"
        data-slot="ec-kpi-tile"
      >
        <Icon className="size-5" stroke={1.5} />
      </span>

      <div className="flex min-w-0 flex-col gap-1">
        <span className="truncate text-(--ui-text-secondary)">{label}</span>

        {loading ? (
          // Same 40px box the figure occupies, so the strip does not reflow
          // when the server answers.
          <Skeleton className="h-10 w-20" data-slot="ec-kpi-skeleton" />
        ) : (
          <span
            className="text-[2.125rem] leading-10 font-bold text-(--ui-text-primary)"
            data-ec-figure=""
            data-slot="ec-kpi-value"
          >
            {formatValue(value)}
          </span>
        )}

        {delta ? (
          <span className="flex items-center gap-1 text-(--ui-text-tertiary)" data-slot="ec-kpi-delta">
            <span aria-hidden="true" className={cn('font-medium', deltaClass(delta.direction))} data-ec-figure="">
              {DELTA_GLYPH[delta.direction]}
              {Math.abs(delta.value).toLocaleString()}
            </span>
            <span className="sr-only">
              {DELTA_TEXT[delta.direction]} {Math.abs(delta.value).toLocaleString()}，
            </span>
            {delta.label}
          </span>
        ) : null}
      </div>
    </div>
  )
}

function deltaClass(direction: KpiDelta['direction']): string {
  if (direction === 'up') {
    return 'text-(--ec-delta-up)'
  }

  return direction === 'down' ? 'text-(--ec-delta-down)' : 'text-(--ec-delta-flat)'
}
