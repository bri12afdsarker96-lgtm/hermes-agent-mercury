import { useEffect, useState } from 'react'

export function LocalVerificationBadge() {
  const [state, setState] = useState<'unknown' | 'local' | 'production'>('unknown')
  useEffect(() => {
    let active = true
    void window.hermesDesktop?.isLocalVerification?.().then(value => {
      if (active) setState(value === true ? 'local' : value === false ? 'production' : 'unknown')
    }).catch(() => { if (active) setState('unknown') })
    return () => { active = false }
  }, [])
  if (state === 'production') return null
  return <div role="status" style={{ position: 'fixed', zIndex: 2147483647, top: 3, left: '50%', transform: 'translateX(-50%)',
    pointerEvents: 'none', background: '#a92f1e', color: '#fff', borderRadius: 4, padding: '2px 10px', fontSize: 12,
    fontWeight: 700, lineHeight: '20px' }}>{state === 'local' ? '本地联调' : '环境未核验'}</div>
}
