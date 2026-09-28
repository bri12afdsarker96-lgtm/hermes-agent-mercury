# 服务端接口与客户端可达功能反查

日期：2026-09-10。客户端以用户确认的 **0.20.3** 为准。

本次为只读代码与部署核查：检查线上发布目录
`/opt/hermes/releases/enterprise-web-v0.20.0-deffbab/hermes_devices/webserver.py`
的路由及实现，对照客户端 `apps/desktop/src/enterprise-client` 的调用、组件和角色导航。
未执行生产账号改密、业务写入、接口启用、修复或发布；没有逐项进行带业务账号的端到端验收。
接口有实现，不代表当前租户已启用其依赖服务、获得权限，也不代表当前网页版展示了入口。

## 一、已确认的网页对齐遗漏

| 功能 | 服务端接口/已有基础 | 客户端缺口 |
| --- | --- | --- |
| 日常主动修改密码 | `POST /api/password-change` | 只有首次登录强制改密流程；正常登录后没有主动入口 |
| 账户退出 | 主进程会话已有 disconnect；网页版使用 `/api/browser-logout` | 没有正常可达的账户退出入口；不能把 Cookie 注销接口直接照搬为桌面会话清理 |
| 应收款创建与本人列表 | `POST /api/business-followups`；`GET /api/business-followups?scope=personal` | 缺全局入口、新建、本人原始记录列表及创建后的即时刷新 |

应收款详情与处理接口已有部分接入：`GET /api/business-followups?followup_id=...`、
`POST /api/business-followup-action`。已有提醒处理不等于完整的应收款工作流。
布局、问答展示及线上追加脚本证据见
[网页与客户端对齐审计](WEB_0200_CLIENT_0203_PARITY_AUDIT.md)。

## 二、新确认的接口接入缺口

这些是相对于服务端能力的差距；除上节之外，不能一概称为当前网页版 0.20.0 已显示的功能。

| 能力 | 服务端接口 | 当前客户端 | 边界 |
| --- | --- | --- | --- |
| 历史知识上传与再次处理 | `GET /api/knowledge-uploads`；`POST /api/knowledge-rechunk` | 有当前文件上传、全文编辑、候选审核和发布；没有历史上传批次列表和按参数重新切分入口 | 历史上传记录与候选知识列表不是同一个列表；重新切分受上传状态和权限约束 |
| 业务任务完整操作 | `POST /api/biz-task-create`、`/api/biz-task-retry`、`/api/biz-task-close`、`/api/biz-task-escalate` | `business-tasks-panel.tsx` 只接列表、执行分配、认领和结果提交；没有这四个操作 | 业务任务不等于个人提醒或应收款。升级与人工接管有关，后者曾被要求隐藏，不能机械恢复入口 |
| 提醒触发历史 | `GET /api/reminder-occurrences` | 提醒中心有任务与处理动作，没有独立的每次触发记录展示 | 应按当前用户/租户与服务端权限查看；触发记录不等于通知已送达 |
| 通知投递与失败记录 | `GET /api/delivery-outbox` | 没有此接口的列表/详情展示 | 服务端可返回状态、尝试次数、下次重试、错误类别等；需要 `delivery.read`，不能给所有坐席暴露全量记录 |
| 企微本人值守与自动答复状态 | `GET /api/wecom-policy`；`POST /api/wecom-duty`、`/api/wecom-auto-reply` | 有企微身份绑定与提醒配置，但没有本人值守/自动答复开关 | 服务端只允许主管或坐席修改本人值守；只有坐席可改本人自动答复。此接口不证明外部客户群读取或任意私聊自动发送已可用 |
| 细粒度权限委派 | `GET/POST /api/delegations`；`POST /api/delegations-delete` | 有员工、组别和开户审批，但没有逐项委派/撤销授权界面 | 不是整个员工管理缺失；必须保留服务端授权子集及租户边界 |
| 租户高级运行策略 | `GET/POST /api/tenant-profile`；`POST /api/tenant-profile-delete` | AI 模型、人设、向量模型等配置已有；没有该运行策略配置面板 | 该接口还涉及接管超时、上传限制、业务默认项等；不能等同于现有 AI 模型配置，也不能全量开放给普通员工 |

服务端策略、上传、提醒、调度等模块部分采用可选依赖；若未装配，接口可能返回不可用或 501。
本表“接口存在”指线上代码确有路由和实现，不宣称每项都已经完成生产交互验收。

## 三、高级或历史模块：存在接口，但不是普通客户端应直接增加的菜单

| 模块 | 接口与检查结果 | 处理判断 |
| --- | --- | --- |
| 引擎定时作业 | `GET /api/schedules`；`POST /api/schedule-create`、`/api/schedule-update`、`/api/schedule-delete`、`/api/schedule-toggle`；客户端未接入 | 与现有个人提醒不同，涉及 action、设备、连接器及执行载荷；需单独确认交付范围和安全边界 |
| 独立记忆/用户画像管理 | `/api/memory`、`/api/memory-add`、`/api/memory-update`、`/api/memory-delete`、`/api/profile`、`/api/profile-set`；客户端未接入 | 不能与企业人设或客户草稿记忆混为一谈；部分记忆学习已有明确冻结决定 |
| 运维告警明细 | `GET /api/metrics/alerts`；已有 `/api/metrics` 也可返回 alerts，客户端类型声明了字段但没有对应明细展示 | 属于展示缺口，不一定需要新增一次 API 调用。历史整改已将工作台“活动告警”改为逾期提醒，不应擅自把该卡改回运维告警 |
| 事件续传/同步 | `POST /api/enterprise-gateway-ticket`、`/api/enterprise-events-resume`；客户端无对应调用 | 当前有轮询；未采用该同步路径不等于所有提醒失效。这是技术增强项，不是一个漏掉的业务按钮 |
| 能力策略管理 | 服务端有 GET/POST `/api/tenant-capability-policy`；客户端面板只读，且挂在正常导航不可达的分支 | 面板要求 super_admin，但其正常导航只有 platform，不进入 governance；服务端该能力仍有 DEV 标记，需要成熟度核查，不可只加入口宣称可用 |

## 四、已有代码但主动隐藏/冻结：不作为本次遗漏统计

- **人工接管与多客户接待工作区**：客户端保留页面及部分调用，但角色导航对所有租户角色都不提供 `handoffs`、`customer_replies`。`role-presentation.test.ts` 明确测试 deferred customer reception 不可见。历史 `FEISHU_0193_FEEDBACK.md` 又明确记录用户要求隐藏人工接管，并把外部群读取留待官方接口方案确定。不能将其解释成无意漏加。
- 接管服务端还存在 `/api/handoff-team`、`/api/handoff-reassign`、`/api/handoff-preempt`、`/api/handoff-reset`，客户端未接入这些管理动作；它们应随接管功能的后续产品决定处理，而不是本次自动重新开放。
- **录音与学习反馈**：`voice-controls.tsx` 的 `VOICE_INPUT_FROZEN = true`，`enterprise-reply-preferences.ts` 的 `ENTERPRISE_LEARNING_ENABLED = false` 都有明确冻结注释。接口及保留代码不意味着当前应显示开关。
- **朗读**：存在语音合成接口与 `use-enterprise-speech.ts`，当前企业页面没有正常挂载该 hook。应另查朗读功能的最新交付决定，不以录音冻结直接推定朗读也被要求冻结。

在实际 TypeScript 角色函数中，以四种角色和通配权限检查正常工作区：

| 角色 | 正常导航结果 |
| --- | --- |
| operator | workbench、assistant、reminders、tools |
| supervisor | workbench、assistant、reminders、conversations、tools |
| tenant_admin | workbench、assistant、conversations、reminders、knowledge、ai_config、governance、tools |
| super_admin | platform |

这证明“组件存在”不能代替“用户可达”，但是否应重新开放仍需结合上述既有产品决定。

## 五、排除的误报与接口别名

1. **知识撤回不是独立遗漏**：线上 `knowledge_delivery.py` 的 `withdraw()` 明确调用 `discard()`，注释说明用户撤回现在是永久删除。客户端已调用 `/api/knowledge-discard`。此前过程中将“知识撤回”列为新增缺口不准确，在此更正。
2. `/api/browser-login`、`/api/browser-password-change`、`/api/browser-logout` 是浏览器认证路径；桌面已有主进程认证机制，不能按 URL 名称差集判断缺失。
3. `/api/capabilities` 的信息可由已有 whoami 能力快照覆盖，不要求重复接入。
4. `/api/knowledge-search` 是独立机器调用路径；企业助手已有受控 RAG 链路，不需要为了 URL 对齐再绕开它。
5. 历史 `/api/knowledge-commit`、`/api/knowledge-committed`、`/api/knowledge-delete` 与当前候选审核发布流程不能简单等同；不应恢复旧的直接写入路径来凑齐接口。
6. `/api/business-followup-backfill` 是修复/回填操作，不是普通员工应收款创建入口。
7. 设备配对、画面流、远程运行、广播、连接器等接口属于设备/渠道能力，不等于当前企业客户端缺少所有这些功能。

## 结论与后续验收方式

本次缺口不能只用“补几个聊天框”解决：应收款与账户入口是已确认的网页对齐遗漏；其余还存在上传管理、任务操作、提醒/投递历史和高级策略等未接入能力。

但全功能对齐不等于把所有服务端路由都变成菜单。后续逐项记录：
**服务端实现 → 当前租户可用性/权限 → 客户端可达入口 → 请求与结果展示 → 正常和失败流程验收 → 安装包验收**。
已隐藏、冻结、兼容别名和运维接口单列，不列入普通坐席必补项。

本记录仅更新审计文档，没有修改应用或服务端代码，没有发布客户端更新。
