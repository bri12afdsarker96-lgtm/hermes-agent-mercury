/**
 * Knowledge page — a11y / keyboard test (LINE F).
 *
 * Per LINE F (P1-SECONDARY-VISUAL-RESPONSIVE-A11Y-01) §P8:
 *   - keyboard reachable actions (Preview / Publish / Rollback)
 *   - focus visible with existing theme (inherits from FormAction / Button)
 *   - dialog/form labels (Upload input, Withdraw / Author / Reject / Publish forms)
 *   - status not color-only (StatusDot always paired with text label)
 *   - empty/error text readable
 *
 * Pure render-only checks via @testing-library/react. No axe / jest-axe
 * dependency added — F line MUST NOT introduce cross-Lane dependency drift.
 *
 * No controller, no contract changes. Reads only the presentational view.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { KnowledgeView } from './page-knowledge.view'

function wrap(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

afterEach(cleanup)

describe('Knowledge a11y (LINE F)', () => {
  it('DEV banner uses role="status" so screen readers hear it', () => {
    wrap(
      <KnowledgeView
        capabilityStatus="DEV"
        collections={{ names: [] }}
        collectionsError={null}
        collectionsIsPending={false}
        entriesSlot={null}
        gaps={[]}
        gapsError={null}
        gapsIsPending={false}
        gapsRowActionsSlot={() => null}
        onChangeCollection={() => undefined}
        previewSlot={null}
        selectedCollection=""
        uploads={[]}
        uploadsError={null}
        uploadsIsPending={false}
        uploadsPanelSlot={null}
        uploadsRowActionsSlot={() => null}
      />,
    )

    const banner = screen.getByTestId('console-knowledge-dev')
    expect(banner.getAttribute('role')).toBe('status')
    expect(banner.getAttribute('aria-live')).toBe('polite')
  })

  it('section headings are h2 with linked aria-labelledby', () => {
    wrap(
      <KnowledgeView
        capabilityStatus="LIVE"
        collections={{ names: [] }}
        collectionsError={null}
        collectionsIsPending={false}
        entriesSlot={null}
        gaps={[]}
        gapsError={null}
        gapsIsPending={false}
        gapsRowActionsSlot={() => null}
        onChangeCollection={() => undefined}
        previewSlot={null}
        selectedCollection=""
        uploads={[]}
        uploadsError={null}
        uploadsIsPending={false}
        uploadsPanelSlot={null}
        uploadsRowActionsSlot={() => null}
      />,
    )

    const uploadsSection = screen.getByTestId('console-kb-uploads-section')
    const candidatesSection = screen.getByTestId('console-kb-candidates')
    const sourcesSection = screen.getByTestId('console-kb-sources')

    expect(uploadsSection.getAttribute('aria-labelledby')).toBe('console-kb-uploads-heading')
    expect(candidatesSection.getAttribute('aria-labelledby')).toBe('console-kb-candidates-heading')
    expect(sourcesSection.getAttribute('aria-labelledby')).toBe('console-kb-sources-heading')

    expect(screen.getByRole('heading', { level: 2, name: 'uploads' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: 'candidates / review' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: 'sources' })).toBeTruthy()
  })

  it('collection select has accessible label and id<->htmlFor pairing', () => {
    // Select is only rendered when there is at least one collection.
    wrap(
      <KnowledgeView
        capabilityStatus="LIVE"
        collections={{ names: ['docs', 'faqs'] }}
        collectionsError={null}
        collectionsIsPending={false}
        entriesSlot={null}
        gaps={[]}
        gapsError={null}
        gapsIsPending={false}
        gapsRowActionsSlot={() => null}
        onChangeCollection={() => undefined}
        previewSlot={null}
        selectedCollection=""
        uploads={[]}
        uploadsError={null}
        uploadsIsPending={false}
        uploadsPanelSlot={null}
        uploadsRowActionsSlot={() => null}
      />,
    )

    const select = screen.getByTestId('console-kb-collection-select')
    expect(select.tagName.toLowerCase()).toBe('select')
    expect(select.getAttribute('aria-label')).toBe('Knowledge collection')
    expect(select.getAttribute('id')).toBe('console-kb-collection-select')
  })

  it('upload rows expose aria-label combining filename + status', () => {
    wrap(
      <KnowledgeView
        capabilityStatus="LIVE"
        collections={{ names: [] }}
        collectionsError={null}
        collectionsIsPending={false}
        entriesSlot={null}
        gaps={[]}
        gapsError={null}
        gapsIsPending={false}
        gapsRowActionsSlot={() => null}
        onChangeCollection={() => undefined}
        previewSlot={null}
        selectedCollection=""
        uploads={[
          {
            uploadId: 'u1',
            filename: 'demo.txt',
            status: 'staged',
            tone: 'good',
            chunksCommitted: 0,
            chunksTotal: 5,
            collection: null,
            errorDetail: null,
            sizeBytes: 1024,
            updatedTsDisplay: 'just now',
            updatedTs: 0,
            canPreview: true,
            canPublish: true,
            canRollback: true,
          },
        ]}
        uploadsError={null}
        uploadsIsPending={false}
        uploadsPanelSlot={null}
        uploadsRowActionsSlot={() => null}
      />,
    )

    const row = screen.getByTestId('kb-upload-row-u1')
    expect(row.getAttribute('aria-label')).toContain('demo.txt')
    expect(row.getAttribute('aria-label')).toContain('staged')
  })

  it('status is NOT color-only: every StatusDot is paired with a text state', () => {
    wrap(
      <KnowledgeView
        capabilityStatus="LIVE"
        collections={{ names: [] }}
        collectionsError={null}
        collectionsIsPending={false}
        entriesSlot={null}
        gaps={[
          {
            gapId: 'g1',
            hits: 3,
            query: 'how do I reset',
            signal: 'rag:miss',
            status: 'new',
            tone: 'warn',
            tsLast: 0,
            tsLastDisplay: 'just now',
          },
        ]}
        gapsError={null}
        gapsIsPending={false}
        gapsRowActionsSlot={() => null}
        onChangeCollection={() => undefined}
        previewSlot={null}
        selectedCollection=""
        uploads={[]}
        uploadsError={null}
        uploadsIsPending={false}
        uploadsPanelSlot={null}
        uploadsRowActionsSlot={() => null}
      />,
    )

    // The gap row exposes the status text in its aria-label
    const gapRow = screen.getByTestId('kb-gap-row-g1')
    expect(gapRow.getAttribute('aria-label')).toContain('new')
    expect(gapRow.getAttribute('aria-label')).toContain('how do I reset')
    // The text node is also in the DOM (not just a colored dot)
    expect(screen.getByText('new')).toBeTruthy()
  })
})
