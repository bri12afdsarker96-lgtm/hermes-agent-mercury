# Hermes Enterprise Client · 后续研发交接

> 交接日期：2026-09-03（Asia/Shanghai）
> 交接范围：独立 Desktop 客户端、Hermes_AI authority、官方 Hermes 上游复用
> 接手原则：**以仓库当前代码、GitHub PR 与自然 CI 为事实源；本文件是施工地图，不替代服务端 authority。**

---

## 1. 必须掌握的三仓关系

| 角色 | GitHub 仓库 | 默认/主线 | 本阶段职责 |
| --- | --- | --- | --- |
| Desktop / Mercury | <https://github.com/bri12afdsarker96-lgtm/hermes-agent-mercury> | `main`；本线工作分支见下文 | 独立 Electron/React/Vite 客户端、安全桥、企业 UI、打包与桌面端验收 |
| Server / authority | <https://github.com/bri12afdsarker96-lgtm/Hermes_AI> | `claude/hermes-desktop-multi-ai-phone-aiw5mr` | identity、tenant、permission、PostgreSQL/RLS、业务状态机、审计、WeCom、Reminder、Assistant runtime |
| Official upstream | <https://github.com/NousResearch/hermes-agent> | `main` | Hermes 核心能力、上游复用与同步来源；不向其中提交 Hermes Project 产品代码 |

```text
NousResearch/hermes-agent
        │ upstream / reuse / sync
        ▼
hermes-agent-mercury (独立 Desktop 壳与适配层)
        │ HTTPS contract / secure Electron bridge
        ▼
Hermes_AI (唯一业务 authority)
```

### 1.1 复用纪律

任何新增能力先按以下顺序检查，不能跳过：

```text
Hermes 当前 exact seam
→ Mercury 已有实现
→ NousResearch/hermes-agent upstream
→ 官方 SDK / 成熟库
→ 无合适能力时才最小新增
```

Desktop 只能复用 Hermes 的 runtime 与基础能力；产品 UI 必须继续使用 Hermes Enterprise 自己的设计系统，不能回退到上游既有 Desktop/Console 外观。

---

## 2. 当前准确快照

### 2.1 Mercury / Desktop

- 本地工作树：`D:\GitHub\同步\worktrees\independent-client-shell`
- 分支：`codex/independent-client-shell`
- HEAD：`059a75d6768e6278d0bb9597148781c2feab96a7`
- Pull Request：[#37 · Draft](https://github.com/bri12afdsarker96-lgtm/hermes-agent-mercury/pull/37)
- PR base：`deepseek/p1-responsive-a11y-current-head-01`
- PR #37 当前 CI：已通过（Desktop TS/lint/UI shards/desktop platform tests 等）；该 PR 仍为 Draft，**不自行标记 Ready 或合并**。
- 本地未提交用户改动：`contributors/emails/agent@Agents-Mac-mini.local`。
  - 该文件不属于本交接功能；接手人必须保留，不能 add、restore、reset 或混入功能提交。

### 2.2 Hermes_AI / Server

- 本地工作树：`D:\GitHub\同步\Hermes_AI\Hermes_AI`
- 当前本地分支：`minimax/p1-functional-close-final-integration-01`
- 本地 HEAD：`9be1abc46d204cf38a40bcef30cbc0a5782bac81`
- Pull Request：[#135 · Draft](https://github.com/bri12afdsarker96-lgtm/Hermes_AI/pull/135)
- PR #135 head：`04820be472cb5b4d85c2a622047e03a6eba2365c`
- PR base：`claude/p3-m4a-server-console-phase1-01`
- PR #135 当前自然 CI：8 项成功（Linux/Windows pytest、WeCom、dataplane-pg）。
- Server 工作树存在一项未跟踪内容。开始任何 Server 写入前，先运行 `git status --porcelain -z` 确认其真实路径、归属和是否应保留；不允许把它纳入本阶段提交。

### 2.3 关键服务端 Gate

PR #135 的代码和 CI 成功不等于生产授权、部署或 aggregate review 已完成。当前必须维持以下诚实表述：

```text
PR #135 = OPEN + DRAFT + CI SUCCESS
Aggregate functional-close review = 未裁决
Production deployment / cutover = 未执行
Production Follow-up Authorization Policy = NOT FOUND
Production Follow-up Schedule / Timezone Policy = NOT FOUND
```

因此客户端不得为 Business Follow-up 增加“确认、改期、转交、完成”等写入口。现有读模型可以显示事实；写模型只能在服务端 policy 被明确授权、实现、审计并验收后接入。

---

## 3. 已交付的独立客户端能力

以下提交均已推送到 PR #37。接手时先阅读对应 diff 和测试，不要重写。

| 提交 | 已完成板块 | 客户端结果 |
| --- | --- | --- |
| `ff49e028cb` | 独立壳 | Hermes Enterprise 独立界面根、主导航、产品样式与安全 runtime bridge |
| `b521612ced` | 知识空间 | 已提交知识集合只读投影 |
| `3526fec4ff` | 智能助手 | Hermes runtime 会话与流式交互适配 |
| `6a8e0cab8d` | 会话可观测性 | 入站、出站、投递尝试链只读投影 |
| `ed8cb7eb39` | 治理证据 | 身份、能力、审计索引 |
| `a63c0135f9` | 工作流 | Follow-up 列表与状态历史 |
| `070379614d` | 人工协同 | handoff 列表、认领、回复、退回智能分诊 |
| `5b50ba7cd1` | 提醒中心 | 提醒列表、创建、取消（均经 Server authority） |
| `f55d07f025` | Knowledge Gap | 读取、人工补充、拒绝；不把搜索伪装为 LIVE |
| `5567ce7307` | Follow-up 详情 | 授权详情和历史的只读闭环 |
| `ef5fe89a85` | 审计证据链 | event index → detail → 同资源关联；绝不重放命令 |
| `df8f3496b5` | 租户能力策略 | 只读策略模式、revision、角色矩阵与 LIVE 可管理性 |
| `c03e4a8327` | 企业任务执行 | BizTask 与 assignment 投影、停滞事实 |
| `9cd3798b15` | 已认领任务处理 | 显式认领、当前 claimant 的 close/retry；服务端仍做最终状态机/权限裁决 |
| `059a75d676` | 会话运营 | 入/出站 state 筛选和投递故障定位，不读正文、不重放投递 |

现有 Enterprise Client 测试：`apps/desktop/src/enterprise-client/*.test.tsx`，最近一次回归为 **10 files / 10 tests passed**。

---

## 4. 当前文件与服务端契约地图

### 4.1 Mercury 入口

| 文件 | 职责 | 不可破坏的约束 |
| --- | --- | --- |
| `apps/desktop/src/main.tsx` | 独立客户端 renderer 入口 | 不重新挂回旧 Console/旧路由 |
| `apps/desktop/src/enterprise-client/app.tsx` | 壳、导航、连接生命周期、工作台 | runtime 只能来自安全 bridge；不把 token 放入 React state/localStorage |
| `apps/desktop/src/enterprise-client/runtime.ts` | renderer 的产品 runtime adapter | renderer 不持有 bearer、URL 或服务端密钥 |
| `apps/desktop/electron/*` | 主进程 bridge 与 token 隔离 | 只允许已白名单的 API 方法/路径；不把 generic network 透传给 renderer |
| `apps/desktop/src/enterprise-client/*.tsx` | 各业务页面 | 页面只消费 authority 投影；写入仅由用户明确触发 |
| `apps/desktop/src/enterprise-client/enterprise-client.css` | 独立 UI 设计实现 | 保持 Hermes Enterprise 视觉系统，不复用旧客户端 UI |

### 4.2 已连接的 API

| 产品面 | API | 读/写 | 服务端职责 |
| --- | --- | --- | --- |
| 工作台 | `/api/health`、`/api/whoami`、`/api/metrics?window=24h` | 读 | 运行态、身份、能力快照、告警 |
| 会话运营 | `/api/conversations-inbound`、`/api/conversations-outbound`、`/api/conversations-attempts` | 读 | RLS、owner scope、脱敏账本投影 |
| 人工协同 | `/api/handoffs`、`handoff-claim/reply/requeue` | 读/显式写 | 租户、claim、投递、并发处理 |
| 知识空间 | `/api/knowledge-committed`、`/api/kb-gaps`、`kb-gap-author/reject` | 读/显式写 | 权限、知识治理、Gap 状态 |
| 工作流 | `/api/followup-list/detail/history` | 读 | Follow-up RLS read model |
| 提醒 | `/api/reminders`、`reminder-create/cancel` | 读/显式写 | Reminder authority、幂等与生命周期 |
| 企业任务 | `/api/biz-tasks`、`biz-task-assignments`、`biz-task-claim/resolve` | 读/显式写 | BizTask 状态机、claim 冲突、权限 |
| 治理 | `/api/audit-list/detail/correlate`、`/api/tenant-capability-policy` | 读 | audit.read、RLS、策略 authority |

### 4.3 明确不应接入为“已上线”的能力

| 能力 | 原因 | 正确客户端行为 |
| --- | --- | --- |
| 企业知识搜索 | `knowledge_rag` 仍为 DEV，且 `/api/knowledge-search` 需 `ai_assistant` LIVE gate 与 `kb.search` | 标记未上线/不可用；不能用样例答案替代 |
| Follow-up 生命周期写入 | production policy authority 仍为 NOT FOUND | 只显示服务端事实与历史 |
| Capability Policy 写开关 | 需正式 policy mode、revision/CAS 和管理员授权 | 仅展示只读矩阵 |
| Feishu | 总纲为 Phase-2 deferred | 不在客户端展示为可用渠道 |
| 生产 WeCom 配置/凭据 | 不得进入 Git、前端、prompt 或普通日志 | 只能在服务端受控部署后做 E2E |
| 自动 Knowledge Publish / 自动训练 | 违反治理总纲 | 仅走 candidate/review/publish 的后端 authority |

---

## 5. 建议正式开启的下一阶段：N1 跨仓契约固化与真实运行态验收

### 5.1 目标

将当前已接入的页面从“逐页可用”提升为“整机可安全连接、可解释故障、可验证边界”的产品层。N1 主要在 Mercury 完成，不以 N1 为名扩张 Hermes_AI 业务能力。

```text
启动
→ Electron main 建立 token-hidden session
→ renderer 读取 health + whoami + metrics
→ capability / permission / authority 状态映射
→ 页面显示真实数据或真实不可用原因
→ 用户显式操作
→ Server 最终授权、RLS、状态机、审计
→ 客户端刷新投影
```

### 5.2 N1-A：统一 runtime error contract

**问题**：当前页面多有自己的 `loading/error/ready/unavailable`，对 401/403/404/409/503 的产品语义不完全一致。

**实施内容**：

1. 在 `apps/desktop/src/enterprise-client/` 增加共享错误分类和 response contract 类型；优先放入 runtime 附近的纯模块，不建新的后端网关。
2. 保留 HTTP 原始状态的最小安全信息；不得把 Server 错误中的敏感 detail 直接展示。
3. 定义统一映射：

   | 状态 | 客户端动作 |
   | --- | --- |
   | 401 | 释放 opaque session，提示重新连接 |
   | 403 | 显示“当前身份无授权”，不猜权限原因 |
   | 404 | 作为当前范围内不可见/不存在处理，不泄露资源枚举信息 |
   | 409 | 显示状态冲突，自动刷新相应 authority projection |
   | 503 | authority 不可用，禁止本地成功降级 |
   | 网络失败 | 显示连接故障并允许安全重试 |

4. 将现有页面逐步迁到统一错误语义；每一页保持自身业务文案，但不自行重新定义安全含义。

**验收**：每种状态都有 renderer test；401 必须 disconnect；409 后必须重新 GET；503 不可显示旧成功状态。

### 5.3 N1-B：连接生命周期与 session hygiene

**实施内容**：

1. 审计 `connectEnterpriseClient()`、`releaseRuntime()`、窗口卸载和 retry 的路径。
2. 保证同一 renderer 生命周期不会泄漏旧 session，也不会在失败时保留旧 tenant/role/feature snapshot。
3. 连接期间禁止页面发起缺少 runtime 的写操作；连接恢复后由 server 的最新 `whoami` 重新决定可见状态。
4. 为 Electron main/bridge 增加测试：renderer 永远无法获得 token、服务地址或任意 URL 请求权限。

**验收**：connect 失败、请求中断、401、窗口关闭、重复 retry 均可重复执行且无悬挂 session。

### 5.4 N1-C：能力可见性与导航语义

**实施内容**：

1. 以 `/api/whoami.product_capabilities` 为唯一能力展示来源。
2. 在导航与页面顶部统一表达：

   ```text
   LIVE + enabled  → 可正常使用
   LIVE + disabled → 当前租户/角色未启用
   DEV/CONTRACT    → 尚未正式上线
   authority error → 当前无法验证，禁止写入
   ```

3. 这仅是展示层；不能用 capability badge 取代每个 server API 的权限校验。
4. 明确保留未上线入口的解释，但不展示假数据、不生成本地任务。

**验收**：不同 whoami fixture 下，导航和写按钮状态正确；服务端拒绝仍由最终 API test 覆盖。

### 5.5 N1-D：跨仓 contract regression

**实施内容**：

1. 为上述 API 建立受控 fixture / fake authority，覆盖成功、401、403、404、409、503。
2. Mercury 保持 renderer/Electron 测试；Hermes_AI 仅在发现已有 endpoint response 或错误分类不一致时，提交最小的 Server contract fix。
3. 不接入真实腾讯云、真实企业微信、真实 secret；不对生产数据执行测试。
4. 可选地在本机启动受控服务，完成 Desktop → bridge → API 的 smoke E2E。

**验收**：PR #37 中增加可重复运行的测试；Server 有变更时必须单独 PR、单独 CI，不与 UI 视觉修改混合。

---

## 6. N1 预期文件级拆分

文件名是预期落点；接手人先做 exact seam census 后再创建。若已有合适基础设施，优先扩展而不是新增。

| PR / 子阶段 | 可能修改或新增文件 | 输入 / 输出 | 验收 |
| --- | --- | --- |
| N1-A runtime contract | `apps/desktop/src/enterprise-client/runtime.ts`；新增相邻纯类型/错误模块；对应 `*.test.ts` / `*.test.tsx` | secure bridge response → typed product error | 401/403/404/409/503 映射、无敏感信息泄露 |
| N1-B session hygiene | `enterprise-client/app.tsx`；Electron bridge 测试所在文件 | connection/retry/unmount → clean session lifecycle | 重复 retry、window dispose、failed connect 均无旧身份残留 |
| N1-C capability view | `app.tsx`、必要页面组件、`enterprise-client.css`、页面测试 | whoami snapshot → navigation/page presentation | LIVE/DEV/CONTRACT/unavailable 的可见性一致 |
| N1-D e2e | `apps/desktop/e2e/**` 或既有 desktop test fixture（先探查） | fake authority → Electron secure bridge → renderer | 不含真实 token/URL/渠道凭据；CI 可复现 |
| Server contract fix（仅必要时） | `Hermes_AI/hermes_devices/webserver.py`、既有 test 文件 | existing endpoint contract correction | 单独 Server PR、pytest + dataplane-pg（涉及 RLS 时） |

### 6.1 N1 的提交边界

每一个子阶段完成后都必须：

```text
format / lint / typecheck / targeted tests
→ git diff --check
→ 仅 stage 本子阶段文件
→ conventional commit
→ git push origin <branch>
→ 记录 commit SHA 与验证结果
```

建议提交顺序：

```text
1. test(desktop): characterize enterprise runtime failures
2. feat(enterprise-client): normalize authority error states
3. feat(enterprise-client): expose capability availability
4. test(desktop): exercise enterprise bridge lifecycle
```

不允许把 Server、Desktop、设计资源、依赖锁文件和无关用户改动塞入同一个提交。

---

## 7. N1 之后的研发路线

| 阶段 | 前置条件 | 交付目标 | 明确禁止 |
| --- | --- | --- | --- |
| N2：预生产可用性 | PR #135 aggregate review、合并与部署授权 | 受控预生产的 health/whoami/read-only smoke | 以 CI 成功冒充生产已上线 |
| N3：真实跨仓 E2E | N2 稳定、测试 tenant/identity 已准备 | Desktop ↔ Hermes_AI 的鉴权、RLS、任务、提醒、审计闭环 | 真实客户数据/渠道 secret |
| N4：业务闭环扩展 | 对应 Server authority/policy 已批准 | Follow-up 的 confirm/update/complete、reminder receipt 证据 | 客户端本地状态机；未经授权的 Follow-up 写入 |
| N5：知识治理闭环 | candidate/review/conflict/publish API 经过验收 | Candidate review、冲突比对、版本、Gap resolve | 自动发布、自动训练、直接写 KB |
| N6：WeCom Phase-1 | Adapter、密钥托管、callback、E2E、部署授权 | 薄渠道适配器、private delivery、receipt 验证 | 将 webhook 宣称为双向会话；Feishu 抢跑 |
| Phase-2：Feishu | WeCom Phase-1 完成且单独授权 | 复用 Channel Adapter contract 的 Feishu adapter | 复制第二套业务/身份/账本 |

---

## 8. 总纲能力与当前实际的对齐

### 可直接复用

- Trusted channel binding / identity chain；
- inbound/outbound message ledger 与 delivery attempts；
- BizTask、claim/resolve、Reminder、outbox/delivery runtime；
- Follow-up、审计、RLS read models；
- Knowledge Gap 与 candidate/review 方向的服务端基础；
- Independent Desktop secure bridge 与 Enterprise UI shell。

### 已有基础但必须经 Gate 接线

- `ai_assistant` / secure knowledge search；
- 生产 Follow-up command policy；
- tenant capability policy 的 PostgreSQL mode 和 CAS 写入；
- WeCom production credentials、callback、receipt 和预生产/生产运行证据；
- candidate conflict/publish 的完整治理入口。

### 仅设计或必须延后

- Feishu Phase-2；
- 群上下文的更多 productization；
- 自动知识发布、自动微调；
- 任意客户端直连 PostgreSQL/RAG；
- 任意将聊天文本视为可信身份/系统指令的实现。

---

## 9. 接手前必跑清单

### 9.1 读取顺序

1. 本文件；
2. `D:\HI-RAG-1.5\Hermes_AI_Claude_Code_Enterprise_AI_Assistant_V3.md`；
3. `Hermes_AI/docs/master-roadmap-v3.md`（优先于 `dev-plan.md` 的旧阶段信息）；
4. `Hermes_AI/docs/dev-log.md` 顶部；
5. `Hermes_AI/docs/handoff-next-session.md` 顶部；
6. `apps/desktop/AGENTS.md` 与仓库根 `AGENTS.md`；
7. 本文第 4 节列出的当前页面、runtime 与测试。

### 9.2 GitHub / 工作树核对

```powershell
git -C D:\GitHub\同步\worktrees\independent-client-shell status --short
git -C D:\GitHub\同步\worktrees\independent-client-shell log --oneline -12
gh pr view 37 --repo bri12afdsarker96-lgtm/hermes-agent-mercury

git -C D:\GitHub\同步\Hermes_AI\Hermes_AI status --porcelain -z
git -C D:\GitHub\同步\Hermes_AI\Hermes_AI log --oneline -12
gh pr view 135 --repo bri12afdsarker96-lgtm/Hermes_AI
```

不要用历史 Markdown 中的 SHA/PR 状态覆盖 GitHub 的实时状态。

### 9.3 Mercury 验证命令

在 `D:\GitHub\同步\worktrees\independent-client-shell\apps\desktop`：

```powershell
$tsc = '.\node_modules\.bin\tsc.cmd'
$vitest = '.\node_modules\.bin\vitest.cmd'
$eslint = 'D:\GitHub\同步\hermes-agent-mercury\node_modules\.bin\eslint.cmd'

& $tsc -p . --noEmit
& $tsc -p tsconfig.electron.json --noEmit
& $tsc -p tsconfig.e2e.json --noEmit
& $eslint src/enterprise-client/ electron/

$enterpriseTests = Get-ChildItem -LiteralPath 'src/enterprise-client' -Filter '*.test.tsx' -File |
  ForEach-Object { $_.FullName }
& $vitest run @enterpriseTests
```

注意：开发环境曾有 root `node_modules` 损坏问题，当前 `apps/desktop/node_modules` 可用；若工具依赖出现异常，先诊断安装/链接环境，不能修改 lockfile 或源代码来掩盖环境问题。

---

## 10. 安全、数据与发布红线

1. token、Server URL、CorpSecret、AppSecret、callback key、数据库 DSN 不进 renderer、Git、普通日志、audit payload 或 prompt；
2. `tenant_id`、`principal_id`、role、owner、scope、device 等只来自服务端可信上下文；正文/LLM 不能决定它们；
3. 群聊内容永远是 `UNTRUSTED CONTENT`，不能改写 system policy、权限或 RAG ACL；
4. 无 receipt 不能显示 delivery 已成功；网络 timeout 不能自动标记成功；
5. 跨 tenant、撤销 principal、撤销 binding、authority unavailable 必须 fail closed；
6. 不新增核心 MCP 工具；当前 Hermes_AI 的 MCP 约束为 `20/20`；
7. 不执行生产部署、schema cutover、真实渠道消息或真实凭据验证，除非获得明确授权；
8. 不把 PR 设为 Ready、不合并他人 PR、不 reset/clean 用户工作区，除非用户明确授权。

---

## 11. 需要产品/总控明确裁决的事项

以下任一项未明确前，接手人只能做契约、测试或只读界面工作：

1. PR #135 的 aggregate review、合并与预生产部署授权；
2. Follow-up production authorization / schedule / timezone policy 的具体 authority；
3. Capability Policy 的 PostgreSQL production mode 启用与管理员写入口；
4. WeCom Phase-1 的真实密钥托管、测试 tenant、callback 域名、receipt 验收；
5. Feishu 是否从 Phase-2 提前，以及官方 API 复核证据；
6. Group Conversation 的 retention、管理员授权范围与可见性；
7. Knowledge Learning 的自动化等级、风险分类与发布权限；
8. 预生产/生产环境的测试数据、审计留存和回滚策略。

---

## 12. 接手完成标准

接手同事在开始编码前应能回答并验证：

- 当前写在哪个仓库、哪个分支、对应哪个 PR；
- 哪些 UI 操作已经连接真实 Server authority，哪些只是只读或未上线；
- 每个请求的 tenant/principal/permission 最终由谁裁决；
- N1 不会新增任何业务状态机或渠道协议；
- 本地已有的用户改动与 Server 未跟踪内容没有被污染；
- 每一个阶段如何验证、提交、推送和回报 commit SHA。

满足后，从 **N1-A runtime error contract 的 RED/characterization tests** 开始施工；完成一个子阶段即独立提交并推送，不跨越第 7 节的 Gate。
