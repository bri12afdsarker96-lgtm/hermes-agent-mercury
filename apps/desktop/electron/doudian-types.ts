export type DoudianAction =
  | 'capabilities' | 'shops' | 'manageShops' | 'chooseWorkbook'
  | 'prepare' | 'start' | 'stop' | 'status'
  | 'preparePayment' | 'startPayment'
  | 'openPayment' | 'openReview' | 'openFeige'

export interface DoudianRequest {
  sessionId: string
  action: DoudianAction
  shopId?: string
  workbookId?: string
  taskId?: string
  amount?: string
  startRow?: string
  maxRows?: string
  mode?: 'standard' | 'new-order'
}

export interface DoudianShop {
  id: string
  name: string
  platformId: string
  status: string
}
export interface DoudianTask {
  kind?: 'review' | 'payment' | 'payment-window' | 'review-window' | 'feige-window'
  taskId: string | null
  state:
    | 'idle'
    | 'preparing'
    | 'awaiting_confirmation'
    | 'running'
    | 'stopping'
    | 'stopped'
    | 'completed'
    | 'failed'
    | 'unknown'
  saved: number
  summary: string
  error: string
  messages: string[]
}
export interface DoudianReply {
  ok: boolean
  error?: string
  capabilities?: {
    protocol: number
    version: string
    chrome: boolean
    spreadsheet: boolean
    authorized: boolean
    paymentUi?: number
    reviewUi?: number
    feigeUi?: number
    taskIsolation?: string
  }
  shops?: DoudianShop[]
  workbook?: { id: string; name: string }
  task?: DoudianTask
}
