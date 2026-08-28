/**
 * Plugin-scoped i18n for the Enterprise Console — registered under the plugin id
 * via `ctx.i18n.register`, never touching core `en.ts`. Access with
 * `usePluginI18n('enterprise-console')`. English + Simplified Chinese ship here;
 * more locales are additive.
 */

import type { PluginLocaleBundles } from '@hermes/plugin-sdk'

const en = {
  connect: {
    baseUrl: 'Hermes server address',
    baseUrlPlaceholder: 'http://127.0.0.1:8765',
    connect: 'Connect',
    connecting: 'Connecting…',
    intro: 'Connect to a Hermes server to load the console. The server owns identity, tenant, and permissions.',
    title: 'Connect to Hermes',
    token: 'Access token',
    tokenPlaceholder: 'principal bearer token'
  },
  nav: 'Enterprise',
  page: {
    alerts: 'Alerts',
    audit: 'Audit Replay',
    conversations: 'Conversations',
    dashboard: 'Dashboard',
    followup: 'Business Follow-up',
    handoff: 'Human Handoff',
    identity: 'Identity',
    knowledge: 'Knowledge',
    provider: 'Provider',
    reminders: 'Reminders',
    tasks: 'Tasks',
    usage: 'Usage & Budget',
    wecom: 'WeCom'
  },
  session: {
    authMode: 'auth mode',
    disconnect: 'Disconnect',
    principal: 'principal',
    role: 'role',
    tenant: 'tenant'
  },
  status: {
    blocked: 'Server API missing',
    blockedBody:
      'This page has no server authority yet and is awaiting a server-side contract. It is intentionally not built on the client.',
    dev: 'In development',
    devBody: 'The server reports this capability as not production-live. Shown for preview only.',
    denied: 'Not permitted',
    deniedBody: 'Your session does not carry the permission this page requires.',
    partial: 'Partial',
    pending: 'Page pending',
    pendingBody: 'Server contract confirmed; the console page is under construction in a later slice.',
    ready: 'Ready'
  },
  title: 'Enterprise Console'
}

const zh = {
  connect: {
    baseUrl: 'Hermes 服务器地址',
    baseUrlPlaceholder: 'http://127.0.0.1:8765',
    connect: '连接',
    connecting: '连接中…',
    intro: '连接到 Hermes 服务器以加载控制台。身份、租户与权限均由服务器掌控。',
    title: '连接到 Hermes',
    token: '访问令牌',
    tokenPlaceholder: 'principal bearer 令牌'
  },
  nav: '企业',
  page: {
    alerts: '告警',
    audit: '审计回放',
    conversations: '会话',
    dashboard: '仪表盘',
    followup: '业务跟进',
    handoff: '人工接管',
    identity: '身份',
    knowledge: '知识库',
    provider: '模型供应商',
    reminders: '提醒',
    tasks: '任务',
    usage: '用量与预算',
    wecom: '企业微信'
  },
  session: {
    authMode: '鉴权模式',
    disconnect: '断开',
    principal: '主体',
    role: '角色',
    tenant: '租户'
  },
  status: {
    blocked: '服务端接口缺失',
    blockedBody: '该页尚无服务端权威，正在等待服务端契约；已刻意不在客户端伪造实现。',
    dev: '开发中',
    devBody: '服务器报告该能力尚未达到生产可用状态，此处仅供预览。',
    denied: '无权限',
    deniedBody: '当前会话不具备该页所需的权限。',
    partial: '部分可用',
    pending: '页面待建',
    pendingBody: '服务端契约已确认；控制台页面将在后续切片中构建。',
    ready: '就绪'
  },
  title: '企业控制台'
}

export const ENTERPRISE_CONSOLE_LOCALES: PluginLocaleBundles = { en, zh }
