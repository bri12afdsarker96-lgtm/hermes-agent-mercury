export interface ReceivableMutation {
  action: 'receipt' | 'reverse' | 'note' | 'transfer'
  followup_id: string
  idempotency_key: string
  amount?: string
  received_at?: string
  receipt_id?: string
  note?: string
  target_principal_id?: string
}

/** Recovery keys include the server, tenant, principal and record. Migrate the
 * old tab journal before returning it so a restart keeps the original request.
 * Storage failures and conflicting journals must block a new financial write.
 */
export function readPendingOperation(key: string): string | null {
  const saved = localStorage.getItem(key)
  const legacy = sessionStorage.getItem(key)
  if (saved !== null && legacy !== null && saved !== legacy) {
    throw new Error('Conflicting pending operations')
  }
  if (legacy !== null) {
    if (saved === null) localStorage.setItem(key, legacy)
    sessionStorage.removeItem(key)
  }
  return saved ?? legacy
}

export function savePendingOperation(key: string, request: unknown): void {
  const value = JSON.stringify(request)
  const saved = readPendingOperation(key)
  if (saved !== null && saved !== value) {
    throw new Error('A previous operation must be confirmed first')
  }
  localStorage.setItem(key, value)
}

export function clearPendingOperation(key: string): void {
  // Keep the durable journal if clearing the legacy store fails.
  sessionStorage.removeItem(key)
  localStorage.removeItem(key)
}

/** Persist before sending; clear only after confirmation or definitive rejection. */
export function readPendingReceivable(key: string, followupId: string): ReceivableMutation | null {
  const value = readPendingOperation(key)
  if (!value) {return null}
  const parsed = JSON.parse(value) as ReceivableMutation
  if (parsed.followup_id !== followupId || typeof parsed.idempotency_key !== 'string'
      || !['receipt', 'reverse', 'note', 'transfer'].includes(parsed.action)) {
    throw new Error('Invalid pending receivable operation')
  }
  return parsed
}

export function receivableMutationPath(request: ReceivableMutation) {
  return ['receipt', 'reverse'].includes(request.action)
    ? '/api/receivable-receipt-action' : '/api/business-followup-manage'
}
