import { OrderFilterPanel } from './order-filter-panel'
import type { EnterpriseClientRuntime } from './runtime'
import { WeComReminderPanel } from './wecom-reminder-panel'
import { WeComSeatBindingPanel } from './wecom-seat-binding-panel'
import { WeComDutyPanel } from './wecom-duty-panel'

/** Local work aids deliberately live outside the tenant knowledge lifecycle. */
export function ToolsPage({ runtime, role }: { runtime?: EnterpriseClientRuntime | null; role?: string }) {
  return <section className="hesc-page" data-testid="tools-page">
    <header className="hesc-page-header">
      <div>
        <h1>工具集</h1>
        <p>面向日常业务处理的本地工具。文件只在当前设备处理，不会进入企业知识库或服务器。</p>
      </div>
    </header>
    <OrderFilterPanel />
    <WeComSeatBindingPanel runtime={runtime} />
    {runtime && ['supervisor', 'operator'].includes(role ?? '') ? <WeComDutyPanel runtime={runtime} role={role!} /> : null}
    {role === 'tenant_admin' ? <WeComReminderPanel runtime={runtime ?? null} /> : null}
  </section>
}
