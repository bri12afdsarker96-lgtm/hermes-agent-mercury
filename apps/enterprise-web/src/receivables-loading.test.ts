import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useReceivablesData } from '../../desktop/src/enterprise-client/workspace/receivables-data'
import type { EnterpriseClientRuntime } from '../../desktop/src/enterprise-client/runtime'

describe('report selection freshness', () => {
  it('does not expose previous selection as ready or leak a previous scope while reads are pending', async () => {
    const pending: ((value: unknown) => void)[] = []
    const get=vi.fn(()=>new Promise(resolve=>pending.push(resolve)))
    const runtime={get,disconnect:vi.fn()} as unknown as EnterpriseClientRuntime
    const result={available:true,summary_totals:[],daily:[],followups:[],total:0}
    const hook=renderHook(({scope,bucket})=>useReceivablesData(runtime,scope,{bucket}),{initialProps:{scope:'A',bucket:'due_today'}})
    await act(async()=>pending[0](result))
    await waitFor(()=>expect(hook.result.current.busy).toBe(false))
    hook.rerender({scope:'A',bucket:'unpaid'})
    expect(hook.result.current.busy).toBe(true)
    hook.rerender({scope:'B',bucket:'unpaid'})
    expect(hook.result.current.data).toBeNull()
    await act(async()=>pending[1]({...result,total:99}))
    expect(hook.result.current.data).toBeNull()
    await act(async()=>pending[2](result))
    await waitFor(()=>expect(hook.result.current.busy).toBe(false))
    expect(hook.result.current.data?.total).toBe(0)
    hook.unmount()
  })
})
