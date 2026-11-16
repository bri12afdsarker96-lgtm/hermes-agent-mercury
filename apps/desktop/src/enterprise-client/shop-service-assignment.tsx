import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n/context'
import { shopServiceAssignmentCopy } from '@/i18n/shop-service-assignment'

import type { EnterpriseClientRuntime, EnterpriseIdentity } from './runtime'

interface AssignmentMetadata {
  profile_id: string
  revision: number
  deleted: boolean
  created_by?: string | null
  servicing_principal_id?: string | null
}

export interface ShopServiceAssignmentProps {
  runtime: EnterpriseClientRuntime
  profileId: string
  onTransferred: () => void | Promise<void>
}

// Matches GET /api/principals used by TenantMembersPanel. Tenant scope is server-owned.
interface Member {
  principal_id: string
  name: string
  status: string
  tenant_id?: string
}

async function readMetadata(runtime: EnterpriseClientRuntime, profileId: string, tenantId: string) {
  const [records, roster] = await Promise.all([
    runtime.get<{ profiles: AssignmentMetadata[] }>('/api/shop-login-profiles'),
    runtime.get<{ principals: Member[] }>('/api/principals')
  ])
  if (!Array.isArray(records.profiles) || !Array.isArray(roster.principals)) {
    throw new Error('SHOP_ASSIGNMENT_METADATA_INVALID')
  }
  const record = records.profiles.find(row => row.profile_id === profileId && row.deleted === false)
  if (!record || !Number.isSafeInteger(record.revision) || record.revision < 1) {
    throw new Error('SHOP_ASSIGNMENT_PROFILE_UNAVAILABLE')
  }
  // Project public assignment fields so no session payload becomes component state.
  return {
    profile: {
      profile_id: record.profile_id, revision: record.revision, deleted: record.deleted,
      created_by: record.created_by, servicing_principal_id: record.servicing_principal_id
    },
    members: roster.principals
      .filter(member => !member.tenant_id || member.tenant_id === tenantId)
      .map(member => ({ principal_id: member.principal_id, name: member.name, status: member.status }))
  }
}

export function ShopServiceAssignment({ runtime, profileId, onTransferred }: ShopServiceAssignmentProps) {
  const { locale } = useI18n()
  const copy = shopServiceAssignmentCopy[locale]
  const [attempt, setAttempt] = useState(0)
  const scope = useMemo(() => ({ alive: true, pending: false }), [runtime, profileId, attempt])
  const empty = useMemo(() => ({
    scope, identity: null as EnterpriseIdentity | null, profile: null as AssignmentMetadata | null,
    members: [] as Member[], selected: '', loading: true, busy: false,
    error: null as 'membersFailed' | 'transferFailed' | 'refreshFailed' | null, success: false
  }), [scope])
  const [state, setState] = useState(empty)
  const current = state.scope === scope ? state : empty

  useEffect(() => {
    let active = true
    scope.alive = true
    setState(empty)
    async function load() {
      const identity = await runtime.get<EnterpriseIdentity>('/api/whoami')
      if (!active) { return }
      if (identity.role !== 'tenant_admin' || !identity.tenant_id || !identity.principal_id) {
        setState({ ...empty, loading: false })
        return
      }
      setState(previous => ({ ...previous, identity }))
      const metadata = await readMetadata(runtime, profileId, identity.tenant_id)
      if (active) { setState(previous => ({ ...previous, ...metadata, loading: false })) }
    }
    void load().catch(() => {
      if (active) {
        setState(previous => ({ ...previous, loading: false, error: 'membersFailed' }))
      }
    })
    return () => { active = false; scope.alive = false }
  }, [scope, runtime, profileId, empty])

  const profile = current.profile
  const eligible = current.members.filter(member => member.status === 'active')
  const creator = current.members.find(member => member.principal_id === profile?.created_by)?.name || profile?.created_by || copy.unknown
  const servicing = current.members.find(member => member.principal_id === profile?.servicing_principal_id)?.name ||
    profile?.servicing_principal_id || copy.unassigned
  const validSelection = eligible.some(member => member.principal_id === current.selected) &&
    current.selected !== profile?.servicing_principal_id

  async function transfer() {
    if (!runtime.post || !scope.alive || scope.pending || !validSelection || !profile ||
        current.identity?.role !== 'tenant_admin' || !current.identity.tenant_id) {
      return
    }

    scope.pending = true
    setState(previous => ({ ...previous, busy: true, error: null, success: false }))
    let submitted = false
    try {
      const result = await runtime.post<{ profile: AssignmentMetadata }>(
        '/api/shop-login-profiles-transfer', {
          profile_id: profile.profile_id,
          principal_id: current.selected,
          expected_revision: profile.revision
        }
      )
      if (!scope.alive) { return }
      submitted = true
      if (result.profile?.profile_id !== profileId || result.profile.deleted !== false ||
          result.profile.servicing_principal_id !== current.selected ||
          !Number.isSafeInteger(result.profile.revision) || result.profile.revision <= profile.revision) {
        throw new Error('SHOP_TRANSFER_RESPONSE_INVALID')
      }
      const metadata = await readMetadata(runtime, profileId, current.identity.tenant_id)
      if (!scope.alive) { return }
      if (metadata.profile.revision < result.profile.revision) { throw new Error('SHOP_TRANSFER_REFRESH_STALE') }
      setState(previous => ({ ...previous, ...metadata, selected: '' }))
      await onTransferred()
      if (scope.alive) {
        setState(previous => ({ ...previous, success: true }))
      }
    } catch {
      if (scope.alive) {
        setState(previous => ({ ...previous, error: submitted ? 'refreshFailed' : 'transferFailed' }))
      }
    } finally {
      scope.pending = false
      if (scope.alive) { setState(previous => ({ ...previous, busy: false })) }
    }
  }

  if (current.identity?.role !== 'tenant_admin') { return null }

  return (
    <section aria-label={copy.title} className="space-y-3" dir={locale === 'ar' ? 'rtl' : undefined}>
      <h3>{copy.title}</h3>
      <p>{copy.ownership}</p>
      <p>{copy.accessChange}</p>
      {profile ? <dl className="space-y-1">
        <div><dt>{copy.creator}</dt><dd>{creator}</dd></div>
        <div><dt>{copy.servicing}</dt><dd>{servicing}</dd></div>
      </dl> : null}
      <div className="flex flex-wrap items-center gap-2">
        <label>
          {copy.target}
          <select
            disabled={current.loading || current.busy || !runtime.post || !profile}
            onChange={event => setState(previous => ({ ...previous, selected: event.target.value, success: false }))}
            value={current.selected}
          >
            <option value="">{copy.choose}</option>
            {eligible.map(member => <option key={member.principal_id} value={member.principal_id}>{member.name}</option>)}
          </select>
        </label>
        <Button
          disabled={current.loading || current.busy || !runtime.post || !validSelection || !profile}
          onClick={() => void transfer()}
          type="button"
          variant="secondary"
        >
          {current.busy ? copy.pending : copy.transfer}
        </Button>
      </div>
      {current.loading ? <p role="status">{copy.loading}</p> : null}
      {current.error ? <p role="alert">{copy[current.error]}</p> : null}
      {current.error ? <Button disabled={current.busy} onClick={() => setAttempt(value => value + 1)} type="button" variant="secondary">{copy.retry}</Button> : null}
      {current.success ? <p role="status">{copy.success}</p> : null}
    </section>
  )
}
