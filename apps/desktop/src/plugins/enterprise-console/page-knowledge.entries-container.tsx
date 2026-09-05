/**
 * Knowledge page — selection-bound container for collection entries.
 *
 * Per W1-B2-REMEDIATION-01 §P2 + §P13 + §P15:
 *   - This container is mounted ONLY when `selectedCollection !== ''`.
 *   - The parent (SourcesList in the view) passes `key={collection}`
 *     so React tears down the old container (and its React Query
 *     subscription) the moment the user picks a different collection.
 *   - The useKbEntries hook is called only inside this container,
 *     so no initial `?collection=` request fires on page mount.
 *   - The container reads the hook result and passes a fully-derived
 *     VM + loading/error state to a presentational EntriesList.
 *   - NO parent-cached state. NO useEffect → setState relay.
 */

import type { ReactNode } from 'react'

import { useKbEntries } from './page-knowledge.controller'
import { EntriesList, type EntryRowActionsSlotProps } from './page-knowledge.view'
import { deriveEntries } from './page-knowledge.view-model'

export function KnowledgeEntriesContainer({
  collection,
  entryRowActionsSlot,
}: {
  collection: string
  entryRowActionsSlot: (props: EntryRowActionsSlotProps) => ReactNode
}) {
  // The hook is mounted only when this component is rendered, which
  // is conditional on a non-empty `collection` from the parent.
  const query = useKbEntries(collection)
  const entries = deriveEntries(query.data)

  return (
    <EntriesList
      entries={entries}
      entriesError={query.error}
      entriesIsPending={query.isPending}
      entryRowActionsSlot={entryRowActionsSlot}
      selectedCollection={collection}
    />
  )
}