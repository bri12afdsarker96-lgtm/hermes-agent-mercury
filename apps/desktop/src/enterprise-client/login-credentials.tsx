import { useState } from 'react'

export function CopyLoginText({ text, label }: { text: string; label: string }) {
  const [notice, setNotice] = useState('')
  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setNotice('已复制')
    } catch {
      setNotice('复制失败，请选中文字后按 Ctrl+C')
    }
  }
  return <span className="hesc-credential-action">
    <button className="hesc-text-action" type="button" onClick={() => void copy()}>{label}</button>
    {notice ? <span role="status">{notice}</span> : null}
  </span>
}

interface LoginCredentialsProps {
  login: string
  password: string
  hideLabel: string
  onHide: () => void
}

/** Only the newly issued login is copied; never tokens or the account directory. */
export function LoginCredentials({ login, password, hideLabel, onHide }: LoginCredentialsProps) {
  return <div className="hesc-provisioning-token">
    <strong>账号已创建，初始密码仅显示本次</strong>
    <div className="hesc-credential-row"><code className="hesc-selectable">账号：{login}</code><CopyLoginText label="复制账号" text={login} /></div>
    <div className="hesc-credential-row"><code className="hesc-selectable">初始密码：{password}</code><CopyLoginText label="复制密码" text={password} /></div>
    <div className="hesc-credential-row">
      <CopyLoginText label="复制账号和密码" text={`账号：${login}\n初始密码：${password}\n首次登录请修改初始密码。`} />
      <button className="hesc-action" type="button" onClick={onHide}>{hideLabel}</button>
    </div>
  </div>
}
