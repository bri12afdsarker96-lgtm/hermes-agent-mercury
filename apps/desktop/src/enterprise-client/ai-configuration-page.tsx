import { TenantAiConfigPanel } from './tenant-ai-config-panel'
import { TenantAiPersonaPanel } from './tenant-ai-persona-panel'
import type { EnterpriseClientRuntime } from './runtime'
import { WebSections, useWebLayoutCopy } from './web-sections'
import { useWebPresentation } from './web-presentation'
import { useI18n } from '@/i18n/context'

/** Dedicated tenant-admin destination for AI configuration, separate from staff governance. */
export function AiConfigurationPage({ runtime }: { runtime: EnterpriseClientRuntime | null }) {
  const web = useWebPresentation()
  const labels = useWebLayoutCopy()
  const { locale } = useI18n()
  const names = ({zh:['高级设置','知识检索','人设'],en:['Advanced settings','Knowledge retrieval','Personas'],ja:['詳細設定','知識検索','ペルソナ'],'zh-hant':['進階設定','知識檢索','人設']} as Record<string,string[]>)[locale] ?? ['Advanced settings','Knowledge retrieval','Personas']
  return <section className="hesc-page" data-testid="ai-configuration-page">
    <header className="hesc-page-header">
      <div>
        <h1>AI模型配置</h1>
        <p>{web.enabled ? '管理知识检索与回复风格。' : '集中维护企业可用的回答模型、加密保存的密钥和企业 AI 人设；员工与主管只使用已发布配置。'}</p>
      </div>
    </header>
    {web.enabled ? <WebSections label={labels.settings} items={[
      {id:'embedding',label:names[1],content:<>
        <TenantAiConfigPanel runtime={runtime} section="embedding" />
        <details className="web-disclosure" data-testid="answer-configuration-disclosure">
          <summary>{names[0]}</summary>
          <TenantAiConfigPanel runtime={runtime} section="models" />
        </details>
      </>},
      {id:'persona',label:names[2],content:<TenantAiPersonaPanel runtime={runtime} />}
    ]} /> : <><TenantAiConfigPanel runtime={runtime} /><TenantAiPersonaPanel runtime={runtime} /></>}
  </section>
}
