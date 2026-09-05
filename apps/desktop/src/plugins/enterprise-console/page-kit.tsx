/**
 * Shared page kit — thin reuse of SDK primitives (React Query + Loader /
 * ErrorState / EmptyState). No new data or table framework: pages call
 * `useConsoleQuery` and render rows with `QueryBody` + a `ScrollArea`, matching
 * the Kanban plugin's approach. `not_implemented` (server module unassembled,
 * 501) gets its own honest state rather than a raw error.
 */

import { EmptyState, ErrorState, Loader, ScrollArea, usePluginI18n, useQuery } from '@hermes/plugin-sdk'
import type { ReactNode } from 'react'

import { HermesApiError } from './fetch-transport'
import { useTransport } from './transport'

/** Format a server timestamp (epoch SECONDS) for display. */
export function fmtEpoch(seconds: null | number | undefined): string {
  if (seconds == null) {
    return '—'
  }

  return new Date(seconds * 1000).toLocaleString()
}

/**
 * Format a server ISO-8601 timestamp (a TIMESTAMPTZ serialized via `.isoformat()`
 * by the SC read models) for display. Distinct from `fmtEpoch`: the console read
 * surfaces (follow-up, channel-binding, conversations, audit, wecom) return ISO
 * strings, not epoch seconds — passing those to `fmtEpoch` yields "Invalid Date".
 */
export function fmtIso(iso: null | string | undefined): string {
  if (iso == null || iso === '') {
    return '—'
  }

  const date = new Date(iso)

  return Number.isNaN(date.getTime()) ? String(iso) : date.toLocaleString()
}

export function useConsoleQuery<T>(queryKey: readonly unknown[], path: string, refetchInterval = 30_000) {
  const transport = useTransport()

  return useQuery({
    queryFn: () => transport.get<T>(path),
    queryKey,
    refetchInterval
  })
}

interface QueryLike<T> {
  data?: T
  error: unknown
  isPending: boolean
}

export function QueryBody<T>({
  children,
  emptyText,
  isEmpty,
  query
}: {
  children: (data: T) => ReactNode
  emptyText: string
  isEmpty?: (data: T) => boolean
  query: QueryLike<T>
}) {
  const t = usePluginI18n('enterprise-console')

  if (query.isPending) {
    return <Loader />
  }

  if (query.error) {
    if (query.error instanceof HermesApiError && query.error.code === 'not_implemented') {
      return <EmptyState description={t('status.moduleBody')} title={t('status.module')} />
    }

    return <ErrorState description={String((query.error as Error).message)} title={t('status.error')} />
  }

  const data = query.data as T

  if (isEmpty?.(data)) {
    return <EmptyState title={emptyText} />
  }

  return <>{children(data)}</>
}

/** A scrollable rows container — the console's list surface (no virtualization;
 *  Phase-1 lists are small and server-scoped). */
export function ConsoleRows({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <ScrollArea className="h-full">
      <ul className="flex flex-col gap-1" data-testid={testId}>
        {children}
      </ul>
    </ScrollArea>
  )
}
