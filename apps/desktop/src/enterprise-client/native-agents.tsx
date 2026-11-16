import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n/context'
import { nativeBusinessAdminCopy } from '@/i18n/native-business-admin'

import { NativeAdminDialog } from './native-admin-dialog'
import { businessAdminErrorKey } from './native-business-admin-api'
import type { EnterpriseClientRuntime, EnterpriseIdentity } from './runtime'
import {
  assignedPrincipalIds,
  assignShopMembers,
  readShopAssignments,
  samePrincipalIds,
  type ShopAssignmentMember,
  type ShopAssignmentRecord
} from './shop-shared-assignment'

function visibleTo(member: ShopAssignmentMember, record: ShopAssignmentRecord) {
  return member.role === 'tenant_admin' || assignedPrincipalIds(record).includes(member.principal_id)
}

export function NativeAgentsPanel({ runtime }: { runtime: EnterpriseClientRuntime }) {
  const { locale } = useI18n()
  const copy = nativeBusinessAdminCopy[locale]
  const [search, setSearch] = useState('')
  const [attempt, setAttempt] = useState(0)
  const scope = useMemo(() => ({ runtime, attempt, alive: true }), [runtime, attempt])

  const empty = useMemo(
    () => ({
      scope,
      members: [] as ShopAssignmentMember[],
      profiles: [] as ShopAssignmentRecord[],
      busy: true,
      error: ''
    }),
    [scope]
  )

  const [state, setState] = useState(empty)
  const current = state.scope === scope ? state : empty
  const [grants, setGrants] = useState<ShopAssignmentMember>()
  const [reset, setReset] = useState<ShopAssignmentMember>()
  const [password, setPassword] = useState('')
  useEffect(() => {
    let active = true
    scope.alive = true
    setState(empty)
    setGrants(undefined)
    setReset(undefined)
    setPassword('')

    async function load() {
      const identity = await runtime.get<EnterpriseIdentity>('/api/whoami')

      if (!identity.tenant_id || !identity.principal_id || identity.role === 'super_admin') {
        throw new Error('SHOP_AUTHORITY_UNAVAILABLE')
      }

      const data = await readShopAssignments(runtime, identity)

      const members =
        identity.role === 'tenant_admin'
          ? data.members
          : [
              {
                principal_id: identity.principal_id,
                name: identity.name ?? identity.principal_id,
                role: identity.role,
                status: 'active'
              }
            ]

      if (active) {
        setState({ ...empty, ...data, members, busy: false })
      }
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
  }, [scope, runtime, empty, copy])

  return (
    <section className="cs-native-page cs-agents-page">
      <h2>{copy.authorization}</h2>
      <div className="cs-toolbar cs-agents-toolbar">
        <Input aria-label={copy.searchAgents} onChange={event => setSearch(event.target.value)} value={search} />
        <Button
          data-native-tone="info"
          disabled={current.busy}
          onClick={() => setAttempt(value => value + 1)}
          variant="secondary"
        >
          {copy.refresh}
        </Button>
      </div>
      {current.error ? (
        <p className="cs-error" role="alert">
          {current.error}
        </p>
      ) : null}
      <p className="cs-muted" id="cs-native-seat-actions-unavailable">
        {copy.unsupportedSeat}
      </p>
      {current.busy ? <p role="status">{copy.loading}</p> : null}
      <div className="cs-table-wrap">
        <table className="cs-table cs-agents-table">
          <colgroup>
            <col />
            <col />
            <col />
            <col />
            <col />
            <col />
          </colgroup>
          <thead>
            <tr>
              <th>ID</th>
              <th>{copy.username}</th>
              <th>{copy.status}</th>
              <th>{copy.visibleShops}</th>
              <th>{copy.lastLogin}</th>
              <th>{copy.actions}</th>
            </tr>
          </thead>
          <tbody>
            {current.members
              .filter(member =>
                `${member.name} ${member.login_name ?? ''}`.toLowerCase().includes(search.toLowerCase())
              )
              .map(member => {
                const count = current.profiles.filter(record => visibleTo(member, record)).length

                return (
                  <tr key={member.principal_id}>
                    <td title={member.principal_id}>{member.principal_id}</td>
                    <td>
                      <strong>{member.login_name || member.name}</strong>
                    </td>
                    <td>
                      <span className="cs-agent-status" data-enabled={member.status === 'active'}>
                        {member.status === 'active' ? copy.normal : copy.disabled}
                      </span>
                    </td>
                    <td>{count ? copy.shopCount.replace('{count}', String(count)) : copy.noVisibleShops}</td>
                    <td>{member.last_login || '—'}</td>
                    <td>
                      <div className="cs-actions">
                        <Button data-native-tone="info" onClick={() => setGrants(member)} variant="secondary">
                          {copy.visibleShops}
                        </Button>
                        <Button
                          data-native-tone="amber"
                          onClick={() => {
                            setReset(member)
                            setPassword('')
                          }}
                          variant="secondary"
                        >
                          {copy.resetPassword}
                        </Button>
                        <Button
                          aria-describedby="cs-native-seat-actions-unavailable"
                          data-native-tone="danger"
                          disabled
                          variant="secondary"
                        >
                          {member.status === 'active' ? copy.normal : copy.disabled}
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
          </tbody>
        </table>
        {!current.busy && !current.error && !current.members.length ? (
          <p className="cs-empty">{copy.noAgents}</p>
        ) : null}
      </div>
      {grants ? (
        <NativeShopGrants
          member={grants}
          onClose={() => setGrants(undefined)}
          onSaved={() => setAttempt(value => value + 1)}
          runtime={runtime}
        />
      ) : null}
      {reset ? (
        <NativeAdminDialog
          className="cs-agent-edit-dialog"
          compact
          description={copy.unsupportedSeat}
          onClose={() => {
            setReset(undefined)
            setPassword('')
          }}
          open
          title={`${copy.resetPassword} - ${reset.login_name || reset.name}`}
        >
          <div className="cs-admin-form">
            <label>
              {copy.password}
              <Input autoComplete="new-password" onChange={event => setPassword(event.target.value)} value={password} />
            </label>
            <p className="cs-error" role="status">
              {copy.unsupportedSeat}
            </p>
          </div>
          <footer className="cs-admin-footer">
            <Button
              onClick={() => {
                setReset(undefined)
                setPassword('')
              }}
              variant="secondary"
            >
              {copy.cancel}
            </Button>
            <Button aria-describedby="cs-native-seat-actions-unavailable" disabled>
              {copy.confirm}
            </Button>
          </footer>
        </NativeAdminDialog>
      ) : null}
    </section>
  )
}

function NativeShopGrants({
  runtime,
  member,
  onClose,
  onSaved
}: {
  runtime: EnterpriseClientRuntime
  member: ShopAssignmentMember
  onClose(): void
  onSaved(): void
}) {
  const { locale } = useI18n()
  const copy = nativeBusinessAdminCopy[locale]

  const scope = useMemo(
    () => ({ runtime, principalId: member.principal_id, alive: true, pending: false }),
    [runtime, member.principal_id]
  )

  const [identity, setIdentity] = useState<EnterpriseIdentity>()
  const [profiles, setProfiles] = useState<ShopAssignmentRecord[]>()
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const canManage = identity?.role === 'tenant_admin' && member.role !== 'tenant_admin'
  useEffect(() => {
    let active = true
    scope.alive = true
    setProfiles(undefined)
    setIdentity(undefined)
    setSelected([])
    setBusy(true)
    setError('')

    async function load() {
      const who = await runtime.get<EnterpriseIdentity>('/api/whoami')

      if (
        !who.tenant_id ||
        !who.principal_id ||
        (who.role !== 'tenant_admin' && who.principal_id !== member.principal_id)
      ) {
        throw new Error('SHOP_AUTHORITY_UNAVAILABLE')
      }

      const data = await readShopAssignments(runtime, who)

      if (who.role === 'tenant_admin' && !data.members.some(row => row.principal_id === member.principal_id)) {
        throw new Error('SHOP_ASSIGNMENT_RESPONSE_INVALID')
      }

      if (active) {
        setIdentity(who)
        setProfiles(data.profiles)
        setSelected(data.profiles.filter(row => visibleTo(member, row)).map(row => row.profile_id))
      }
    }

    void load()
      .catch(reason => {
        if (active) {
          setError(copy[businessAdminErrorKey(reason)])
        }
      })
      .finally(() => {
        if (active) {
          setBusy(false)
        }
      })

    return () => {
      active = false
      scope.alive = false
    }
  }, [scope, runtime, member, attempt, copy])

  async function save() {
    if (scope.pending || !canManage || !profiles || !identity) {
      return
    }

    scope.pending = true
    setBusy(true)
    setError('')

    try {
      // Each shop is an independent revisioned enterprise asset. Retry only the
      // remaining differences after a partial failure and an authoritative reload.
      for (const record of profiles) {
        const ids = assignedPrincipalIds(record)
        const wanted = selected.includes(record.profile_id)

        if (wanted === ids.includes(member.principal_id)) {
          continue
        }

        const next = wanted ? [...ids, member.principal_id] : ids.filter(id => id !== member.principal_id)
        await assignShopMembers(runtime, record, next)

        if (!scope.alive) {
          return
        }
      }

      const fresh = await readShopAssignments(runtime, identity)

      if (!scope.alive) {
        return
      }

      if (
        !samePrincipalIds(
          fresh.profiles.filter(row => visibleTo(member, row)).map(row => row.profile_id),
          selected
        )
      ) {
        throw new Error('SHOP_ASSIGNMENT_READBACK_INVALID')
      }

      onSaved()
      onClose()
    } catch (reason) {
      if (!scope.alive) {
        return
      }

      setError(copy[businessAdminErrorKey(reason)])

      try {
        const fresh = await readShopAssignments(runtime, identity)

        if (scope.alive) {
          setProfiles(fresh.profiles)
        }
      } catch {
        if (scope.alive) {
          setProfiles(undefined)
          setIdentity(undefined)
        }
      }
    } finally {
      scope.pending = false

      if (scope.alive) {
        setBusy(false)
      }
    }
  }

  const changed = profiles?.some(row => visibleTo(member, row) !== selected.includes(row.profile_id)) ?? false

  return (
    <NativeAdminDialog
      busy={busy}
      className="cs-grants-dialog"
      compact
      description={copy.grantEvidence}
      onClose={onClose}
      open
      title={`${copy.visibleShops} - ${member.login_name || member.name}`}
    >
      <div className="cs-grants-scope">
        <span>{copy.scope}</span>
        <label title={copy.scopeEvidence}>
          <input checked={false} disabled name="native-shop-scope" readOnly type="radio" />
          {copy.teamAll}
        </label>
        <label>
          <input checked disabled name="native-shop-scope" readOnly type="radio" />
          {copy.selectedShops}
        </label>
      </div>
      <div className="cs-grants-list">
        {profiles?.map(record => (
          <label key={record.profile_id}>
            <input
              checked={selected.includes(record.profile_id)}
              disabled={busy || !canManage || (member.status !== 'active' && !selected.includes(record.profile_id))}
              onChange={event =>
                setSelected(current =>
                  event.target.checked
                    ? [...current, record.profile_id]
                    : current.filter(id => id !== record.profile_id)
                )
              }
              type="checkbox"
            />
            {record.profile?.shop_name || record.profile?.display_name || record.profile?.shop_id || record.profile_id}
          </label>
        ))}
      </div>
      <p className="cs-admin-boundary">{copy.scopeEvidence}</p>
      {busy ? <p role="status">{copy.saving}</p> : null}
      {error ? (
        <p className="cs-error" role="alert">
          {error}
        </p>
      ) : null}
      {error ? (
        <Button disabled={busy} onClick={() => setAttempt(value => value + 1)} variant="secondary">
          {copy.refresh}
        </Button>
      ) : null}
      <footer className="cs-admin-footer">
        <Button disabled={busy} onClick={onClose} variant="secondary">
          {copy.cancel}
        </Button>
        <Button disabled={busy || !canManage || !runtime.post || !changed} onClick={() => void save()}>
          {copy.save}
        </Button>
      </footer>
    </NativeAdminDialog>
  )
}
