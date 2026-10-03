# 任务操作覆盖复核（2026-10-03）

本次是代码路径与前端组件回归审查，不是生产账户的实测证明。采用 agency-agents 的 UI Designer / UX Architect 检查方式：先验证权限与状态，再检查入口、操作可发现性及失败恢复。没有把管理可见误当成财务代办权，没有变更客户端发布包。

路径约定：`web` = `apps/enterprise-web/src`；`client` = `apps/desktop/src/enterprise-client`；`backend` = `D:/GitHub/同步/Hermes_AI.worktrees/enterprise-v0199-scope-fix/hermes_devices/enterprise`。行号为审查时快照，主任务仍在并行修改。

## 1. “待跟进只有转交”不是单一原因

| 场景 | 应有操作 / 原实际问题 | 证据 | 本轮处理 |
|---|---|---|---|
| 管理员/主管查看其他人的未终结应收 | 管理查看、授权范围内转交；不得直接替负责人确认到账 | `backend/followup_web.py:78` owner-only 生命周期；`:459` 非 owner 的 allowed_actions 为空；`:818` 按角色/状态返回 transfer_targets，`:822` 按 owner 返回 can_record_receipt | 不扩权限。在 `client/receivable-ledger.tsx:130` 根据真实能力字段提示“管理查看，可转交；收款登记由当前负责人处理”。不是前端漏画收款按钮 |
| 本人 open（未到期）应收 | 收款、改期、取消、关闭；原实现只在到期/待改期状态给 reschedule | `backend/followup_web.py:463`、`:855`；`web/task-details.tsx:271` 映射 allowed_actions | 已向后端同伴核实并补 open 改期 saga 路径；主 agent 接详情；真实数据库调度回归由后端同伴执行 |
| 本人 pending_confirmation 应收 | 确认应收，不是确认到账；另可取消/关闭 | 原 `_public` 仅 cancel/close；现 `backend/followup_web.py:461` 新增 confirm | 后端已接既有 confirmed 链；主 agent 已通知需前端 `confirm` 文案与说明。不能把该状态直接当作已收 |
| 本人 followup_due / waiting_update | 已收款、改期、取消、关闭；可登记部分到账 | `backend/followup_web.py:463`、`:822`；`web/task-details.tsx:271`；`client/receivable-ledger.tsx:132` | 路径存在，不是缺操作。详情 busy/loading/uncertain 暂时禁用，恢复状态后开放 |
| 本人 closed/cancelled 且余额>0 | 可补登真实到账，不重新开启提醒；不能自动视为结清 | `backend/followup_web.py:822`；前端只依 can_record_receipt 展示登记表单 | BP03 后端扩能力，前端无需 status 硬编码；已增 closed 且 capability=true 的表单回归 |
| completed 或余额为零 | 不继续登记到账；纠错由独立 can_correct_receipt 控制 | `client/receivable-ledger.tsx:132`、`:139` | 保持能力控制，不按“历史”一刀切隐藏所有操作 |

## 2. 入口与禁用链

- 待跟进 / 统一任务收件箱通过 `client/assistant-reminders.tsx:415` 的 `onInspect(task)` 进入单任务详情；非网页默认路径仍保留原按钮，未强行改桌面。
- 逾期页面通过 `client/overdue-page.tsx:28` 将当前行传给同一 inspect 回调。应收款、历史列表也由主任务复用 `WebTaskDetails`，不是根据入口再给一套权限。
- `web/task-details.tsx:77` 要求详情具有 allowed_actions；`:119` 提交再检查允许操作；`:271` 仅对已知 action 显示按钮。**新增后端 action 必须同步 action 文案映射**，confirm 是本轮确实发现的映射缺口。
- `web/task-details.tsx:320` 的 fieldset 仅在状态保存中或结果不确定时禁用流水；这不会隐藏收款/改期按钮。“只有转交”不能归因于该 fieldset。
- 状态操作与财务流水各有幂等恢复，结果未确认时保留“重试原提交”，不得为了让按钮可用而删除此保护。
- S22：Ledger 提供 `refreshKey` / `hideRefresh`；主详情统一刷新状态与流水，不要求用户猜数据源。

## 3. 其他模块的操作核查

| 模块 | 检查结果 | 证据 / 本轮处理 |
|---|---|---|
| 个人提醒 | 本人的 active/exhausted 详情具备完成、改期、取消；完成与取消分开，不是收款动作 | `web/task-details.tsx:80` 单提醒读路径；`:91` 操作矩阵。共享管理备用入口 `client/assistant-reminders.tsx:428` 也保留三动作 |
| 知识审核/发布 | 审核和发布是两个阶段，有权限与状态控制；不能因未到发布阶段而判漏按钮 | `client/knowledge-page.tsx:202` canReview、`:209` canPublish；`:675` 审核通过/驳回、`:707` 发布；现有回归覆盖审核失败不继续发布、已撤回不可检索 |
| 员工申请 | 企业管理员待审批可批准/驳回，主管不自动获得审批权 | `client/principal-provisioning-panel.tsx:364`、`:366`、`:371`、`:392`；角色与 pending 明确控制 |
| 员工组 | 新建、重命名、删空组、分配员工均存在；旧问题是创建失败清掉草稿、失效负责人留下幽灵选择、可选“未分组”却不执行动作 | `client/operations-group-panel.tsx:35` 负责人校验；`:56` 失败保留草稿；`:63` 网页未分组改成禁选占位，不伪装成可执行移出组命令 |
| 转交负责人 | 原平铺候选不利于团队选择，且刷新前旧候选可能失效 | `client/receivable-ledger.tsx:74` 转交前重读服务端授权候选；`:144` 团队→负责人；失效候选明确提示，不提交。重试原幂等操作不改 payload |
| 逾期/统一任务筛选 | 原“坐席的”包含其他管理员和主管，且来自任务行的候选会消失 | `client/followup-filters.tsx` 网页改“其他成员的”；scope_options 团队→成员；缺失筛选保留显式提示和清除，不静默扩大到全部。reminder-center 私有提醒仍由服务端限制 |

## 4. 状态与验证

已实施本子任务：F04/F05 owner 语义、授权层级和失效筛选；F06 候选刷新、团队转交；F07 表单草稿与失效 manager；F08 厂商切换清旧 key/url/model/edit ID；S22 刷新 API；S23 次要操作折叠；S25 模型区 section 接口与编辑收起；BP03 capability 前端适配。

配套 `client/web-business-controls.test.tsx` 覆盖失效筛选不自动扩大、团队清依赖、失败保留草稿、厂商凭据隔离、候选过期禁止 POST、closed 到账能力与统一刷新。已有桌面 ledger/model/filter/reminder 回归保持通过。网页版 typecheck 通过。

追加实现复核：主任务已把 `confirm: 确认建立跟进` 接入单详情映射，并展示“仅确认应收记录并启动跟进，不代表款项到账”。后端同伴已补 owner open 改期及 pending_confirmation 确认链。以上属于已修源码，尚不等同于生产验收。

新增 `e2e/task-action-coverage.spec.ts` 共 7 个浏览器用例：同一笔应收从应收/逾期/待跟进进入均展示服务端允许的已收款与改期，转历史后撤销生命周期按钮但可按 can_record_receipt 补登；三入口各自验证 pending_confirmation 不出现到账按钮、非 owner 管理查看不获得到账/改期权限。待确认用例特意让列表保留较旧的 open 快照，详情返回 pending_confirmation，证明前端依据新鲜详情授权而非旧列表。身份元数据保持管理员无组、坐席属于组的后端合同。

只执行 `playwright test e2e/task-action-coverage.spec.ts --list`，7 项已正确发现；遵照并行验收协调未启动浏览器服务器，实际执行交由主任务统一运行。

待主任务/后端联合验收：open 改期真实调度幂等、scope_options 生产端返回、上述七项浏览器回归及截图布局与窄屏可见性。本报告不宣称这些已在生产验收。

产品待确认（不是擅自扩权项）：是否允许管理员替他人登记金额、是否支持员工移出组、是否可重新打开已关闭提醒。这三项不能凭“少按钮”推导授权。
