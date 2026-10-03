# 第二轮业务映射与角色权限审查（2026-10-03）

## 范围与结论

以当前网页 0.20.8-fix2 源码、共享企业界面、服务端实现为依据，对照 `WEB_UI_AUDIT_20261002.md` 和 `RELEASE_0208_FIX2.md`。使用 agency-agents 的 Code Reviewer 与 Identity & Access Engineer 方法，追踪入口→请求→授权→数据范围→状态/金额口径。上一轮已发现的输入框、命名、尺寸、批量选择文案不重复计入。

本轮新增 **7 项代码可证实问题、2 项需明确业务授权口径的问题**。优先处理员工离职后账本不可见、提醒截断和历史未收款无收款闭环。没有发现并证明可跨租户读写的现成利用链；这不等于全系统安全认证通过。

这是只读代码审查，不是生产渗透或全功能端到端验收。未登录生产账号、未修改真实账目/权限/角色、未部署或改客户端。仅写入本报告。执行了两个无数据库写入的 Python 纯函数探针；其他结论为明确代码路径/现有测试证据。

路径简写：

- `web/` = `D:/GitHub/同步/hermes-agent-mercury/.worktrees/enterprise-client/apps/enterprise-web/src/`
- `shared/` = 同工作树 `apps/desktop/src/enterprise-client/`
- `backend/` = `D:/GitHub/同步/Hermes_AI.worktrees/enterprise-v0199-scope-fix/hermes_devices/`
- 行号为审查时快照；主任务正在同步整改 UI，少量前端行号可能顺延。

## 已核查的角色/业务链路

| 业务入口 | 员工 | 主管 | 企业管理员 | 服务端授权与数据范围 |
| --- | --- | --- | --- | --- |
| 应收总览/台账/详情 | 本人 | 本人及直属坐席 | 活跃企业成员 | `/api/receivables-report`、`business-followups`、`business-followup-history`：身份重验、提醒能力门、租户范围及可见 owner；见 `backend/enterprise/followup_web.py:161,314,357,652` |
| 登记收款/冲销/备注 | 本人 | 仍仅本人 | 仍仅本人 | `receipt_action:674`、`manage_action:732`、`WebFollowupAuthorization:78`；管理可见不是代操作授权 |
| 转交应收负责人 | 无 | 授权组内活跃成员 | 授权企业内活跃成员 | `followup_web.py:384,734,766`；不是前端下拉框防线 |
| 个人提醒 | 本人读写 | 本人读写 | 本人读写 | `/api/assistant-reminder-action` → `webserver.py:2912,1580` → `assistant_reminders.py:66` 同时验证 tenant/owner/subject_type；其他人的 ID 返回 404 |
| 下属任务看板 | 不显示 | 本组坐席只读 | 企业成员只读 | `/api/operations-reminders` → `webserver.py:2345`；与个人提醒私有性存在下述 BP-08 口径冲突 |
| 员工创建/分组 | 无 | 申请坐席 | 创建下级、审批、分组 | `webserver.py:2570,2652,2401`：角色+租户验证，不能借请求 body 创建同级/平台管理员或跨企业分组 |
| 知识管理 | 当前导航不提供管理入口 | 不提供管理入口 | 获授权审核/发布/删除 | `shared/role-presentation.ts:48,63,81`；服务端 `knowledge_delivery.py:129,191,258` 重验身份/具体权限；不能以看板统计推定知识全文授权 |
| AI 模型/人设 | 使用企业可用配置 | 使用企业可用配置 | 配置本企业 | `_tenant_ai_gate` 及配置/人设端点的 tenant_admin 检查；AI 提醒整理存在下述 BP-09 能力边界待确认 |
| 密码/退出 | 本人 | 本人 | 本人 | 浏览器适配 `/api/browser-password-change`、`browser-logout`；HttpOnly 同源 cookie，非浏览器存储明文 token（`web/browser-enterprise-bridge.ts:138,175`） |

平台管理员单独走企业开通工作区，不把全局 `super_admin` 无 tenant 的身份直接送入企业台账；见 `shared/role-presentation.ts:124`。本轮没有将该刻意隔离误报为缺功能。

## 代码可证实的问题

### BP-01 · P1 · 删除/停用员工后，其未收款与历史收款会退出企业报表

- 角色/入口：企业管理员删除坐席/主管；随后查看运营总览金额、应收总额、未收总额、历史记录和单任务详情。
- API：`POST /api/principals-delete`，随后 `GET /api/receivables-report` / `business-followups?followup_id=…`。
- 证据：`backend/enterprise/operations_overview.py:289–301` 先把成员限定为 `status=active`，管理员可见 owner 只取该集合；`followup_web.py:363,660` 依此拒绝详情/过滤报表。`webserver.py:3335–3384` 删除只对主管组成员做预检，不检查应收未结清或财务交接；身份删除后清理提醒。`dataplane/schema.sql:556` 业务 owner 为普通 TEXT；`:1638` 删除身份流程未移交账目，业务事实仍在。
- 触发：某员工有未结清、部分收款或已结清历史单，然后被删除/停用；财务状态本身未变，但该 owner 不再 active。
- 影响/金额口径：管理员的应收、已收、未收、关闭未收等都会因人员生命周期减少，而不是收款/冲销/核销事实变化；历史不能通过原入口追溯。不能把“看不见”说成账已清。
- 验证：纯函数探针确认 admin + disabled seat 的可见 owner 集合只剩 admin；删除链和表约束已静态串联。未对生产执行删号。
- 最小修复：离职前增加业务交接预检；财务历史可见范围与“可登录活跃成员”范围分离，保存原负责人审计标识。不要直接恢复被删员工登录，也不要级联删除账务。
- 验收：删除/停用前后企业财务总额守恒；原员工不能登录，管理员仍能查历史；未结清单有明确接任人；主管看不到其他组；其他租户不可见。

### BP-02 · P1 · 提醒先截断后按人/状态筛选，可能静默漏任务和低报总数

- 角色/入口：所有人的提醒中心、逾期页；管理员/主管下属任务看板。
- API：`assistant-reminders`、`reminder-center`、`operations-reminders`。
- 证据：`backend/reminders/sqlite_store.py:218–231` 按整个租户 `ts_updated DESC LIMIT 1000`；`assistant_reminders.py:69` 在这之后才筛 owner；`followup_web.py:612–630` 再筛本人及 active/exhausted。运营投影还在 `operations_overview.py:453,468` 截成前 200 条后计算“总数”；前端 `shared/operations-overview-panel.tsx:132` 同样用返回数组长度。
- 触发：租户超过 1000 条提醒（含别人/已完成历史），本人较老的未处理提醒排在其后；或管理范围内当前提醒超过 200 条。
- 状态/金额：影响 active/exhausted 提醒、逾期计数和入口任务集合，不直接改变应收金额。
- 最小修复：存储层先按授权 owner/subject/state 过滤，再分页；总数独立聚合，返回游标/has_more；不能只把常量调大。
- 验收：1001+ 跨成员记录、200+ 管理待办；最老未处理项仍可定位，总数准确，翻页不越权。应收详情中的个人提醒按单 ID 读取，不依赖全列表是否刚好包含它。

### BP-03 · P1 · 历史关闭/取消未收款计入总额，但没有后续收款处理闭环

- 角色/入口：原负责人点击“关闭／取消未收”→任务详情；管理员能看但不能代替负责人登记。
- API：`business-followup-history`、`receivable-receipt-action`、`business-followup-action`。
- 证据：报表 `receivables_reporting.py:129–138` 把关闭/取消剩余余额计入 unpaid/inactive；`followup_web.py:437–442` 对终态不提供 received；`:769` 只让 open/followup_due/waiting_update 登记收款；`receivable_payments.py:55,103` 后端也禁止终态新增收款。已收流水可冲销，但不能把新到账款登记进关闭/取消原单。
- 触发：先取消提醒/关闭跟进，客户后续才转账。页面说关闭不等于收款，但无可用路径减少该笔欠款。
- 金额口径：不是建议把关闭自动当已收；应追加真实收款事实，保持原应收单、关闭事实和审计流水。
- 最小修复建议需业务选择：允许终态补登记收款但不自动恢复提醒，或提供获授权的“恢复跟进”再登记；禁止靠新建重复应收单绕过。
- 验收：关闭100元、已收30元、后到70元可在同原单处理；总应收不增加，未收减少，历史可追溯；原有 owner/tenant/幂等规则保留。

### BP-04 · P1 · 通知失败的过期个人任务，在不同板块归类相反

- 角色/入口：本人统一提醒中心/逾期未处理，与管理者下属任务看板。
- 证据：`followup_web.py:536` 仅 active 算 overdue；exhausted 仍入列表但映射 `pending_followup`。`assistant_reminders.py:76` 同样只判 active；对照 `operations_overview.py:432` 将 active/exhausted 到期均视为逾期。`shared/overdue-page.tsx:14` 严格筛 row.overdue，因而排除 exhausted。
- 验证：纯函数探针对已过期 exhausted 得到 `overdue=False, task_status=pending_followup`。
- 影响：最需要跟进的“通知失败”被归为普通待跟进；管理者看到逾期，本人逾期页找不到。通知失败不是任务完成。
- 最小修复：统一未完成状态与到期判定，另外保留“投递失败”维度；不把 exhausted 自动标已处理。
- 验收：同一 exhausted 任务在三处 overdue 判定一致，可改期/完成/取消，成功操作后同步消失。

### BP-05 · P1 · 运营提醒存储故障被转换成“没有任务”，而非同步失败

- 角色/入口：企业管理员/主管运营总览下属提醒。
- API：`operations-overview`、`operations-reminders`。
- 证据：`backend/webserver.py:2318–2320` 捕获提醒存储任意异常后 `reminders=[]`，继续返回成功投影；前端 `shared/operations-overview-panel.tsx:125–138,214–216` 会清除 reminderError，显示0条/暂无任务。
- 触发：提醒存储临时不可用；非“确实0项”。金额本身不受此链影响。
- 最小修复：返回可分辨的 unavailable/degraded 字段或503；前端保留上次成功快照并标注过期，未知不显示0。
- 验收：故障注入时显示同步失败而非0，恢复后自动重读；不把已展示任务清空误导管理者。

### BP-06 · P2 · “本视图坐席数”实际绑定整个企业全部活跃账号数

- 角色/入口：主管团队工作台、管理员运营总览。
- API：`operations-overview`。
- 证据：`backend/enterprise/operations_overview.py:381,461` 把 account_summary.total 赋给 scope.operator_count（管理员+主管+员工）；`shared/operations-overview-panel.tsx:198` 标为“本视图坐席数”，主管注释“仅本主管组内坐席”。现有 `tests/test_enterprise_operations_overview.py:63` 明确固化全企业5账号，而该主管 staff 只有1个坐席。
- 影响：数值、角色范围和标题不一致；不是新增越权写入，但全企业账号总数对主管是否应披露也需明确。
- 最小修复：返回独立 scoped_operator_count；前端绑定真正本组坐席数。需要全企业账号数时用独立授权和“活跃账号总数”标签，不能继续复用错误字段。
- 验收：2主管各1员工+1管理员，主管各看到1，管理员坐席数2；若展示账号总数则明确为5且按授权决定。

### BP-07 · P2 · 提醒创建与新详情改期使用不同的时区规则

- 角色/入口：所有用户提醒中心手工创建/旧个人管理改期，对照单任务详情改期。
- API：均为 `assistant-reminder-action`，提交 scheduled_for 时间戳。
- 证据：`shared/assistant-reminders.tsx:36,301,403,414` 使用浏览器本地时区；默认班次文案为北京时间（`:369`）。`web/task-details.tsx:139` 则明确拼 `+08:00`，界面标北京时间。
- 触发：测试电脑/浏览器时区不是 Asia/Shanghai，同样输入某日09:00，从不同入口提交得到不同时间戳。
- 最小修复：在网页明确统一“北京时间”，或所有入口都清晰展示本机时区并转换；不能只改标签。AI返回带时区时也要保持同一规则。
- 验收：Asia/Shanghai、UTC、America/Los_Angeles 浏览器各走创建→查看→改期，相同业务北京时间得到同时间戳；夏令时边界不发生静默偏移。

## 已证实实现差异，但需业务/授权口径确认

### BP-08 · P1 决策项 · “个人提醒私有”与“下属定时提醒可读”冲突

- 证据：`followup_web.py:623–630` 与 `tests/test_enterprise_followup_web.py:274–305` 明确称下属个人提醒为 private，统一提醒中心不提供；但 `operations_overview.py:17,398–441` 将 assistant_personal 的标题、时间、状态返回本组主管及企业管理员，现有运营测试也要求此行为。
- 角色/映射：主管在统一逾期页看不到下属个人提醒，却在运营看板看到全文标题；新详情只支持本人个人提醒，不能直接复用为管理查看。
- 不定性为已证实越权漏洞：用户早先明确要求“坐席定时筛选”，存在管理只读意图；两套服务的隐私合同必须统一，不能凭一侧注释直接扩大或收紧。
- 最小决策：若私有，管理接口只返回获授权业务提醒/不敏感数量；若允许管理可读，明确“个人创建≠私有”，统一服务端只读范围及单项详情，并保留禁止代操作。
- 验收：本人、直属主管、其他组主管、管理员、其他租户五类身份对同任务的标题/时间/详情/写入有一致矩阵；不得仅靠隐藏按钮。

### BP-09 · P2 决策项 · 关闭 AI 助手能力后，提醒“AI解析”仍直接调用模型

- 证据：`webserver.py:1580` prepare 只经 `_personal_reminder_gate`；`assistant_reminders.py:80–100` 直接 build_tenant_llm/chat。企业聊天经 `_tenant_ai_gate`（`webserver.py:2881`）检查 tenant.ai.assist 与 ai_assistant capability，prepare 未使用该门。
- 触发：reminder_center 开启、ai_assistant 关闭/不授权，用户点“AI解析并预览”。
- 确认点：关闭 AI 助手到底只关聊天产品，还是关闭该角色模型调用/费用；若后者则当前规划路径可绕过业务能力开关，若前者应作为提醒独立模型能力明示。
- 最小修复：明确权限合同后统一 gate，禁AI时保留手动提醒及本地确定性解析，不破坏“没配模型也可提醒”的既有设计。
- 验收：权限/能力开关组合测试检查真正的 LLM 调用次数，而不只看前端按钮；模型拒绝后手动创建仍正常。

## 优先顺序与后续验收边界

1. BP-01 离职财务连续性 → BP-02/BP-05 数据完整与错误状态 → BP-03 历史到账闭环 → BP-04 状态映射。
2. BP-06/BP-07 分别修范围计数和时区；BP-08/BP-09 先确认业务合同，再改权限，不混入纯视觉发布。
3. 将上述用例补入跨层合同测试：员工/主管/管理员、同组/跨组/跨租户、部分收款/终态/离职、旧记录量、请求失败、跨时区。
4. 前端每个金额入口要继续沿用服务端统一投影和 Decimal 口径；不从当前页行数/金额补算全量统计，不修改客户端更新源。

说明：现有测试与纯函数探针只证明所引用的局部行为。本报告没有宣称完成整个服务端每个端点的运行态越权测试、真实收款测试或生产角色账号验收。
