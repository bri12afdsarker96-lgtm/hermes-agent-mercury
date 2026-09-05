import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { CapabilityPolicyPanel } from './capability-policy-panel'
import type { EnterpriseClientRuntime } from './runtime'

describe('CapabilityPolicyPanel', () => {
  it('reads the server-owned tenant policy matrix without offering local toggles', async () => {
    const get = vi.fn(async () => ({
      mode: 'postgres',
      policy: {
        operator: {
          reminder_center: { enabled: true, manageable: true, status: 'LIVE' },
          team_tasks: { enabled: false, manageable: true, status: 'LIVE' }
        }
      },
      revision: 7,
      target_roles: ['operator']
    }))

    const runtime: EnterpriseClientRuntime = {
      disconnect: vi.fn(async () => undefined),
      get: get as EnterpriseClientRuntime['get']
    }

    render(<CapabilityPolicyPanel runtime={runtime} />)

    expect(await screen.findByText('reminder_center')).toBeTruthy()
    expect(screen.getByText('postgres')).toBeTruthy()
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(get).toHaveBeenCalledWith('/api/tenant-capability-policy')
  })
})
