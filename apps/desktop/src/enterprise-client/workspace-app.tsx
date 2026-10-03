import type { ReactNode } from 'react'
import { EnterpriseClientApp } from './app'
import { WebPresentationContext } from './web-presentation'
import { CashOverview } from './workspace/cash-overview'
import { WebReceivablesOverview } from './workspace/receivables-overview'
import { WebTaskDetails } from './workspace/task-details'
import './workspace/web-controls.css'

interface EnterpriseWorkspaceAppProps {
  additionalAccountActions?: ReactNode
  onBeforeLogout?: () => Promise<void>
}

/** One enterprise feature composition; each shell retains its own transport,
 * credentials, notifications and update mechanism. Never install a browser
 * bridge from here: desktop must continue to use its native preload bridge. */
export function EnterpriseWorkspaceApp(props: EnterpriseWorkspaceAppProps = {}) {
  return (
    <WebPresentationContext.Provider value>
      <EnterpriseClientApp
        {...props}
        receivablesOverview={WebReceivablesOverview}
        taskDetails={WebTaskDetails}
        cashOverview={CashOverview}
      />
    </WebPresentationContext.Provider>
  )
}
