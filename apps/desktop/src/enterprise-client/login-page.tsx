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
      <section className="hesc-login-brand" aria-labelledby="enterprise-login-product">
        <div className="hesc-login-brand-lockup">
          <img alt="" aria-hidden="true" src={hermesMark} />
          <span>Hermes Enterprise</span>
        </div>
        <div>
          <p className="hesc-login-kicker">企业级 AI 协作平台</p>
          <h1 id="enterprise-login-product">让 AI 成为企业协作伙伴</h1>
          <p className="hesc-login-lede">统一连接业务知识、团队任务与可信的企业服务。</p>
        </div>
        <p className="hesc-login-footer">© 2026 Hermes Enterprise</p>
      </section>

      <section className="hesc-login-panel" aria-labelledby="enterprise-login-heading">
        <div>
          <p className="hesc-login-kicker">企业身份入口</p>
          <h2 id="enterprise-login-heading">登录企业账号</h2>
          <p>使用已由企业管理员开通的身份进入工作台。</p>
        </div>
        <div className="hesc-login-status" role="status">
          <span aria-hidden="true" className="hesc-login-status-dot" data-state={busy ? 'loading' : error ? 'error' : 'idle'} />
          {status}
        </div>
        {error ? <p className="hesc-login-error">{error}</p> : null}
        <button className="hesc-login-action" disabled={busy} onClick={onRetry} type="button">
          {busy ? '正在验证企业身份…' : '登录并进入工作台'}
        </button>
        <p className="hesc-login-help">本客户端不提供自助注册。请联系企业管理员开通或恢复账号。</p>
      </section>
    </main>
  )
}
