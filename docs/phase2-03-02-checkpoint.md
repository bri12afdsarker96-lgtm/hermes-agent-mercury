# P2-03-02 暂停检查点

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
