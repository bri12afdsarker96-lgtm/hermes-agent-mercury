import { OrderFilterPanel } from './order-filter-panel'
import { useState } from 'react'
import { AiConfigurationPage } from './ai-configuration-page'
import { useI18n } from '@/i18n/context'
import type { EnterpriseClientRuntime } from './runtime'
import { WeComReminderPanel } from './wecom-reminder-panel'
import { WeComSeatBindingPanel } from './wecom-seat-binding-panel'
import { WeComDutyPanel } from './wecom-duty-panel'
import { WebSections, useWebLayoutCopy } from './web-sections'
import { useWebPresentation } from './web-presentation'

/** Work aids and protected service configuration share the tools destination. */
export function ToolsPage({ runtime, role, canConfigureAi = false }: { runtime?: EnterpriseClientRuntime | null; role?: string; canConfigureAi?: boolean }) {
  const [configurationOpen, setConfigurationOpen] = useState(false)
  const { t } = useI18n()
  const web = useWebPresentation()
  const labels = useWebLayoutCopy()
  return <section className="hesc-page" data-testid="tools-page">
    <header className="hesc-page-header">
      <div>
        <h1>工具集</h1>
        <p>{t.enterpriseModelConfig.toolsPurpose}</p>
      </div>
    </header>
    {canConfigureAi ? <details className="web-disclosure" onToggle={event => setConfigurationOpen(event.currentTarget.open)}>
      <summary>{t.enterpriseModelConfig.configurationEntry}</summary>
      {configurationOpen ? <AiConfigurationPage runtime={runtime ?? null} /> : null}
    </details> : null}
    {web.enabled ? <WebSections label={labels.settings} items={[
      {id:'tools',label:labels.tools,content:<OrderFilterPanel />},
      {id:'notifications',label:labels.notifications,content:<><WeComSeatBindingPanel runtime={runtime} />{runtime && ['supervisor','operator'].includes(role ?? '') ? <WeComDutyPanel runtime={runtime} role={role!} /> : null}</>},
      ...(role === 'tenant_admin' ? [{id:'channels',label:labels.channels,content:<WeComReminderPanel runtime={runtime ?? null} />}] : [])
    ]} /> : <><OrderFilterPanel />
    <WeComSeatBindingPanel runtime={runtime} />
    {runtime && ['supervisor', 'operator'].includes(role ?? '') ? <WeComDutyPanel runtime={runtime} role={role!} /> : null}
    {role === 'tenant_admin' ? <WeComReminderPanel runtime={runtime ?? null} /> : null}</>}
  </section>
}
