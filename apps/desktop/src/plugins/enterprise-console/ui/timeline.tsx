/**
 * Timeline — the detail panel's audit record from the approved Enterprise
 * Desktop design. One of only three genuinely-new components in this layer;
 * everything else adopts an existing app primitive.
 *
 * WHAT THIS IS NOT. Two other "timelines" already exist in this app and neither
 * one fits, which is why a third exists at all:
 *
 *  - `src/components/assistant-ui/thread/timeline.tsx` is the CHAT TRANSCRIPT
 *    scrubber — a hover-driven, viewport-synced index of assistant messages. It
 *    is bound to `@assistant-ui`'s runtime and answers "where am I in this
 *    conversation", not "what did the server do to this record".
 *  - the starmap scrubber is a time AXIS the user drags. Also not this.
 *
 * This one is a static, server-authored, append-only list of facts: status
 * transitions, operator notes, scheduled reminders. It reads top-to-bottom and
 * nothing about it is interactive.
 *
 * Three product rules are encoded here rather than left to call sites:
 *
 * 1. A TIMESTAMP IS NEVER FABRICATED. `timestamp` is optional, and an event
 *    without one renders NO `<time>` element at all — not "just now", not the
 *    render time. An unparseable value is treated the same way. A timeline that
 *    invents when something happened is worse than one that admits it does not
 *    know, because the whole surface is an audit trail.
 *
 * 2. COLOUR NEVER CARRIES THE MEANING. `StatusDot` is `aria-hidden`, so every
 *    tone is also stated in words (`TONE_TEXT`) for assistive tech, and the
 *    'schedule' variant announces itself as not-yet-happened rather than
 *    relying on the hollow marker alone.
 *
 * 3. FLAT, NOT BOXED. The design's rail is a 1px hairline and nothing else — no
 *    card, no border box, no shadow per entry. The rail is drawn per row and
 *    omitted on the last one so it terminates at the final marker instead of
 *    dangling past it.
 *
 * Machine facts (the absolute datetime) get `data-ec-mono`, which `./console.css`
 * already styles with the host mono face and tabular figures. Ids and version
 * strings are never prettified — `id` is a React key here and is not rendered.
 */

import { cn, fmtDateTime, relativeTime, StatusDot, type StatusTone } from '@hermes/plugin-sdk'
import type { ReactNode } from 'react'

export interface TimelineEvent {
  description?: ReactNode
  id: string
  /**
   * Epoch milliseconds or an ISO-8601 string — whatever `new Date()` accepts.
   * Absent (or unparseable) means "the server did not say when", and nothing is
   * rendered for it.
   */
  timestamp?: number | string
  title: ReactNode
  tone?: StatusTone
  /** 'schedule' is a FUTURE event (a pending reminder), drawn hollow. */
  variant?: 'dot' | 'schedule'
}

export interface TimelineProps {
  /** Rendered instead of the rail when there are no events. No default — a
   *  caller that supplies nothing gets nothing, not an invented message. */
  empty?: ReactNode
  events: TimelineEvent[]
  /** Accessible name for the ordered list. */
  label: string
}

/** Tone in words, so the meaning survives without colour. */
const TONE_TEXT: Record<StatusTone, string> = {
  bad: 'Error',
  good: 'Success',
  muted: 'Info',
  warn: 'Warning'
}

/** Hollow-marker stroke per tone, from console.css's `--ec-status-*` set. */
const TONE_STROKE: Record<StatusTone, string> = {
  bad: 'border-(--ec-status-danger)',
  good: 'border-(--ec-status-success)',
  muted: 'border-(--ec-status-neutral)',
  warn: 'border-(--ec-status-warning)'
}

function toDate(timestamp: TimelineEvent['timestamp']): Date | null {
  if (timestamp === undefined) {
    return null
  }

  const date = new Date(timestamp)

  return Number.isNaN(date.getTime()) ? null : date
}

function EventTime({ timestamp }: { timestamp: TimelineEvent['timestamp'] }) {
  const date = toDate(timestamp)

  if (!date) {
    return null
  }

  return (
    <span className="flex flex-wrap items-baseline gap-x-2 text-(--ui-text-tertiary)">
      <time className="text-[0.6875rem]" data-ec-mono="" dateTime={date.toISOString()}>
        {fmtDateTime.format(date)}
      </time>
      <span className="text-[0.6875rem]">{relativeTime(date.getTime())}</span>
    </span>
  )
}

export function Timeline({ empty, events, label }: TimelineProps) {
  if (events.length === 0) {
    return empty ? (
      <div className="text-(--ui-text-tertiary)" data-slot="ec-timeline-empty">
        {empty}
      </div>
    ) : null
  }

  return (
    <ol aria-label={label} className="flex flex-col" data-slot="ec-timeline">
      {events.map((event, index) => {
        const tone = event.tone ?? 'muted'
        const variant = event.variant ?? 'dot'
        const scheduled = variant === 'schedule'

        return (
          <li
            className="relative flex gap-(--ec-gutter) pb-(--ec-gutter) last:pb-0"
            data-ec-variant={variant}
            data-slot="ec-timeline-event"
            key={event.id}
          >
            {index < events.length - 1 ? (
              <span
                aria-hidden="true"
                className="absolute top-5 bottom-0 left-1 w-px bg-(--ui-stroke-tertiary)"
                data-slot="ec-timeline-rail"
              />
            ) : null}

            <span className="relative flex h-5 w-2 shrink-0 items-center justify-center">
              <StatusDot
                className={cn(scheduled && ['size-2 border bg-transparent', TONE_STROKE[tone]])}
                data-slot="ec-timeline-marker"
                tone={tone}
              />
            </span>

            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-(--ui-text-primary)" data-slot="ec-timeline-title">
                <span className="sr-only">
                  {TONE_TEXT[tone]}
                  {scheduled ? ', scheduled' : ''}:{' '}
                </span>
                {event.title}
              </span>

              {event.description ? (
                <span className="text-(--ui-text-secondary)" data-slot="ec-timeline-description">
                  {event.description}
                </span>
              ) : null}

              <EventTime timestamp={event.timestamp} />
            </div>
          </li>
        )
      })}
    </ol>
  )
}
