import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n/context'
import { nativeBusinessAdminCopy } from '@/i18n/native-business-admin'

import { businessAdminErrorKey } from './native-business-admin-api'
import type { EnterpriseClientRuntime, EnterpriseIdentity } from './runtime'

export interface ShopAssignmentRecord {
  profile_id: string
  revision: number
  deleted: boolean
  servicing_principal_id?: string | null
  servicing_principal_ids?: string[]
  profile?: { shop_id?: string; shop_name?: string; display_name?: string }
}

export interface ShopAssignmentMember {
  principal_id: string
  name: string
  login_name?: string
  role?: string
  status: string
  tenant_id?: string
  last_login?: string | null
}

export function assignedPrincipalIds(record: ShopAssignmentRecord): string[] {
  if (record.servicing_principal_ids !== undefined) {
    if (
      !Array.isArray(record.servicing_principal_ids) ||
      !record.servicing_principal_ids.every(id => typeof id === 'string' && !!id) ||
      new Set(record.servicing_principal_ids).size !== record.servicing_principal_ids.length
    ) {
      throw new Error('SHOP_ASSIGNMENT_RESPONSE_INVALID')
    }

    return record.servicing_principal_ids
  }

  if (record.servicing_principal_id != null && typeof record.servicing_principal_id !== 'string') {
    throw new Error('SHOP_ASSIGNMENT_RESPONSE_INVALID')
  }

  return record.servicing_principal_id ? [record.servicing_principal_id] : []
}

export function samePrincipalIds(left: string[], right: string[]) {
  return left.length === right.length && left.every(id => right.includes(id))
}

export async function readShopAssignments(runtime: EnterpriseClientRuntime, identity: EnterpriseIdentity) {
  const records = await runtime.get<{ profiles: ShopAssignmentRecord[] }>('/api/shop-login-profiles')

  if (!Array.isArray(records.profiles)) {
    throw new Error('SHOP_ASSIGNMENT_RESPONSE_INVALID')
  }

  const profiles = records.profiles
    .filter(row => row.deleted === false)
    .map(row => {
      if (!row.profile_id || !Number.isSafeInteger(row.revision) || row.revision < 1) {
        throw new Error('SHOP_ASSIGNMENT_RESPONSE_INVALID')
      }

      // Project public fields. Login cookies and storage never enter renderer state.
      return {
        profile_id: row.profile_id,
        revision: row.revision,
        deleted: false,
        servicing_principal_ids: [...assignedPrincipalIds(row)],
        profile: row.profile
          ? {
              shop_id: row.profile.shop_id,
              shop_name: row.profile.shop_name,
              display_name: row.profile.display_name
            }
          : undefined
      }
    })

  if (identity.role !== 'tenant_admin') {
    return { profiles, members: [] as ShopAssignmentMember[] }
  }

  const roster = await runtime.get<{ principals: ShopAssignmentMember[] }>('/api/principals')

  if (
    !Array.isArray(roster.principals) ||
    !roster.principals.every(
      row => typeof row.principal_id === 'string' && typeof row.name === 'string' && typeof row.status === 'string'
    )
  ) {
    throw new Error('SHOP_ASSIGNMENT_RESPONSE_INVALID')
  }

  const members = roster.principals
    .filter(row => !row.tenant_id || row.tenant_id === identity.tenant_id)
    .map(row => ({
      principal_id: row.principal_id,
      name: row.name,
      login_name: row.login_name,
      role: row.role,
      status: row.status,
      last_login: row.last_login
    }))

  const administrators = new Set([
    identity.principal_id,
    ...members.filter(member => member.role === 'tenant_admin').map(member => member.principal_id)
  ])
  const employeeProfiles = profiles.map(record => {
    const ids = assignedPrincipalIds(record).filter(id => !administrators.has(id))

    if (
      ids.some(
        id =>
          !members.some(
            member =>
              member.principal_id === id && (member.role === 'operator' || member.role === 'supervisor')
          )
      )
    ) {
      throw new Error('SHOP_ASSIGNMENT_MEMBERS_UNVERIFIED')
    }

    return { ...record, servicing_principal_ids: ids }
  })

  return { profiles: employeeProfiles, members }
}

export async function assignShopMembers(
  runtime: EnterpriseClientRuntime,
  record: ShopAssignmentRecord,
  ids: string[],
  members: ShopAssignmentMember[]
) {
  if (!runtime.post) {
    throw new Error('SHOP_ASSIGNMENT_UNAVAILABLE')
  }

  if (
    ids.some(
      id =>
        !members.some(
          member =>
            member.principal_id === id &&
            member.status === 'active' &&
            (member.role === 'operator' || member.role === 'supervisor')
        )
    )
  ) {
    throw new Error('SHOP_ASSIGNMENT_MEMBERS_UNVERIFIED')
  }

  const result = await runtime
    .post<{ profile: ShopAssignmentRecord }>('/api/shop-login-profiles-assign', {
      profile_id: record.profile_id,
      principal_ids: ids,
      expected_revision: record.revision
    })
    .catch(reason => {
      if ([400, 404, 422].includes((reason as { status?: number })?.status ?? 0)) {
        throw new Error('SHOP_ASSIGNMENT_REJECTED')
      }

      throw reason
    })

  if (
    result.profile?.profile_id !== record.profile_id ||
    result.profile.deleted !== false ||
    !Number.isSafeInteger(result.profile.revision) ||
    result.profile.revision <= record.revision ||
    !samePrincipalIds(assignedPrincipalIds(result.profile), ids)
  ) {
    throw new Error('SHOP_ASSIGNMENT_RESPONSE_INVALID')
  }

  return result.profile
}

export function ShopSharedAssignment({
  runtime,
  profileId,
  onSaved
}: {
  runtime: EnterpriseClientRuntime
  profileId: string
  onSaved(): void | Promise<void>
}) {
  const { locale } = useI18n()
  const copy = nativeBusinessAdminCopy[locale]
  const [attempt, setAttempt] = useState(0)

  const scope = useMemo(
    () => ({ runtime, profileId, attempt, alive: true, pending: false }),
    [runtime, profileId, attempt]
  )

  const empty = useMemo(
    () => ({
      scope,
      identity: undefined as EnterpriseIdentity | undefined,
      record: undefined as ShopAssignmentRecord | undefined,
      members: [] as ShopAssignmentMember[],
      selected: [] as string[],
      busy: true,
      error: '',
      saved: false
    }),
    [scope]
  )

  const [state, setState] = useState(empty)
  const current = state.scope === scope ? state : empty
  useEffect(() => {
    let active = true
    scope.alive = true
    setState(empty)

    async function load() {
      const identity = await runtime.get<EnterpriseIdentity>('/api/whoami')

      if (!active) {
        return
      }

      if (identity.role !== 'tenant_admin' || !identity.tenant_id || !identity.principal_id) {
        setState({ ...empty, busy: false })

        return
      }

      const data = await readShopAssignments(runtime, identity)

      if (!active) {
        return
      }

      const record = data.profiles.find(row => row.profile_id === profileId)

      if (!record) {
        throw new Error('SHOP_ASSIGNMENT_RESPONSE_INVALID')
      }

      setState({
        ...empty,
        identity,
        record,
        members: data.members,
        selected: [...assignedPrincipalIds(record)],
        busy: false
      })
    }

    void load().catch(reason => {
      if (active) {
        setState({ ...empty, busy: false, error: copy[businessAdminErrorKey(reason)] })
      }
    })

    return () => {
      active = false
      scope.alive = false
    }
  }, [scope, runtime, profileId, empty, copy])

  async function save() {
    if (scope.pending || !current.record || !current.identity) {
      return
    }

    scope.pending = true
    setState(previous => ({ ...previous, busy: true, error: '', saved: false }))

    try {
      const roster = await readShopAssignments(runtime, current.identity)

      if (!scope.alive) {
        return
      }

      const saved = await assignShopMembers(runtime, current.record, current.selected, roster.members)

      if (!scope.alive) {
        return
      }

      const fresh = await readShopAssignments(runtime, current.identity)

      if (!scope.alive) {
        return
      }

      const record = fresh.profiles.find(row => row.profile_id === profileId)

      if (
        !record ||
        record.revision < saved.revision ||
        !samePrincipalIds(assignedPrincipalIds(record), current.selected)
      ) {
        throw new Error('SHOP_ASSIGNMENT_RESPONSE_INVALID')
      }

      setState(previous => ({ ...previous, record, members: fresh.members, saved: true }))
      await onSaved()
    } catch (reason) {
      if (scope.alive) {
        setState(previous => ({ ...previous, error: copy[businessAdminErrorKey(reason)] }))
      }
    } finally {
      scope.pending = false

      if (scope.alive) {
        setState(previous => ({ ...previous, busy: false }))
      }
    }
  }

  if (!current.identity) {
    return current.error ? (
      <p className="cs-error" role="alert">
        {current.error}
      </p>
    ) : null
  }

  return (
    <section aria-label={copy.assignments} className="cs-shared-assignment">
      <h3>{copy.assignments}</h3>
      <p className="cs-muted">{copy.assignmentEvidence}</p>
      <div className="cs-shared-members">
        {current.members
          .filter(member => member.role === 'operator' || member.role === 'supervisor')
          .map(member => (
            <label key={member.principal_id}>
              <input
                checked={current.selected.includes(member.principal_id)}
                disabled={
                  current.busy || (member.status !== 'active' && !current.selected.includes(member.principal_id))
                }
                onChange={event =>
                  setState(previous => ({
                    ...previous,
                    saved: false,
                    selected: event.target.checked
                      ? [...previous.selected, member.principal_id]
                      : previous.selected.filter(id => id !== member.principal_id)
                  }))
                }
                type="checkbox"
              />
              {member.name}
              {member.status !== 'active' ? ` · ${copy.disabled}` : ''}
            </label>
          ))}
      </div>
      <Button
        disabled={
          current.busy ||
          !runtime.post ||
          !current.record ||
          samePrincipalIds(current.selected, assignedPrincipalIds(current.record))
        }
        onClick={() => void save()}
      >
        {current.busy ? copy.saving : copy.save}
      </Button>
      {current.error ? (
        <p className="cs-error" role="alert">
          {current.error}
        </p>
      ) : null}
      {current.saved ? <p role="status">{copy.saved}</p> : null}
      <Button disabled={current.busy} onClick={() => setAttempt(value => value + 1)} variant="secondary">
        {copy.refresh}
      </Button>
    </section>
  )
}
