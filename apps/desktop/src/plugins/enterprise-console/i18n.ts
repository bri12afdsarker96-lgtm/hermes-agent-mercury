/**
 * Plugin-scoped i18n for the Enterprise Console — registered under the plugin id
 * via `ctx.i18n.register`, never touching core `en.ts`. Access with
 * `usePluginI18n('enterprise-console')`. English + Simplified Chinese ship here;
 * more locales are additive.
 */

import type { PluginLocaleBundles } from '@hermes/plugin-sdk'

const en = {
  assistant: {
    open: 'AI Assistant'
  },
  nav: 'Enterprise',
  page: {
    alerts: 'Alerts',
    audit: 'Audit Evidence',
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
  login: {
    action: 'Sign in with enterprise account',
    check1: 'Conversations, tasks and knowledge close the loop in one workbench',
    check2: 'Roles and permissions are server-authorised and take effect after sign-in',
    check3: 'Unavailable capabilities are marked honestly — never fabricated',
    featureSso: 'Single sign-on',
    featureSsoBody: 'Enterprise identity, one-step sign-in',
    featureSync: 'Permissions sync',
    featureSyncBody: 'Roles apply in real time',
    featureVault: 'Keychain credentials',
    featureVaultBody: 'Encrypted, no secrets in the UI',
    footerNote: 'Workspaces appear automatically according to your role after sign-in',
    or: 'or',
    productBody:
      'Unify the AI assistant, WeCom conversations, tasks and business follow-ups, reminders, enterprise knowledge and human handoff — with role-based permissions, provider, usage budget and audit views for supervisors and tenant admins.',
    productHeadline: 'All-in-one AI enterprise desktop workbench',
    retry: 'Retry connection',
    sessionLabel: 'Enterprise session',
    state: {
      connected: 'Enterprise session established',
      connecting: 'Connecting to the enterprise service…',
      unavailable: 'Cannot reach the enterprise service',
      unavailableBody: 'Check the network and the enterprise service, then retry.',
      unknown: 'No enterprise session detected yet',
      unknownBody: 'Complete the desktop account sign-in first, then connect.',
      revoked: 'The enterprise session was revoked',
      revokedBody: 'Sign in again with your enterprise account.'
    },
    subtitle: 'Use your enterprise identity to enter your Hermes-企业助手 workspace',
    title: 'Sign in to your enterprise account'
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
    error: 'Something went wrong',
    module: 'Server module unavailable',
    moduleBody: 'The server has not assembled this module. Nothing is shown rather than faked.',
    partial: 'Partial',
    pending: 'Page pending',
    pendingBody: 'Server contract confirmed; the console page is under construction in a later slice.',
    ready: 'Ready'
  },
  title: 'Enterprise Console'
}

const zh = {
  assistant: {
    open: 'AI 助理'
  },
  nav: '企业',
  page: {
    alerts: '告警',
    audit: '审计证据',
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
  login: {
    action: '使用企业账号登录',
    check1: '会话、任务与知识在同一工作台内闭环处理',
    check2: '角色与权限由服务端授权，登录后自动生效',
    check3: '未接入的能力明确标记，不做臆造展示',
    featureSso: '单点登录',
    featureSsoBody: '企业身份一步登录',
    featureSync: '权限自动同步',
    featureSyncBody: '角色权限实时生效',
    featureVault: '凭据存入钥匙串',
    featureVaultBody: '数据加密，界面零密钥',
    footerNote: '登录后将根据你的角色自动展示可用工作区',
    or: '或',
    productBody:
      '统一承载 AI 助理、企业微信会话、任务与业务跟进、提醒、企业知识与人工接管，并为主管与租户管理员提供员工权限、Provider、用量预算与审计告警视图。',
    productHeadline: '一体化 AI 企业桌面工作台',
    retry: '重试连接',
    sessionLabel: '企业会话',
    state: {
      connected: '企业会话已建立',
      connecting: '正在连接企业服务…',
      unavailable: '无法连接企业服务',
      unavailableBody: '请检查网络与企业服务状态后重试。',
      unknown: '尚未检测到企业会话',
      unknownBody: '请先在桌面账户中完成企业账号登录，然后点击上方按钮连接。',
      revoked: '企业会话已被撤销',
      revokedBody: '请重新完成企业账号登录。'
    },
    subtitle: '使用企业身份登录，进入你的 Hermes-企业助手 工作台',
    title: '登录企业账号'
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
    error: '出错了',
    module: '服务端模块不可用',
    moduleBody: '服务端尚未装配该模块；此处不展示，也绝不伪造。',
    partial: '部分可用',
    pending: '页面待建',
    pendingBody: '服务端契约已确认；控制台页面将在后续切片中构建。',
    ready: '就绪'
  },
  title: '企业控制台'
}

export const ENTERPRISE_CONSOLE_LOCALES: PluginLocaleBundles = { en, zh }
