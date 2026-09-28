export type EnterpriseClientErrorKind =
  | 'invalid_credentials'
  | 'authentication_required'
  | 'authority_unavailable'
  | 'conflict'
  | 'forbidden'
  | 'network'
  | 'not_found'
  | 'rate_limited'
  | 'unknown'

interface EnterpriseClientErrorDetails {
  kind: EnterpriseClientErrorKind
  message: string
}

const ERROR_DETAILS_BY_STATUS: Readonly<Record<number, EnterpriseClientErrorDetails>> = {
  400: { kind: 'unknown', message: '提交内容不符合要求，请检查必填信息、文件格式或知识切片后重试' },
  401: { kind: 'authentication_required', message: '企业会话已失效，请重新连接' },
  403: { kind: 'forbidden', message: '当前身份无权访问此资源' },
  404: { kind: 'not_found', message: '当前范围内没有可用资源' },
  409: { kind: 'conflict', message: '服务端状态已变化，请刷新后重试' },
  413: { kind: 'unknown', message: '提交内容过大，请缩短文本或录音后重试' },
  422: { kind: 'unknown', message: '内容未通过校验，请检查并移除客户个人资料后重试' },
  429: { kind: 'rate_limited', message: '当前并发已满，内容已保留，请稍后重试' },
  503: { kind: 'authority_unavailable', message: '企业服务暂时不可用，请稍后重试' }
}

const NETWORK_ERROR: EnterpriseClientErrorDetails = {
  kind: 'network',
  message: '无法连接企业服务，请检查网络后重试'
}

const UNKNOWN_ERROR: EnterpriseClientErrorDetails = {
  kind: 'unknown',
  message: '企业服务请求失败，请稍后重试'
}

export class EnterpriseClientError extends Error {
  readonly kind: EnterpriseClientErrorKind
  readonly status: number

  constructor(status: number, { kind, message }: EnterpriseClientErrorDetails) {
    super(message)
    this.name = 'EnterpriseClientError'
    this.kind = kind
    this.status = status
  }
}

/**
 * Converts the main-process bridge's minimal status information into product
 * semantics. Server-provided text is deliberately never accepted here: the
 * renderer must not expose endpoint, credential, or internal authority detail.
 */
export function enterpriseClientErrorForStatus(status: number): EnterpriseClientError {
  return new EnterpriseClientError(status, ERROR_DETAILS_BY_STATUS[status] ?? UNKNOWN_ERROR)
}

/** Collapses bridge-level transport failures without leaking implementation detail. */
export function enterpriseNetworkError(): EnterpriseClientError {
  return new EnterpriseClientError(0, NETWORK_ERROR)
}

/** Login failures are distinct from failures of an authenticated request. */
export function enterprisePasswordLoginError(code: string): EnterpriseClientError {
  if (code === 'invalid_credentials') {
    return new EnterpriseClientError(403, { kind: 'invalid_credentials', message: '账号或密码不正确，或账号已停用。请使用管理员提供的新账号。' })
  }
  if (code === 'service_unavailable') {return enterpriseClientErrorForStatus(503)}
  if (code === 'rate_limited') {return new EnterpriseClientError(429, { kind: 'rate_limited', message: '登录请求过于频繁，请稍后重试' })}
  return enterpriseNetworkError()
}
