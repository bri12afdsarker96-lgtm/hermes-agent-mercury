import React from 'react'
import { createRoot } from 'react-dom/client'
import { I18nProvider } from '@/i18n'
import { ThemeProvider } from '@/themes/context'
import { EnterpriseWorkspaceApp } from '@/enterprise-client/workspace-app'
import '../native-fixture-ui/styles.css'
import './test.css'

const configClient = { getConfig: async () => ({}), saveConfig: async () => ({ ok: true }) }
createRoot(document.getElementById('root')!).render(<I18nProvider initialLocale="zh" configClient={configClient}><ThemeProvider>
  <div className="fixture-banner">合成测试 · 模拟登录与假店铺 · 不连接真实店铺 · 不发生真实付款</div>
  <EnterpriseWorkspaceApp />
</ThemeProvider></I18nProvider>)
