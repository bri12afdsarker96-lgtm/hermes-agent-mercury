import { TenantAiConfigPanel } from './tenant-ai-config-panel'
import { TenantAiPersonaPanel } from './tenant-ai-persona-panel'
import type { EnterpriseClientRuntime } from './runtime'

/** Dedicated tenant-admin destination for AI configuration, separate from staff governance. */
export function AiConfigurationPage({ runtime }: { runtime: EnterpriseClientRuntime | null }) {
  return <section className="hesc-page" data-testid="ai-configuration-page">
    <header className="hesc-page-header">
      <div>
        <h1>AI模型配置</h1>
        <p>集中维护企业可用的回答模型、加密保存的密钥和企业 AI 人设；员工与主管只使用已发布配置。</p>
      </div>
    </header>
    <TenantAiConfigPanel runtime={runtime} />
    <TenantAiPersonaPanel runtime={runtime} />
  </section>
}
