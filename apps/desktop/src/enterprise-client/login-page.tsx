import hermesMark from './assets/hermes-mark.svg'

export interface EnterpriseLoginPageProps {
  busy: boolean
  error: string | null
  onRetry: () => void
  status: string
}

/**
 * A product-owned entry screen. Authentication remains in Electron main and
 * Hermes_AI: the renderer never asks for or retains a token, password, or a
 * self-registration identity.
 */
export function EnterpriseLoginPage({ busy, error, onRetry, status }: EnterpriseLoginPageProps) {
  return (
    <main className="hesc-login" data-testid="enterprise-login-root">
      <header className="hesc-login-titlebar">
        <img alt="" aria-hidden="true" src={hermesMark} />
        <span>Hermes Enterprise Desktop</span>
      </header>
      <div className="hesc-login-content">
        <section aria-labelledby="enterprise-login-product" className="hesc-login-brand">
          <div className="hesc-login-brand-lockup">
            <img alt="" aria-hidden="true" src={hermesMark} />
            <span>
              <strong>HERMES</strong>
              <small>Hermes Enterprise Desktop</small>
            </span>
          </div>
          <div>
            <h1 id="enterprise-login-product">一体化 AI 企业桌面工作台</h1>
            <p className="hesc-login-lede">
              统一承载 AI 助理、企业会话、任务与业务跟进、提醒、企业知识及人工接管。
            </p>
            <ul className="hesc-login-points">
              <li>会话、任务与知识在同一工作台内闭环处理</li>
              <li>角色与权限由服务端授权，登录后自动生效</li>
              <li>未接入能力明确标记，不做臆造展示</li>
            </ul>
          </div>
          <div aria-label="企业身份保障" className="hesc-login-features">
            <span><b>✓</b><i>单点登录</i><small>企业身份一步登录</small></span>
            <span><b>⌁</b><i>凭据安全保存</i><small>令牌不进入渲染层</small></span>
            <span><b>⌘</b><i>权限自动同步</i><small>角色变更服务端生效</small></span>
          </div>
        </section>

        <section aria-labelledby="enterprise-login-heading" className="hesc-login-panel">
          <div>
            <h2 id="enterprise-login-heading">登录企业账号</h2>
            <p>使用企业身份登录，进入你的 Hermes 工作台。</p>
          </div>
          <div className="hesc-login-status" role="status">
            <span aria-hidden="true" className="hesc-login-status-dot" data-state={busy ? 'loading' : error ? 'error' : 'idle'} />
            {status}
          </div>
          {error ? <p className="hesc-login-error">{error}</p> : null}
          <button className="hesc-login-action" disabled={busy} onClick={onRetry} type="button">
            {busy ? '正在验证企业身份…' : '使用企业账号登录'}
          </button>
          <p className="hesc-login-help">企业连接由受控桌面身份通道发起。本客户端不提供自助注册，请联系企业管理员开通或恢复账号。</p>
        </section>
      </div>
    </main>
  )
}
