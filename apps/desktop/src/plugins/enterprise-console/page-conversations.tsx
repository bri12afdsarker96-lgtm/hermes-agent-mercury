/**
 * Conversations page — Glue layer.
 *
 * Owns: tab state, selected-outbound state. Composes: controller
 * queries + view-model derivation + view rendering. This is the only
 * file that imports the controller and the view.
 *
 * Wave 1 / Step 6 of W5-B0 Controller/View Contract Freeze.
 */

import { useCallback, useState } from 'react'

import { findPage } from './catalog'
import { QueryBody } from './page-kit'
import { useWhoami } from './session'
import {
  type ConversationsTab,
  useConversationsAttempts,
  useConversationsInbound,
  useConversationsOutbound,
} from './page-conversations.controller'
import { deriveConversationsViewModel } from './page-conversations.view-model'
import { ConversationsView } from './page-conversations.view'

export function ConversationsPage() {
  const who = useWhoami()
  const inbound = useConversationsInbound()
  const outbound = useConversationsOutbound()
  const [tab, setTab] = useState<ConversationsTab>('inbound')
  const [selectedOutboundId, setSelectedOutboundId] = useState<null | string>(null)
  const attempts = useConversationsAttempts(selectedOutboundId)
  const page = findPage('conversations')!

  const onSwitchTab = useCallback((value: ConversationsTab) => {
    setTab(value)
    setSelectedOutboundId(null)
  }, [])

  const onSelectOutbound = useCallback((id: string) => {
    setSelectedOutboundId(prev => (prev === id ? null : id))
  }, [])

  return (
    <QueryBody emptyText="no inbound" isEmpty={vm => vm.inboundEmpty} query={inbound}>
      {inboundData =>
        tab === 'inbound' ? (
          <ConversationsView
            vm={deriveConversationsViewModel({
              page,
              whoami: who,
              activeTab: 'inbound',
              selectedOutboundId: null,
              inbound: inboundData.inbound,
              outbound: outbound.data?.outbound,
              attempts: undefined,
            })}
            onSelectOutbound={onSelectOutbound}
            onSwitchTab={onSwitchTab}
          />
        ) : (
          <QueryBody
            emptyText="no outbound"
            isEmpty={vm => vm.outboundEmpty}
            query={outbound}
          >
            {outboundData => (
              <QueryBody
                emptyText="no attempts"
                isEmpty={vm => vm.attemptsEmpty}
                query={attempts}
              >
                {attemptsData => (
                  <ConversationsView
                    vm={deriveConversationsViewModel({
                      page,
                      whoami: who,
                      activeTab: 'outbound',
                      selectedOutboundId,
                      inbound: inboundData.inbound,
                      outbound: outboundData.outbound,
                      attempts: attemptsData.attempts,
                    })}
                    onSelectOutbound={onSelectOutbound}
                    onSwitchTab={onSwitchTab}
                  />
                )}
              </QueryBody>
            )}
          </QueryBody>
        )
      }
    </QueryBody>
  )
}