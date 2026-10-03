export interface FollowupActionRequest {
  action: string
  followup_id: string
  idempotency_key: string
  expected_receive_date?: string
}

/** An uncertain write may only be retried with the exact same business facts. */
export class FollowupPendingActions {
  private requests = new Map<string, FollowupActionRequest>()

  request(followupId: string, action: string, expectedDate?: string): FollowupActionRequest {
    const key = `${followupId}:${action}`
    const previous = this.requests.get(key)
    if (previous) {
      if (previous.expected_receive_date !== expectedDate) {
        throw new Error('先重试确认上次提交的日期，再进行新的改期。')
      }
      return { ...previous }
    }
    const request: FollowupActionRequest = { action, followup_id: followupId, idempotency_key: crypto.randomUUID() }
    if (expectedDate !== undefined) {request.expected_receive_date = expectedDate}
    this.requests.set(key, request)
    return { ...request }
  }

  confirm(followupId: string, action: string): void {
    this.requests.delete(`${followupId}:${action}`)
  }
}
