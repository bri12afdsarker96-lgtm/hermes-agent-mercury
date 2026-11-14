export type DoudianAction =
  | 'capabilities' | 'shops' | 'manageShops' | 'chooseWorkbook'
  | 'prepare' | 'start' | 'stop' | 'status'
  | 'preparePayment' | 'startPayment'
  | 'openPayment' | 'openReview' | 'openFeige'
  | 'shopManagementList' | 'shopManagementAdd' | 'shopManagementRename' | 'shopManagementPin'
  | 'shopManagementMove' | 'shopManagementPrepareDelete' | 'shopManagementDelete'
  | 'shopLoginStart' | 'shopCheckStart' | 'shopOperationStatus' | 'shopLoginConfirm' | 'shopLoginFinishFeige' | 'shopOperationCancel'

export interface DoudianRequest {
  sessionId: string
  action: DoudianAction
  shopId?: string
  workbookId?: string
  taskId?: string
  amount?: string
  startRow?: string
  maxRows?: string
  concurrency?: string
  alias?: string
  pinned?: string
  direction?: string
  confirmation?: string
  decision?: string
  mode?: 'standard' | 'new-order'
}

export interface DoudianShop {
  id: string
  name: string
  platformId: string
  status: string
}
export interface ManagedDoudianShop {
  id: string
  name: string
  alias: string | null
  pinned: boolean
  sortOrder: number
  pendingLogin: boolean
  pendingDeletion: boolean
  status: string | null
  verifiedName: string | null
  platformId: string | null
  feigeStatus: string | null
  checkedAt: string | null
  feigeCheckedAt: string | null
}
export interface DoudianShopOperation {
  taskId: string
  shopId: string
  kind: 'shop-login' | 'shop-check'
  state: 'running' | 'awaiting_confirmation' | 'stopping' | 'completed' | 'stopped' | 'failed'
  phase: string
  candidate: { name: string | null; platformId: string | null } | null
  bound: { name: string | null; platformId: string | null }
  merchantStatus: string | null
  feigeStatus: string | null
  bindingSaved: boolean
  error: string | null
}
export interface DoudianTask {
  kind?: 'review' | 'payment' | 'payment-window' | 'review-window' | 'feige-window' | 'shop-delete' | 'shop-login' | 'shop-check'
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
    authorizationMode?: string
    paymentUi?: number
    reviewUi?: number
    feigeUi?: number
    taskIsolation?: string
    reviewOptions?: number
    shopManagement?: number
    shopOperations?: number
  }
  shops?: DoudianShop[]
  managedShops?: ManagedDoudianShop[]
  shopMutation?: { id?: string; updated?: boolean }
  shopDeleteConfirmation?: { confirmation: string; expiresSeconds: number; effect: string }
  shopOperation?: DoudianShopOperation
  workbook?: { id: string; name: string }
  task?: DoudianTask
}
