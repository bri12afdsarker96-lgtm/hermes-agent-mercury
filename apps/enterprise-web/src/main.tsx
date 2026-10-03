import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { EnterpriseWorkspaceApp } from '../../desktop/src/enterprise-client/workspace-app'

import { installEnterpriseWebBridge, logoutEnterpriseWebSession } from './browser-enterprise-bridge'
import { BrowserNotificationSettings } from './browser-notification-settings'
import './styles.css'

installEnterpriseWebBridge()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <EnterpriseWorkspaceApp
      additionalAccountActions={<BrowserNotificationSettings />}
      onBeforeLogout={logoutEnterpriseWebSession}
    />
  </StrictMode>
)
