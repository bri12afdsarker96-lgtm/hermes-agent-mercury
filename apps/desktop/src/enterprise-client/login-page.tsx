import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Check, Lock, Users } from '@/lib/icons'

import hermesMark from './assets/hermes-mark.svg'
import { EnterprisePackageUpdateButton } from './package-update-ui'

export interface EnterpriseLoginPageProps {
  busy: boolean
  error: string | null
  onLogin: (loginName: string, password: string, rememberPassword?: boolean) => void
  onOpenLogs: () => void
  status: string
}

export interface EnterprisePasswordChangePageProps {
  error: string | null
  onComplete: (currentPassword: string, newPassword: string) => Promise<void>
}

interface PreReleaseAccessState {
  canInstall?: boolean
  enabled: boolean
  message: string
  stage: string
}

/**
 * A product-owned entry screen. Authentication remains in Electron main and
 * Hermes_AI: the renderer never asks for or retains a token, password, or a
 * self-registration identity.
 */
export function EnterpriseLoginPage({ busy, error, onLogin, onOpenLogs, status }: EnterpriseLoginPageProps) {
  const [loginName, setLoginName] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(false)
  const [preReleaseAccess, setPreReleaseAccess] = useState<PreReleaseAccessState | null>(null)
  const [preReleaseBusy, setPreReleaseBusy] = useState(false)
  // The same product screen ships in the browser.  The browser adapter never
  // persists an access token or password, so it must not imply that the native
  // OS credential-vault checkbox is available there.
  const browserSurface = typeof document !== 'undefined' && document.documentElement.dataset.hermesSurface === 'web'
  const supportsRememberedLogin = !browserSurface && Boolean(window.hermesDesktop?.enterprise?.rememberedLogin)
  const supportsPreReleaseAccess = !browserSurface && Boolean(window.hermesDesktop?.enterprise?.preReleaseAccess)
  useEffect(() => {
    if (!supportsRememberedLogin) {
      return
    }

    let active = true
    void window.hermesDesktop?.enterprise
      ?.rememberedLogin?.()
      .then(saved => {
        if (active && saved) {
          setLoginName(saved.loginName)
          setPassword(saved.password)
          setRemember(true)
        }
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [supportsRememberedLogin])

  useEffect(() => {
    if (!supportsPreReleaseAccess) {
      return
    }

    let active = true
    void window.hermesDesktop?.enterprise?.preReleaseAccess
      ?.status()
      .then(state => {
        if (active) {
          setPreReleaseAccess(state)
        }
      })
      .catch(() => {
        if (active) {
          setPreReleaseAccess({
            enabled: true,
            message: '无法检查内部预发布接入状态，请稍后重试。',
            stage: 'client_unavailable'
          })
        }
      })
    return () => {
      active = false
    }
  }, [supportsPreReleaseAccess])

  async function runPreReleaseAccess(action: 'import-profile' | 'install' | 'open-client') {
    const bridge = window.hermesDesktop?.enterprise?.preReleaseAccess
    if (!bridge || preReleaseBusy) {
      return
    }

    setPreReleaseBusy(true)
    try {
      setPreReleaseAccess(await bridge.command({ action }))
    } catch {
      setPreReleaseAccess({
        enabled: true,
        message: '内部预发布接入操作没有完成，请稍后重试。',
        stage: 'client_unavailable'
      })
    } finally {
      setPreReleaseBusy(false)
    }
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const submittedPassword = password
    setPassword('')
    onLogin(loginName.trim(), submittedPassword, remember)
  }

  return (
    <main className="hesc-login" data-testid="enterprise-login-root">
      <header className="hesc-login-titlebar">
        <img alt="" aria-hidden="true" src={hermesMark} />
        <span>Hermes-企业助手</span>
        <EnterprisePackageUpdateButton />
      </header>
      <div className="hesc-login-content">
        <section aria-labelledby="enterprise-login-product" className="hesc-login-brand">
          <div className="hesc-login-brand-lockup">
            <img alt="" aria-hidden="true" src={hermesMark} />
            <span>
              <strong>HERMES</strong>
              <small>Hermes-企业助手</small>
            </span>
          </div>
          <div aria-hidden="true" className="hesc-login-orbit">
            <span className="hesc-orbit-ring" />
            <span className="hesc-orbit-ring" />
            <span className="hesc-orbit-core">
              <img alt="" src={hermesMark} />
            </span>
            <i />
            <i />
            <i />
          </div>
          <div>
            <h1 id="enterprise-login-product">一体化 AI 企业{browserSurface ? '工作台' : '桌面工作台'}</h1>
            <p className="hesc-login-lede">统一承载 AI 助理、企业会话、任务与业务跟进、提醒、企业知识及人工接管。</p>
            <ul className="hesc-login-points">
              <li>会话、任务与知识在同一工作台内闭环处理</li>
              <li>角色与权限由服务端授权，登录后自动生效</li>
              <li>未接入能力明确标记，不做臆造展示</li>
            </ul>
          </div>
          <div aria-label="企业身份保障" className="hesc-login-features">
            <span>
              <b>
                <Check aria-hidden="true" />
              </b>
              <i>企业账号登录</i>
              <small>账号密码在{browserSurface ? '同源企业服务' : '客户端'}内完成验证</small>
            </span>
            <span>
              <b>
                <Lock aria-hidden="true" />
              </b>
              <i>{browserSurface ? '会话仅本页有效' : '凭据安全保存'}</i>
              <small>{browserSurface ? '不保存密码或会话令牌' : '令牌不进入渲染层'}</small>
            </span>
            <span>
              <b>
                <Users aria-hidden="true" />
              </b>
              <i>权限自动同步</i>
              <small>角色变更服务端生效</small>
            </span>
          </div>
        </section>

        <section aria-labelledby="enterprise-login-heading" className="hesc-login-panel">
          <div>
            <h2 id="enterprise-login-heading">登录企业账号</h2>
            <p>使用企业身份登录，进入你的 Hermes 工作台。</p>
          </div>
          <div className="hesc-login-status" role="status">
            <span
              aria-hidden="true"
              className="hesc-login-status-dot"
              data-state={busy ? 'loading' : error ? 'error' : 'idle'}
            />
            {status}
          </div>
          {error ? <p className="hesc-login-error">{error}</p> : null}
          {supportsPreReleaseAccess && preReleaseAccess?.enabled ? (
            <section
              aria-label="内部预发布接入"
              className="hesc-pre-release-access"
              data-stage={preReleaseAccess.stage}
            >
              <div>
                <h3>内部预发布接入</h3>
                <p>{preReleaseAccess.message}</p>
              </div>
              {preReleaseAccess.stage === 'client_missing' && preReleaseAccess.canInstall ? (
                <Button
                  disabled={preReleaseBusy}
                  onClick={() => void runPreReleaseAccess('install')}
                  size="sm"
                  type="button"
                >
                  安装 OpenVPN Connect
                </Button>
              ) : null}
              {['consent_required', 'client_unavailable'].includes(preReleaseAccess.stage) ? (
                <Button
                  disabled={preReleaseBusy}
                  onClick={() => void runPreReleaseAccess('open-client')}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  打开 OpenVPN Connect
                </Button>
              ) : null}
              {['profile_missing', 'profile_rejected', 'profile_import_failed'].includes(preReleaseAccess.stage) ? (
                <Button
                  disabled={preReleaseBusy}
                  onClick={() => void runPreReleaseAccess('import-profile')}
                  size="sm"
                  type="button"
                >
                  导入个人 .ovpn 配置
                </Button>
              ) : null}
              {preReleaseAccess.stage === 'profile_imported' ? (
                <Button
                  disabled={preReleaseBusy}
                  onClick={() => void runPreReleaseAccess('open-client')}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  打开 OpenVPN Connect 完成设置
                </Button>
              ) : null}
            </section>
          ) : null}
          <form className="hesc-login-form" onSubmit={submit}>
            <label>
              登录账号
              <input
                autoComplete="username"
                disabled={busy}
                onChange={event => setLoginName(event.target.value)}
                placeholder="请输入企业登录账号"
                value={loginName}
              />
            </label>
            <div className="hesc-login-password-field">
              <label htmlFor="enterprise-login-password">登录密码</label>
              <div className="hesc-login-password-control">
                <input
                  autoComplete="current-password"
                  disabled={busy}
                  id="enterprise-login-password"
                  minLength={6}
                  onChange={event => setPassword(event.target.value)}
                  placeholder="请输入登录密码"
                  type="password"
                  value={password}
                />
                {supportsRememberedLogin ? (
                  <label className="hesc-login-remember" title="使用本机系统加密保存密码">
                    <input
                      checked={remember}
                      disabled={busy}
                      onChange={event => {
                        setRemember(event.target.checked)
                        if (!event.target.checked) {
                          void window.hermesDesktop?.enterprise?.rememberedLogin?.(true)
                        }
                      }}
                      type="checkbox"
                    />
                    <span>记住密码</span>
                  </label>
                ) : null}
              </div>
            </div>
            {!supportsRememberedLogin ? (
              <p className="hesc-login-help">网页不会保存密码或会话令牌。请使用浏览器自身的密码管理器（如需）。</p>
            ) : null}
            <Button disabled={busy || !loginName.trim() || password.length < 6} size="lg" type="submit">
              {busy ? '正在验证账号…' : '登录企业工作台'}
            </Button>
          </form>
          {error ? (
            <Button onClick={onOpenLogs} type="button" variant="outline">
              打开运行日志
            </Button>
          ) : null}
          <p className="hesc-login-help">
            账号由平台管理员或企业管理员开通。本{browserSurface ? '网页' : '客户端'}
            不提供自助注册；密码和会话凭据不会写入运行日志。
          </p>
        </section>
      </div>
    </main>
  )
}

/** First-login rotation is deliberately a blocking product surface, not a
 * dismissible notification. The actual bearer rotation remains in Electron
 * main and the two password fields are cleared immediately after submit. */
export function EnterprisePasswordChangePage({ error, onComplete }: EnterprisePasswordChangePageProps) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (busy || mismatch || currentPassword.length < 6 || newPassword.length < 6) {
      return
    }

    const submittedCurrent = currentPassword
    const submittedNew = newPassword
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setBusy(true)

    try {
      await onComplete(submittedCurrent, submittedNew)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="hesc-login" data-testid="enterprise-password-change-root">
      <header className="hesc-login-titlebar">
        <img alt="" aria-hidden="true" src={hermesMark} />
        <span>Hermes-企业助手</span>
        <EnterprisePackageUpdateButton />
      </header>
      <div className="hesc-login-content hesc-password-change-content">
        <section className="hesc-login-brand">
          <div>
            <h1>首次登录需要修改初始密码</h1>
            <p className="hesc-login-lede">
              这是由企业管理员签发的一次性初始密码。修改完成后，旧会话会在服务器立即失效。
            </p>
          </div>
        </section>
        <section aria-labelledby="enterprise-password-change-heading" className="hesc-login-panel">
          <div>
            <h2 id="enterprise-password-change-heading">设置新的登录密码</h2>
            <p>新密码至少 6 个字符，请勿与初始密码相同。</p>
          </div>
          {error ? (
            <p className="hesc-login-error" role="status">
              {error}
            </p>
          ) : null}
          <form className="hesc-login-form" onSubmit={event => void submit(event)}>
            <label>
              当前初始密码
              <input
                autoComplete="current-password"
                disabled={busy}
                onChange={event => setCurrentPassword(event.target.value)}
                type="password"
                value={currentPassword}
              />
            </label>
            <label>
              新登录密码
              <input
                autoComplete="new-password"
                disabled={busy}
                minLength={6}
                onChange={event => setNewPassword(event.target.value)}
                type="password"
                value={newPassword}
              />
            </label>
            <label>
              确认新登录密码
              <input
                autoComplete="new-password"
                disabled={busy}
                minLength={6}
                onChange={event => setConfirmPassword(event.target.value)}
                type="password"
                value={confirmPassword}
              />
            </label>
            {mismatch ? <p className="hesc-login-error">两次输入的新密码不一致。</p> : null}
            <Button
              disabled={busy || mismatch || currentPassword.length < 6 || newPassword.length < 6}
              size="lg"
              type="submit"
            >
              {busy ? '正在更新密码…' : '确认并进入工作台'}
            </Button>
          </form>
        </section>
      </div>
    </main>
  )
}
