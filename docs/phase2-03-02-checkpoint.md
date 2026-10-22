# P2-03-02 暂停检查点

## 2026-10-22 接线进度检查点（当前，提交后暂停）

按用户“将进度提交到 GitHub”及收尾暂停指令，保存当前未完成实施。状态为 **PAUSED_BY_USER / PARTIAL_CHECKPOINT**；P2-03-02R2 **NOT_COMPLETE**，Qualification/Product Gates **NOT_PASSED**。本检查点用于恢复开发，不是可发布功能；不继续开发、登录、真实推理或 03-03。

### 相对前次提交 `ccd84022f` 的进度

- Owned 登录接线：在既有 web OAuth session、PKCE、loopback listener 和 auth store 上接入 SIWC start/poll/cancel/status/logout；固定私有存储根，校验损坏记录、scope、registration 和 generation，保留现有 Spotify 回调错误码。
- 摘要后端接线：`runtime_provider.py` 只解析明确选择的 owned 记录；新增 `enterprise_text.py` 和窄 gateway handlers，复用既有 SessionDB、HandlerRegistry、线程池和 SDK 消费者。物理调用前在事务中提交 UNKNOWN，重复 request 查询原事实，原始草稿只在内存缓冲，停止只表示本地观察停止。
- 通用入口隔离：profile 扫描/导入、canonical session resume、会话导入和 whole-backup restore 增加 reserved namespace 检查。相关必要依赖经两份独立预审登记；完整边界回归与实现复核尚未完成。
- 桌面接线：新增 main 薄 adapter 与独立 public types，复用现有 EnterpriseSession 和 JsonRpcGatewayClient；接入 preload、固定本机连接、S prepare/revalidate/accept、账号 generation/TTL 检查。UI 增加用户自行连接、复制当次官方链接、取消、退出、停止观察和查询原请求，摘要 UNKNOWN 可恢复，固定 gpt-6-luna / medium。

### 必须优先处理的未完成边界

**主进程授权边界尚未闭合。** 独立 Source 预审确认，renderer 可取得普通本机 gateway token；新增 text RPC 与 owned SIWC HTTP 当前仍接受调用者自报 owner。普通 token 与 owner 格式不能证明请求来自 main，因此不能宣称所有登录或摘要请求均经过 main 持有的 fresh S 校权。

待恢复时先完成该问题的第二份独立预审与最小修订：沿已有 local spawn/HTTP/RPC 接缝传递 main 私有证明，禁止进入 renderer descriptor、URL、日志或可继承子进程环境，缺失/错误时失败关闭。不能仅新增一个长期留在环境中的 secret；也不能把此修订宣称为同用户任意本机代码执行的隔离。完整 namespace 实现审查、UI 操作集成、当前 owned 登录与一次全新真实请求也仍待完成。

### 本次收尾验证

当前源码复测 **75 passed**：auth 27、owned web flow 3、既有 Spotify 3、strict Responses 27、既有消费者 2、SessionDB/gateway 13；桌面端 **45 passed**：main adapter 13、runtime 24、assistant session 8。Electron、renderer、e2e 三组 TypeScript 检查均 exit 0。测试为本地 fixture、真实临时 DB/loopback/DPAPI 与 MockTransport；不代表真实 OAuth、模型访问、完整 UI 或企业端到端通过。保留两条依赖弃用警告与既有失败证据。

本次 JUnit：`.cache/audits/p2-03-02-wiring-20261022/checkpoint-python.xml` 与 `checkpoint-desktop.xml`。S context 代码保持前次 `d4d6e7b`，其 12 项 HTTP 测试是前次证据，本轮未重跑。原 UNKNOWN、旧 OAuth URL 均未重放，没有新登录、模型调用、部署或在线更新发布。

仅保存当前源码、测试和正式进度文档；审计原件、临时依赖、本地学习记录、日志、发布包和无关 dirty 内容留在本地。推送检查点后暂停，等待用户指令。

## 2026-10-22 前次基础检查点（历史）

用户要求将进度提交到 GitHub，并在阶段收尾后暂停开发。当前为 **PAUSED_BY_USER / PARTIAL_CHECKPOINT**；P2-03-02R **NOT_COMPLETE**，Qualification/Product Gates **NOT_PASSED**。下方 2026-10-05 记录保持原时点含义，本节覆盖当前实施状态，不覆盖旧证据。

### 本轮保存范围

- M：`hermes_cli/auth.py` 在现有锁、原子存储、PKCE 和 loopback 生命周期上增加显式 SIWC 授权基础；限定 owned profile，验证签名/issuer/audience/nonce/subject/scope，Windows 使用 CurrentUser DPAPI，轮换以 generation/revision 防迟到覆盖，未知刷新不重放，退出区分本地清除和远端撤销确认。
- M：`agent/codex_runtime.py` 在既有事件消费者中增加可选严格策略及单次 SDK 入口，固定 public Responses、gpt-6-luna/medium、空工具、store=false、stream=true、零重试；要求关联真实终态，断流/取消保持未知，拒绝工具输出，不进入 AIAgent/Relay。修订包含 SDK 私有正文日志过滤和有限错误转换。
- M：新增 `tests/hermes_cli/test_auth_siwc.py`、`tests/agent/test_owned_text_responses.py`。本轮未修改 web OAuth、runtime resolver、gateway、Electron 或 renderer 接线；基础函数尚未通过产品入口启用。
- S：`hermes_devices/enterprise/tenant_assistant.py` 抽取既有纯文本 messages 准备，新增有界摘要准备和结果出口；`hermes_devices/webserver.py` 增加 `/api/tenant-ai-assist/context` 的 status/prepare/revalidate/accept，每次使用当前企业 HTTP 身份校权和版本化关联 hash，不读取租户模型凭据、不新增会话表、不执行模型或业务写入；`tests/test_tenants_e2e.py` 增加临时真实 HTTP 验证。

限定实施共识为 **READY_FOR_SCOPED_IMPLEMENTATION**，仅支持当前接缝施工，不是 runtime 或 Gate 通过。上游固定 pin `dce4abe9172d6478bed73525efdd49e6d10bed03` 和 T4 D1–D9 保持；D3 收窄为明确 SIWC grant 适配，D5 复用现有消费者，不新建通用 auth/session/RPC/SSE/executor。

### 收尾验证与限制

本次当前源码复测：认证 **27 passed**、严格文本流 **27 passed**、既有 Spotify **3 passed**、既有流消费者 **2 passed**；S context 临时 HTTP **12 passed**，均 exit 0，JUnit 均 0 failure/error/skip。按测试文件分列，不能替代全量回归、实际 OAuth、真实模型访问或完整企业调用链。DPAPI、签名 JWT、loopback 为本地真实机制验证，令牌/模型网络为合成 fixture 或 MockTransport。

独立安全审查原状态 **CHANGES_REQUIRED**：六项原反例分别涉及 SDK DEBUG 正文、缺 ID 终态、提交前取消、原始 vendor 异常、退出后刷新和解密后坏结构。当前修订已处理这些分支；原反例最后复跑为 **5 passed / 1 failed**，失败项因提交前取消现在直接抛出有限 `TEXT_OBSERVATION_STOPPED`，旧用例未捕获该异常。原失败和测试原件保留；尚未完成该用例合同调整及完整修订后的独立复核，不能宣称六项审查均通过。并发日志隔离、损坏 store 各入口与既有回调错误码兼容仍需恢复后检查。

本地证据在 `.cache/audits/p2-03-02-resume-20261022/`：`reuse-consensus.json`、`wire-contract.json`、`checkpoint-auth-tests.xml`、`checkpoint-stream-tests.xml`、`checkpoint-spotify-regression.xml`、`checkpoint-consumer-regression.xml`、`checkpoint-server-tests.xml` 及原安全反例结果。审计、临时依赖、学习记录、日志、发布包及无关工作区改动不进入本次提交。

### 恢复顺序

1. 对当前 auth/SSE 修订完成安全反例和兼容性复核，不把本次检查点当成验收批准。
2. 在既有 OAuth session/HandlerRegistry/SessionDB/可信本机连接上完成 owned 登录入口、严格 resolver、物理请求前持久化 UNKNOWN 单次保护、generic session 操作隔离与 sender/main-frame/account generation fencing。
3. 接入 main/preload/UI；复用当前 S prepare/revalidate/accept，结果先缓冲再经当前权限和 C4 出口，支持复制官方登录链接、取消 pending、有限状态和停止观察。renderer 不提供命令、路径、profile 或凭据。
4. 先完成集成验证，再通过明确选定的 owned 登录入口验证新账号与一次全新请求；旧 02A UNKNOWN 和旧 OAuth URL 不重放。仍缺登录时只请求实际必要的当前登录动作。

本轮没有新增真实登录、真实模型调用、部署或在线更新发布。提交及推送仅保存已有阶段进度，不改变后续开发暂停状态。

## 2026-10-05 历史检查点

2026-10-05，用户明确要求立即收尾、将进度提交 Git 并暂停。状态：**PAUSED_BY_USER / PARTIAL_CHECKPOINT**。P2-03-02 **NOT_COMPLETE**；Qualification/Product Gates **NOT_PASSED**。不继续 03-03。

## 已保存的进度

- P2-03-01 服务端后端选择、当前身份/权限拒绝，以及客户端稳定选择、UNKNOWN 保留和旧服务兼容；此前已获监督接受。
- 用户自行在本机连接自己的模型账号。当前仍使用 `CODEX_LOCAL_RUNTIME_REQUIRED`，不推断用户未登录，不以企业统一模型接入资格作为本机前置条件。
- 既有 `CodexAppServerSession` 的可选严格策略：要求事件关联同一 thread/turn，分离发送、ACK、真实终态和 interrupt ACK；观察器失败关闭，不把无终态文字当成功；拒绝 server requests 是协议后备策略，不能充当原生能力隔离证明。默认调用保持兼容；新严格策略尚未接入企业 UI。

## 直接验证与证据边界

本轮最后一次协议测试工具回执 `fbbe05`：**53 passed，exit 0**，JUnit `session-tests-v2.xml`。这些是 FakeClient 协议测试，未证明真实模型访问、文件隔离或企业完整调用链。此前后端选择实施的最终去重结果为 S 42 passed，M 75 passed/3 既有 skipped，三组 TypeScript 检查通过；用户接入文案修正另有 S 23/M 39 测试证据。保留各时点，不累加为本轮新测试数量。

本机 CLI 0.159.2 的配置探测只调用 initialize/config-read：15 个 feature=false 与 web_search=disabled 获确认；无本轮登录或 turn。最初不受支持的配置键导致初始化失败，移除后探测成功；失败记录保留。该 ACK 不能证明无原生读取/命令/网络效果，因此没有启用该路径。

no-tools Responses 候选已有 Source、Intent、Enterprise Fit、Security 四份独立增量预审；最终 consensus 正在核对时按用户停止指令中断，**没有新的复用共识或实施批准结论**。沿用旧 T4 D1–D9，不扩大其含义。

当前官方文档将新的 SIWC 注册/主机/OAuth 流绑定到公开 Responses endpoint，不能将旧 CLI grant 重新标记为该新 flow；相关认证与 endpoint 生命周期尚未完成资格确认。[官方模型与推理文档](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)。

## 待恢复事项

1. 明确本机受支持的 owned OAuth grant/endpoint、刷新与退出合同，禁止 default/CLI/global/pool/env 静默回退。
2. 完成必要的 D3/D5 增量共识，冻结精确 source/IPC/context/关联/过期字段后实现；不另造通用 auth/session/RPC/SSE/executor。
3. 实施 S 纯文本 context 与新请求校权、M 可信本机连接和 sender/session fencing、一次物理请求与严格终态/C4出口，再做实际与模拟分列验收。S context API 和 M 实际摘要桥目前均未创建。
4. 旧 02A UNKNOWN 请求维持原状态，禁止重放；未完成事项不能被本检查点提交当作成功。

本轮没有新模型调用、token 复制、部署、发布或 Git push。保存当前阶段代码/测试/正式文档；本地学习记录、审计原件、日志、发布包和无关 dirty 内容不加入提交。

本地证据目录：`D:/GitHub/同步/hermes-agent-mercury/.cache/audits/p2-03-02-local-runtime-20261005`。内含 before/wire、三次配置探测、两次测试 XML、四角色原始报告与收尾记录，旧包不回写。
