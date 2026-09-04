/**
 * Knowledge page — responsive / viewport test (LINE F).
 *
 * Per LINE F §P8:
 *   - no critical control clipping at representative widths
 *   - no inaccessible horizontal overflow for primary actions
 *   - table/list fallback usable at narrow width where applicable
 *
 * We do NOT change global breakpoints (per P8 last sentence). We
 * only verify that the new flex-wrap + grid-cols-1 fallback in the
 * presentational view produces a layout where primary actions remain
 * reachable at narrow viewports.
 *
 * This is a CSS class-string assertion + DOM role assertion, NOT a
 * real layout measurement (jsdom does not run layout). It guards
 * against accidental removal of the responsive class hooks.
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

describe('Knowledge responsive hooks (LINE F)', () => {
  it('top-level grid has narrow-viewport single-column fallback', () => {
    const { container } = wrap(
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

    // The first child grid under the page wrapper carries the
    // responsive column classes.
    const grids = container.querySelectorAll('div.grid')

    const topGrid = Array.from(grids).find((el) =>
      el.className.includes('grid-cols')
    )

    expect(topGrid).toBeTruthy()
    expect(topGrid!.className).toContain('lg:grid-cols-1')
    expect(topGrid!.className).toContain('xl:grid-cols-2')
  })

  it('upload row uses flex-wrap so actions wrap on narrow viewports', () => {
    const { container } = wrap(
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
    expect(row.className).toContain('flex-wrap')
    // The actions container should also wrap.
    const actionWrap = row.querySelector('div.flex.shrink-0') as HTMLElement
    expect(actionWrap).toBeTruthy()
    expect(actionWrap.className).toContain('flex-wrap')

    // No horizontal overflow: max-width inherits from the page wrapper
    const pageWrapper = container.querySelector(
      '[data-testid="console-page-knowledge"]',
    ) as HTMLElement

    expect(pageWrapper.className).toContain('max-w-[96rem]')
  })

  it('gap row uses flex-wrap so actions wrap on narrow viewports', () => {
    const { container } = wrap(
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

    const row = screen.getByTestId('kb-gap-row-g1')
    expect(row.className).toContain('flex-wrap')
    const candidatesSection = screen.getByTestId('console-kb-candidates')
    expect(candidatesSection.querySelectorAll('div.flex.flex-wrap').length).toBeGreaterThan(0)
  })
})
