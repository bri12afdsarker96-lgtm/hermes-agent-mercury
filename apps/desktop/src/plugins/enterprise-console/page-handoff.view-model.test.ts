/**
 * Handoff page — ViewModel tests (W1-C §P20).
 *
 * Pure-function tests for the page-handoff.view-model derivations.
 * No React, no transport, no session atom, no mocks.
 */

import { describe, expect, it } from 'vitest'

import type { HandoffRow } from './page-handoff.controller'
import {
  ageTone,
  deriveHandoff,
  deriveHandoffs,
  type HandoffRowView,
  isHandoffsEmpty,
  STATE_TONE,
  stateTone,
} from './page-handoff.view-model'

const H1: HandoffRow = {
  agent_id: null,
  claim_age_s: 12,
  expires_in_s: 300,
  msg_id: 'm1',
  state: 'parked',
  status: null,
  text: 'first handoff',
  thread_id: 't1',
}

const H2: HandoffRow = {
  ...H1,
  msg_id: 'm2',
  agent_id: 'agent-1',
  state: 'open',
  status: 'claimed',
  text: 'claimed handoff',
  claim_age_s: 45,
}

const H3: HandoffRow = {
  ...H1,
  msg_id: 'm3',
  agent_id: 'agent-1',
  state: 'escalated',
  status: 'claimed',
  claim_age_s: 75,
}

const H4: HandoffRow = {
  ...H1,
  msg_id: 'm4',
  agent_id: 'agent-2',
  state: 'parked',
  status: null,
  claim_age_s: null, // never claimed
  text: 'unknown state',
}

describe('stateTone (per P20 state tone truth)', () => {
  it('escalated → warn', () => {
    expect(stateTone('escalated')).toBe('warn')
  })
  it('parked → muted', () => {
    expect(stateTone('parked')).toBe('muted')
  })
  it('unknown → muted', () => {
    expect(stateTone('weird-state')).toBe('muted')
  })
  it('STATE_TONE table matches pre-split', () => {
    expect(STATE_TONE).toEqual({ escalated: 'warn', parked: 'muted' })
  })
})

describe('ageTone (per P20 age tone truth)', () => {
  it('null → muted', () => {
    expect(ageTone(null)).toBe('muted')
  })
  it('< 30s → good', () => {
    expect(ageTone(0)).toBe('good')
    expect(ageTone(29)).toBe('good')
  })
  it('30s..59s → warn', () => {
    expect(ageTone(30)).toBe('warn')
    expect(ageTone(59)).toBe('warn')
  })
  it('>= 60s → bad', () => {
    expect(ageTone(60)).toBe('bad')
    expect(ageTone(120)).toBe('bad')
  })
})

describe('deriveHandoff (wire → presentation)', () => {
  it('unclaimed parked: only claim action eligible', () => {
    const v: HandoffRowView = deriveHandoff(H1)
    expect(v.msgId).toBe('m1')
    expect(v.text).toBe('first handoff')
    expect(v.threadId).toBe('t1')
    expect(v.agentDisplay).toBe('unclaimed')
    expect(v.statusDisplay).toBe('')
    expect(v.state).toBe('parked')
    expect(v.ageSeconds).toBe(12)
    expect(v.ageTone).toBe('good')
    expect(v.stateTone).toBe('muted')
    expect(v.canClaim).toBe(true)
    expect(v.canReply).toBe(false)
    expect(v.canRequeue).toBe(true) // state === 'parked'
  })

  it('claimed by agent: only reply action eligible', () => {
    const v = deriveHandoff(H2)
    expect(v.agentDisplay).toBe('agent-1')
    expect(v.statusDisplay).toBe(' · claimed')
    expect(v.canClaim).toBe(false) // agent_id != null
    expect(v.canReply).toBe(true) // status === 'claimed'
    expect(v.canRequeue).toBe(false) // state === 'open', not 'parked'
    expect(v.ageTone).toBe('warn')
  })

  it('escalated claimed: only reply action eligible', () => {
    const v = deriveHandoff(H3)
    expect(v.canClaim).toBe(false)
    expect(v.canReply).toBe(true)
    expect(v.canRequeue).toBe(false) // state === 'escalated', not 'parked'
    expect(v.stateTone).toBe('warn')
    expect(v.ageTone).toBe('bad') // 75 >= 60
  })

  it('agent with parked state: claim + requeue eligible (cannot reply)', () => {
    const v = deriveHandoff(H4)
    expect(v.agentDisplay).toBe('agent-2')
    expect(v.canClaim).toBe(false) // agent_id != null
    expect(v.canReply).toBe(false) // status === null, not 'claimed'
    expect(v.canRequeue).toBe(true) // state === 'parked'
    expect(v.ageSeconds).toBe(null)
    expect(v.ageTone).toBe('muted')
  })
})

describe('deriveHandoffs (multi-row)', () => {
  it('returns [] for null/undefined', () => {
    expect(deriveHandoffs(null)).toEqual([])
    expect(deriveHandoffs(undefined)).toEqual([])
  })
  it('maps each row', () => {
    const out = deriveHandoffs([H1, H2, H3, H4])
    expect(out).toHaveLength(4)
    expect(out[0]?.msgId).toBe('m1')
    expect(out[1]?.msgId).toBe('m2')
    expect(out[2]?.msgId).toBe('m3')
    expect(out[3]?.msgId).toBe('m4')
  })
})

describe('isHandoffsEmpty (per P21 empty semantics)', () => {
  it('returns true for null', () => {
    expect(isHandoffsEmpty(null)).toBe(true)
  })
  it('returns true when available=false', () => {
    expect(isHandoffsEmpty({ available: false, handoffs: [{}] })).toBe(true)
  })
  it('returns true when handoffs empty', () => {
    expect(isHandoffsEmpty({ available: true, handoffs: [] })).toBe(true)
  })
  it('returns false when available=true and handoffs non-empty', () => {
    expect(isHandoffsEmpty({ available: true, handoffs: [{}] })).toBe(false)
  })
})