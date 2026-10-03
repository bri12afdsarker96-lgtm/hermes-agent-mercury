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

/** A tab-local recovery journal, scoped to server, tenant, principal and record.
 * Persist before sending: reload/closing a detail pane must not mint a second
 * payment while the first request's outcome is unknown. Cleared on confirmation.
 */
export function readPendingReceivable(key: string, followupId: string): ReceivableMutation | null {
  const value = sessionStorage.getItem(key)
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
