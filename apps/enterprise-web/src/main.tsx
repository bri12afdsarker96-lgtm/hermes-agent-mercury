import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { EnterpriseClientApp } from '../../desktop/src/enterprise-client/app'

import { installEnterpriseWebBridge } from './browser-enterprise-bridge'
import './styles.css'

installEnterpriseWebBridge()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <EnterpriseClientApp />
  </StrictMode>
)
