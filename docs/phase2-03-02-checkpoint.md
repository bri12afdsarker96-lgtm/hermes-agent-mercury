# P2-03-02 阶段检查点

## 2026-10-23 P2-03-02R3 阅读空间有限改善与原创建超时（最新）

当前唯一具体项仍为 **P2-03-02R3 / SUMMARY_READING_SPACE_CLOSURE**，状态 **ACTIVE / NOT_COMPLETE / LIMITED_LAYOUT_GEOMETRY_CREATE_TIMEOUT_BLOCKED**。基线 M `3494a4acb` / S `447ef8cd`。两个真实 CSS 候选分别使用新鲜 HOME/userData/S DB 和新请求，旧失败、UNKNOWN 与原请求保留，不重放身份或请求。本阶段实际原 UI 提交尝试2次、SDK合计1次（第一候选1、第二候选0）；合同cap2不是实际2。

M 只增加五个布局语义 class，并在宽屏、分栏、文本摘要范围调整配置卡、工具栏与 transcript/messages/composer 的留白。所有文字、账号/连接/后端、授权与stop/query动作及原handler/disabled/UNKNOWN条件保留，没有隐藏或折叠恢复控件，字号始终未改，后续五组spacing未再改变第一候选的textarea/按钮尺寸或按钮padding；没有修改窗口1220×800 DIP/zoom0.9、消息硬最小高度、overflow或原滚动。第二候选仅在第一候选实际失败后进一步减少五组空白，当前page SHA `4a3347e4…`、CSS `60a48ab3…`。两次renderer都由原Vite配置从对应真实源码构建，未修改编译后的JS。main复用已审诊断 `7c9f850f…` 和外置有限Node观测器，字节不同于旧产品main `ccb95380…`；preload/安全边界/10秒创建超时/retries0不变，本阅读夹具无Python创建/C-profile，不作性能基准。

第一候选 `summary-reading-closure-1` 实际SDK1、发送前持久UNKNOWN1，正常完成S prepare/revalidate/accept与backend durable completed。tenant摘要消息区232px、codex提交前194px、持有回复时130px，**完成后162px，未达200px门槛**。原messages真实wheel的首段固定命令失败 `INPUT_READING_MARKER_NOT_REACHED`；随后仅读首短段交集14.187px、scrollTop34.444。首段在scrollTop0时底部约位于消息区内210.260px，162px下不能同时满足atStart与首段完整可见，不能据此称首段在任意滚动位置都不可读。中段15次、尾段14次原wheel后各短段完整可见/命中、尾部边界成立，只是部分阅读证据。首失败未重试，原账号/注销/登录页与正常退出另有实际回执。

第二候选 `summary-reading-closure-2` 实际tenant摘要298px、codex提交前 **260px**、create在途及失败态 **204px**，相关控件和固定状态区有完整裁剪交集/命中；这不是completed阅读通过。唯一新请求在Node原 `session.create` 进入后 **10002.9729ms** 精确触发源码固定10秒timer reject，timeout布尔为true、connectionState为open；相同socket/RPC/conversation的成功响应帧在reject后 **2105.0218ms** 才到达，原Promise未resolve。main unavailable / `LOCAL_TEXT_UNAVAILABLE`；S只有prepare200=1，无revalidate/accept；SDK0、发送前UNKNOWN计数0，无held/release，`response_entries`尚未产生，回执记null/不可用，不伪填0。该分型不证明Python延迟原因、SQLite锁或历史第三次create原因，也不代表故障已修复。

第二候选仅实际UI1至8与quit40。UI8为quit前仅读：answerCount0、三个marker均未渲染、toolbar unavailable完整可见，原query可见但未点击；没有completed答复、首/中/尾wheel、stop、account/logout/login或旧SID查询动作。root先等待SDK held未出现，没有因该等待发UI8或release；后来实际UI8已保存，但同次多文件采集报 `OTHER`，具体原因未捕获，未产生当时计划的snapshot或UI9至11，也未发新业务请求。退出后稳定重采final，明确UI8在quit前、其他最终文件在quit后，不推断产品或解析错误。controller/M/S各exit0；第二候选13个、第一候选11个已录PID/name/CreationDate及controller有限复核无匹配，不扩大为全历史进程或每个后代退出码为0。

两份最终本地回执以不可变 `executed-source` 保存3个已审源码字节，避免未来合法源码变化破坏历史追溯：

- `.cache/audits/p2-03-02-main-authority-20261022/.agent_tmp/summary-reading-closure-1/native-reading-results-2.json`，SHA256 `859e07682a4d898c31b53b1fa52a74d73313ead7c962beee8462eef6097ec9fc`，58绑定；保留原时点回执 `c87c0251…`，未修订失败事实。
- `.cache/audits/p2-03-02-main-authority-20261022/.agent_tmp/summary-reading-closure-2/native-reading-results-1.json`，SHA256 `9947b835bac646bd593e74a3592dca9a75f2ee8c624b7578a219c17e5b93e111`，47绑定。

Source与Security已各自实际核验两份最终回执全部绑定hash/字节数一致，仅接受上述有限结论。组件23/23、renderer类型exit0来自第一class候选Builder原工具回执；第二次纯CSS留白未重跑，不能证明原生几何。新两次真实Vite构建和对应源码已绑定。本轮尚未完成200px完成态与首/中/尾联合阅读验收，不提高timer、重试、替代请求或缩短/换答复凑通过。下一步仍严格在本03-02诊断原create返回断点，不回写历史根因。此前 `c227f148…` scoped stop/query接受保持独立，不重旧包。无真实OAuth/模型网络、PG/RLS、全owner矩阵、下一Gate、部署或发布；P2-03-02/Gates与二期未完成，提交/推送不自动暂停研发。

## 2026-10-23 P2-03-02R3 创建返回与原页面停止/查询闭合（最新）

当前唯一具体项为 **P2-03-02R3 / CREATE_RETURN_AND_NATIVE_STOP_CLOSURE**，本轮结果 **SCOPED_NATIVE_STOP_QUERY_VALIDATED_HISTORICAL_CREATE_PENDING**。基于 M `b06fb5b10` / S `14aeec9e`，没有修改生产源码、正式测试、请求超时或重试策略。新鲜隔离 lane `native-stop-closure-1` 复用 attempt-7 renderer/preload；诊断 main 从固定原源码真实构建，仅一个精确 import alias 加入审计观测，SHA256 `7c9f850f…`，不是旧产品 main `ccb95380…` 的相同字节。原 class、Promise、响应与 coroutine 对象及调用参数保持，单独有限观测开销并非零。

本次同租户换员工后唯一 session.create 的创建返回接缝已闭合：Node 原请求进入时 connectionState 为 open、WS readyState 为1；相同 RPC/conversation/runtime-session hash 串联 Python dispatch、原 handler、enterprise_text.create、SessionDB 初始化/会话写入、metadata、close、原响应与 write_async 调用，随后 Node 实收响应且原 Promise resolve。两个观测器均 observerFailure/overflow 为0。Node 同进程 create 区间为 **9.906217秒**；Python 自身 `_init_schema.enter` 至 return 包围区间为 **9.813秒**。这包含观测、调度及该函数内部工作，不是纯 SQL 耗时或数据库锁原因证明；两个进程的单调时钟不能相减。本次没有 timer/WS/SQLite 异常，旧第三例缺少原始分型证据，原因仍未知；本次未复现不等于旧问题已修复。

实际流程先用原页面建立 primary 本机连接，snapshot 确认业务 submit/SDK 为0，再通过原企业退出登录及单独显式测试准备建立 sameTenantOther 新 session；该准备不是 UI 密码登录或自动恢复。原页面唯一提交到达 revalidate、SDK MockTransport1，发送前持久 UNKNOWN。原件记录：

- 原 Chromium 输入15点击“停止观察”，真实 backend stop 返回 `local_observation_stopped:true`，main 返回 unknown / `LOCAL_TEXT_OBSERVATION_STOPPED`；保存此时仍没有 released 事件的快照后，才释放持有的合成响应，保持原45秒预算。
- 原 submit 随后返回 UNKNOWN；原页面输入17点击“查询原请求”，SID、conversation、request 三个 hash 与唯一 submit 一致，原 requestStatus 返回 UNKNOWN / `LOCAL_TEXT_RESULT_UNKNOWN`。SDK 和原 SDK response entry 均仍1，S accept 为0、tenant-model 为0，没有 backend accept 事件，原页 answerCount0、合成 marker 为false，没有重发或创建替代请求。
- stop 即刻读取的 durable `interrupt_requested` 为false，原 submit finally 后为true、started为true、状态仍 UNKNOWN；不能把停止按钮回包说成该字段已经即时落库。该验证证明停止本地观察及本次迟到结果不发布，不保证远端模型取消。原显式查询在产品设计上可以接纳已 received 的 draft，本次是先 stop、后释放首个 SSE，因此查询仍 UNKNOWN。
- 原页面输入19完成企业注销，20使用刚才有效 SID 的只读程序化 IPC 拒绝 `LOCAL_TEXT_OWNER_CHANGED`，21观察到原登录页。20只作为注销失效旁证，不冒充 UI 查询动作。

正常收尾 controller OS0、M/S 各 exit0；14个已记录 owned PID/CreationDate 的退出回执无剩余，不扩大为全部历史进程或未记录后代证明。本轮未重复旧14项 IPC、13项回归或旧合成包，没有真实 OAuth/模型网络、PG/RLS、OS 鼠标/截图资格，也没有修复仍部分可见的答案阅读区域。

最终本轮结果回执：既有审计 `p2-03-02-main-authority-20261022/.agent_tmp/native-stop-closure-1/native-stop-results-1.json`，SHA256 `c227f14883dc4728c630fe1255bd0d91f10294f903e688d358cf3007d5baeb92`。Source 已实际核验51个文件绑定的 hash/字节数全部一致，并独立读取创建 trace、停止前后快照、原 UI/IPC 关联、只读 DB 与14个已录身份的退出证据；只接受本次新鲜创建返回及 stop/query 路径，历史第三例与整体 Gate 保持未闭合。

attempt-4/5/6 的失败、attempt-7 idle 模式变化与第三次 create 的未知原因、旧 reload UNKNOWN 均原样保留。当前只接受上述新鲜合成 stop/query 路径；P2-03-02、Qualification/Product Gates 与二期未完成，不进入03-03，不部署或发布。进度提交/推送不自动暂停持续研发。

## 2026-10-23 P2-03-02R3 原页面输入与生命周期合成验证（最新）

当前唯一项仍为 **P2-03-02R3 / PRIMARY_UI_AND_LIFECYCLE_SYNTHETIC_CLOSURE**，结果 **PARTIAL_SYNTHETIC_UI_VALIDATED_STOP_PENDING**。本轮只修复三个 M 文件：`assistant-page.tsx` 在现有分栏布局加入本机能力可用时的“文本摘要”入口，沿用原模式切换与冻结/在途保护；`assistant-page.test.tsx` 补实际布局及原请求不重发回归；`enterprise-client.css` 仅覆盖宽屏、非客户回复分栏的固定高度与 540px 最小高度冲突，使输入及提交区域可达。没有改变模型、企业权限、main/preload 或请求超时。S 运行代码未改。

组件文件 23/23 通过及 renderer 类型检查 exit0 来自 Builder 的原实际工具执行回执，不是 root 或 Source 重新独立运行的结果；本轮 CSS 以实际原生布局检查验证，没有新增镜像 CSS 测试或重复运行组件/类型检查。真实 Vite 构建从已审源码生成 renderer，未补丁修改编译后的 JavaScript；main/preload 继续使用原冻结产品字节。

attempt-4、5、6 的首个失败与退出证据保留：4 的真实导航探针成功，但原布局没有可见粘贴摘要入口；5 的后端选择驱动失败没有留下足以确定原因的子步骤，不能追认缩放或按键为已证唯一原因；6 已用实际 zoom 与逐步焦点/选择值证明摘要及 codex 选择，但输入/提交被裁切，滚动未使其可达，且当时未直接采集祖先计算样式。以上三轮均无 SDK 发送。测试驱动后续按真实 zoom 转换坐标，保持默认窗口及缩放，没有强显隐藏控件或用业务 IPC 替代页面输入。

attempt-7 使用原页面 Chromium 输入事件，观察到默认 contentSize 1220×800 DIP、zoom0.9 下摘要/后端选择、输入及提交区域可命中，布局 min-height 为0。此前一次 idle 期间模式从摘要变回聊天、焦点从后端移至原 AI 导航的现象原因未知；原失败保留，没有据此修改产品或称周期刷新必然重建 session。随后按原页面完成以下有限场景：

- **摘要成功**：原摘要按钮、后端选择框、输入框和提交按钮实际触发 React→preload→main→S。SDK MockTransport 发送1次，发送前 DB 已持久 UNKNOWN；S prepare/revalidate/净化 accept 均完成，backend accept 后持久 completed，main 返回 completed。原页有对应合成 marker、净化 canary 缺失及视口/祖先裁切交集中心命中，但答案仅部分可见，不能称完整展示。DOM `textContent` hash（`d525…`）与 S/main 净化文本 hash（`689cc75e…`）不同，未声称两者字节相同。
- **在途 reload 与新会话隔离**：第二个原 UI 请求发送1次并持久 UNKNOWN 后实际 reload，先观察到隔离登录页，没有自动重发。随后单独执行显式测试准备的第二次 reload，经原 password handler 与 S 正常登录建立 sameTenantOther 新 session；这不是 UI 登录、自动恢复或同 owner 查询成功。旧有效 SID 的只读程序化 IPC 查询拒绝 OWNER_CHANGED。释放原合成响应后，旧请求保留 UNKNOWN，新员工页没有旧 marker；SDK 累计仍2、S accept 累计仍1。此 SID 查询是 IPC 旁证，不冒充页面按钮动作。
- **停止场景未闭合**：sameTenantOther 的第三个原 UI 请求到 S prepare 后，在本机文本 runtime 的 session.create 至 revalidate 区间返回 unavailable/LOCAL_TEXT_UNAVAILABLE。只读 SQLite 回执确认该 owner 的 DB 已有1行 enterprise_text 会话，owner_scope/Luna/medium/generation1 匹配，但 request facts 为空；不能说 create 未执行。没有第三次 SDK 发送、持有响应或原“停止观察”动作，不能记在途 stop/第三请求迟到隔离通过。实际原因尚未知，约10秒的返回区间与现有 trace 不足以细分具体 timer、DB、RPC 错误或 WS 原因；没有放宽超时或重发。随后原账户安全/企业退出登录按钮实际完成注销，旧有效 SID 查询拒绝且原页回到登录页；这是注销失效验证，不是上述在途竞态验证。

实际计数仅为 SDK MockTransport2、发送前 UNKNOWN2、S accept1、tenant model0；primary 两行 DB 请求事实分别为 success completed、reload unknown。没有真实 OAuth、模型网络、企业工具或设备副作用。合成 S 为 strict SQLite / capability-policy-off，不构成 PG/RLS/动态 EffectivePermissions 资格；Chromium 应用输入也不等于 OS 鼠标或截图覆盖。旧14项 IPC admission 的限定接受保留，不扩展为未运行的 owner/connection/account-generation 全矩阵。正常收尾 controller OS0、M/S 各 exit0，13个已记录 PID/CreationDate 无剩余；不扩大为全部未观察历史进程证明。

最终 attempt-7 结果回执为既有审计 `p2-03-02-main-authority-20261022/.agent_tmp/native-ui-synthetic-1/attempt-7/native-results-1.json`，SHA256 `2340e1f6ca4c10f189d429aae823d3ccf663b9ed162257fca29d7bde56ad5ff8`；50个文件绑定及3个当前产品源码绑定已由 Source 实际核验一致，仅支持上述有限结论，不代表三场景全部通过。

用户此前已确认窗口可见；本轮核对原待验入口的旧进程身份已消失，目录保留，不能称其持续存活或把 PID 复用对象当 owned 进程。上次官方公开 JWKS 复测为2026-10-22 11:30 UTC的单次403/Cloudflare HTML，本轮没有新增网络探针，也不推断全部网络、账号或地区原因。停止、完整结果可见性及其余技术闭合仍待完成；P2-03-02、Qualification/Product Gates 与二期均未完成，无下一 Gate、部署或发布。进度提交和推送不自动暂停持续研发。

## 2026-10-22 P2-03-02R3 原生 IPC 有限验证与界面工具缺口（最新）

本轮基于 M `71781278a` / S `26e471b`，产品源码与正式测试未变；仅本地隔离夹具和进度文档更新。标准 real-main、preload、renderer 原字节复用，没有把测试注入写入产品。当前 **PARTIAL_NATIVE_IPC_ADMISSION_VALIDATED / UI_ACCEPTANCE_PENDING**，下方记录保留其历史时点。

第三个 fresh 合成环境通过真实主 frame 事件、原 password handler 和 S 正常密码接口建立企业 session；实际 Python 后台 READY，主窗口前后 status 均为 ready/generation1。此初始化不是密码 UI、原生 OAuth 或真实模型资格证明。

- 实际辅助 sender 2 携带主窗口当前合法 SID，status/connect/cancelLogin/logout/submit/requestStatus/stop 七动作均返回 OWNER_CHANGED；主窗口使用从未有效 SID 的同七动作也均拒绝。共 14 项真实 Electron preload/IPC admission，不是普通 JS 假 event。
- snapshot1 之后、snapshot5 之前的负例观测窗口中，三类 provider HTTP、S login/context、SDK、UNKNOWN 与 tenant-model 计数增量均为 0；snapshot5 在该窗口之外，主窗口仍 ready。不能扩称所有 auth-store 或 OS 副作用为零。
- 实际普通子 frame 的自身 bridge/require 均不可用；没有执行子 frame IPC。无效 SID 也不等于曾有效旧 SID；owner/connection/generation 切换、reload UNKNOWN 查询、stop/迟到发布及 logout 竞态尚未在本 native lane 执行。
- Sky 可读取已登录工作台，但两次点击均报 coordinate input geometry is unavailable，截图超时，Tab 未观察到焦点导航。因此实际摘要 UI 提交、SDK send、accept/C4 结果均未执行，不继承旧 wire 成功。冻结 runtime 的 Chromium 拒绝为 2 次，且末尾一个合法 status enter 没有配对 exit，不能称冻结时整体静止。

前两次夹具启动失败全部保留。一次无凭据 pipe 对照中，EOF 案例出现 ACK_MISSING/EPIPE，NDJSON 案例收到精确 7B ACK；诊断 Electron exit0、最终所列进程消失，但整体超 8 秒预算约 95ms，仍为 shell OS1/verifiedOwnedExit:false，不记整体 PASS。第三轮按有界 NDJSON 协议获得真实解析 ACK，并正常建立上述 session。Source/Security/Integration 的 actual review 仅支持本节有限结论。测试收尾 M/S 均 exit0，11 个已记录 PID/CreationDate 对象无剩余，未自动强杀；不扩大为全部未观察历史后代证明。

有限结果在既有审计 `.agent_tmp/native-ui-synthetic-1/attempt-3/native-results-2.json`，SHA256 `51b0cf6e1e5b9d24a88984d8de6249af5e84357c53e2ab10ec5a489f6d46ea3f`；原 results-1 保留，results-2 纠正 Chromium 数量并补退出记录。夹具仍为 strict SQLite identity / capability-policy-off，不构成动态 PG/RLS/EffectivePermissions 验收。本轮没有产品修复可提交，也没有新增类型检查或正式回归结论。

用户报告网络恢复后，仅复测一次生产 `_siwc_http` 官方 JWKS GET（11:30:14 UTC）：仍403/Cloudflare HTML，不能泛称全部网络未恢复或归因账号/地区。原网络问题已获回复，不重复催问；无真实 OAuth/模型请求。另发现原待验客户端及其 backend 已退出，原因未归因；保留原 HOME/userData 恢复同一无合成 grant 的空登录入口，用户随后确认“现在能看到窗口”，尚未登录。原 S10431 保留。界面、真实 owned 登录/模型及其余技术闭合仍待验；P2-03-02/Gates 未通过，无部署或再次发布，进度推送不自动暂停研发。

## 2026-10-22 P2-03-02R3 C 有界创建诊断（当前）

基于 M `d80be0298` / S `a81e8a5`，本轮未改产品源码、超时、重试或权限 guard。监督已限定接受原 13 项的同条件 A/B 与平台测试修订，不扩大为全项目回归或产品验收。历史创建失败仍未归因；八份旧有限回执没有直接的 10 秒 timer 异常及可靠执行 SHA/argv 绑定，下方旧记录的超时说法已据此修正。

固定新 harness、实际导入源码和 Node/Python argv 后，只执行两次全新 first-submit。实际链路为 Node adapter → WebSocket → Python serve → auth/SessionDB → SDK MockTransport → 临时 S accept 返回 → adapter completed；第二例有两条 WS 连接，但只创建和提交一个请求，不是并发双 create。

| 新例 | 原 client timeout | Node create Promise resolve | Python create / schema 区间 | 实际终态 |
|---|---|---|---|---|
| 单 WS | 10000 ms | 3720.694 ms | 3719 / 3672 ms | adapter completed |
| 双 WS、一次 create | 10000 ms | 3598.418 ms | 3594 / 3500 ms | adapter completed |

每例均 create started/completed=1、SDK 模拟发送=1、发送前持久 UNKNOWN=1，tenant model/external connection=0，无 client request reject、trace overflow 或 6 秒栈触发。两次 runner 均按固定 first-submit probe-stop 返回 **OS exit 1 / passed:false / INTEGRATION_FIRST_SUBMIT_PROBE_STOPPED**，同时 lastReply=completed；不改写为普通测试 PASS 或 OS0。旧请求未重放。

仅支持 **NOT_REPRODUCED_IN_TWO_FRESH_SYNTHETIC_PROBES / HISTORICAL_CAUSE_UNDETERMINED**。本次时间集中在 schema/init，不能反推历史失败由 DB I/O、冷启动、锁或调度导致。未做 SQL/内核跟踪或无观测 A/B；观测有开销，两端相对时钟不能直接相减，同 tick 不证明零等待，database→init 也可能包含 lazy import。实际 SDK 网络与真实 Electron 操作未覆盖。

本地证据位于既有审计的 `.agent_tmp/integration/`：`c-bounded-manifest-1.json`（SHA256 `97707dff04f328befcac96aaa81b2e2e043a050027ed330c297d1132287d7893`）、`receipt-probe-c-bounded-{single,double}-1.json`、对应 execution start/finish 和 `c-bounded-results-1.json`（SHA256 `2f9916f4670f34873e90cb785255c2b4c509114d7edfa9b9d93035ea6d7d92ef`）。两例后核实所列 owned runner/Python 根进程及直接子进程未见存活，未证明全部历史后代；14 个冻结文件 hash 未变。原 native S/Electron 及既有 HOME 保留，没有新建替代入口。独立 Source/Security 复核仅接受这两例观察：ProbeStop 早于后续完整断言，不新增 C4 内容验证或此前并发/重放验证结论。

网络 lane 唯一新增公共 GET（09:17:13 UTC）仍由实际 `_siwc_http` 访问官方 JWKS，返回 HTTP403/HTML，无公开结构化原因；不据此推断账号、地区或凭据问题。未改代理/TLS/cookies，无真实 OAuth 或模型请求。09:33 UTC 原 S 仍监听 `127.0.0.1:10431`，客户端/backend 进程身份与创建时间一致；这只是入口存活，不是登录或完整 UI 验收。当前 **REAL_ACCEPTANCE_PENDING / NOT_COMPLETE**，不进入下一 Gate、不部署或发布。

## 2026-10-22 P2-03-02R3 同项回归与合成链路复核（当前）

继续已派发的 R3，未进入下一 Gate。M 基于 `af2885378`、S 基于 `32e32df`；本轮产品源码没有修改，仅修订三份既有测试并同步进度。当前 **LOCAL_SYNTHETIC_VALIDATED / REAL_ACCEPTANCE_PENDING**，仍未完成产品验收。

### 原 13 项失败逐项归因

独立使用完整 `f27403243` 与 `af2885378` git archive，在同一 Windows/Python 3.11.9、cp936、依赖顺序及明确记录的重建 argv 下，原 13 项在两侧均 **13 failed / 0 errors / 0 skipped**，失败类型逐条一致；未观察到这 13 项属于本次产品回归。原 legacy-first 的完整 argv 未留存，不能宣称本次精确恢复了原命令。archive 全部成员及产品/测试提取字节已核，CRLF 转换与非产品 contributors 文件名大小写碰撞单独记录，没有以部分文件替换伪装完整旧基线。

| 原用例 | 两侧相同原因 | 最小修订与当前闭合判断 |
|---|---|---|
| test_seeds_placeholder_env_file | Windows stat 0666 不等于 POSIX 0600 | 内容与真实 chmod(0600) 请求通过；POSIX 实际权限另列，Windows DACL 未验 |
| test_clone_config_copies_files | UTF-8 配置被默认 cp936 解码 | 明确 UTF-8 读取；原 cp936 父进程下通过 |
| test_copies_default_env_into_envless_profiles | Windows stat 0666 不等于 POSIX 0600 | setup 后观察真实 chmod 与准确目标、复制内容通过；DACL 未验 |
| test_creates_sh_on_posix | 原测试在 Windows 期待无后缀 shell wrapper | 改为实际平台 wrapper 用例，验证 .bat/参数透传；POSIX 分支保留 |
| test_list_profiles_surfaces_custom_alias | Windows 实际为 qiaobusi.bat | 验证原 alias 关系及平台实际后缀，通过 |
| test_export_default_handles_broken_symlinks | WinError 1314，不能创建文件 symlink | 复用已有真实能力检测 marker；当前跳过，行为未验 |
| test_symlinked_profile_yaml_survives_the_write | WinError 1314，不能创建文件 symlink | 同上；不把目录 junction 证据充作文件 symlink 通过 |
| test_clone_from_named_profile | UTF-8 配置被默认 cp936 解码 | 明确 UTF-8 读取；原 cp936 父进程下通过 |
| test_import_skips_profile_dirs_without_config | Windows valid.bat 被按 valid 查找 | 保留有效/无配置 profile 恢复关系，使用实际平台文件名，通过 |
| test_board_db_copied_wal_safely | 反斜线路径被按正斜线字符串后缀判断 | 精确 Path 源比较；实际复制库行仍验证，通过 |
| test_import_restores_external_to_home_relative_location | Windows stat 0666 不等于 POSIX 0600 | home-relative 恢复、内容及真实目标 chmod 请求通过；DACL 未验 |
| test_quick_snapshot_is_published_with_manifest | CRLF 使源文件为 11 字节，原断言固定 10 | manifest 对实际源字节，且备份字节与源相等，通过 |
| test_make_run_env_real_launchd_path_gains_homebrew | confcutdir 绕过已有 macos_only hook | 正常 conftest 下按原 marker 跳过；原 Windows minimal-PATH 分支通过，macOS 实机未验 |

修订后只运行上述定向集合及三个独立 POSIX 权限子例：**10 passed / 6 skipped / 0 failed / 0 errors**，父 `PYTHONUTF8=0`，加载真实项目 conftest。六跳过为三个 POSIX mode 子例、两个实际 file-symlink 能力不足及一个既有 macOS 专项；没有重跑或借用旧 193 PASS 作为新结果。独立 Source 与 Security 复核未发现该有限 test-only diff 的阻断问题。证据：`legacy-closure-first.xml`、`.agent_tmp/legacy-ab/attribution-and-review.json`。

### 实际本机 wire 与剩余边界

未修改产品 guard、重试次数或超时。独立原五场景通过：正常 S prepare/revalidate→单次 SDK 合成发送→S accept/C4、重复不重发、调用前后撤权拒绝、EOF UNKNOWN 查询不重放。新增五组实际 wire 验证通过：跨 tenant/channel 拒绝；同请求同时两次仅一次 SDK；stop/epoch 切换后迟到结果不发布、S accept 增量为零；真实 Python 冷重启后重新建立签名连接、查询原 UNKNOWN，重启后 SDK 为零且未重提原 submit。原普通 token、完整参数/连接绑定、nonce 与环境隔离证明保持；14 个关键产品文件与既有独立审查 hash 一致。

真实边界为 Node adapter、CLI serve、WebSocket、HTTP、SessionDB、DPAPI 与 SDK 序列化/消费；模型传输仍是 MockTransport，原 S 在 M 进程内线程。冷重启后的状态查询使用 main 私有签名 RPC，不等于真实 Electron 恢复界面已验；旧 proof 的 403 未单独记录 age，不单凭此区分 TTL 与 runtime 拒绝，仍依赖既有固定时间反例。两份 wire 回执分别记录模拟发送 3 次、5 次及各次发送前持久 UNKNOWN，不与重叠单测相加。

历史首次 submit 失败及两次 create 未完成的 UNAVAILABLE 尚未归因。独立复读八份有限旧回执后，未发现直接保存的 10 秒 timer 异常或可靠的 runner/fixture SHA、完整 argv 绑定；10 秒只是生产源码中的候选超时，不能将旧记录写成两次已证超时。原单/双 channel 最小复跑约 3.5 秒成功，不能补证历史原因或说明故障已修复。原 FAIL、探针启动观测副作用与后续 PASS 分开保留；库仅有有限事实、不含正文、draft 或凭据载荷。

标准客户端本地构建通过，仍是未发布的验收候选。独立本机验收包只在构建时将固定 S origin 指向隔离 loopback 服务，并在测试 bootstrap 抑制 OS 协议注册；原产品资产和 main 源码不改，不用于发布。独立 S 的正常 password→strict/operator→context status 已验；该 S 使用 `CAPABILITY_POLICY_MODE=off` 的 fixture 兼容模式，不能扩写为 PostgreSQL capability-policy/EffectivePermissions/RLS 验收。实际 Electron 空登录页已通过 UIA 观察，main 使用新 HOME/userData、白名单环境和真实 Python 路径，无 BOOT_FAKE、旧 integration hook 或预置 grant。独立 Security 已核启动合同与实际 spawn 回执绑定，未读取私有 store 或子进程 secret。尚未自动操作认证输入，也未通过实际用户 OAuth 与一次全新 Luna 请求。

公共网络前置实测：实际 `_siwc_http` 对官方公开 JWKS GET 得到 HTTP 403（无登录/模型请求）；已仅请求用户恢复后台网络访问，未要求先登录。需解决真实后端可达性后才请求用户登录，不能借默认 token、浏览器 cookies、旧 URL 或旧 UNKNOWN。原生完整操作与 sender/frame/用户切换仍未验，生产 S 是否已有新 context API 未验；本轮不部署、不发布。当前本机 S 与隔离客户端为验收入口保持运行，精确 PID/优雅退出方式在本地 native-entry 回执中，不把进程存活写成认证通过。

## 2026-10-22 P2-03-02R3 GitHub 进度快照（当前）

按本次用户“将进度提交到 GitHub”保存当前源码、正式测试和进度文档。状态 **PARTIAL_CHECKPOINT / NOT_ACCEPTED**，P2-03-02 尚未完成，Qualification/Product Gates 尚未通过；本次提交不表示发布、验收通过或自动暂停。后续范围仍依当前人类指令与监督派发判定，不能从下方历史暂停记录推断。

相对 M `f27403243`：两份独立预审后，在既有 Python spawn、HTTP 和 JSON-RPC 接缝加入 main 私有证明，绑定 runtime、当前连接、操作、完整参数、有效期和单次 nonce。bootstrap 在启动早期移除私有环境值，子进程最终环境合并与 env writer 拒绝传播；证明不进入 renderer descriptor、URL 或日志。复用现有 auth store、OAuth sessions、SessionDB 和 SDK 消费者，不建立第二套通用管理器。独立安全复核仅在所读代码和合成验证范围内通过，不等于完整产品验收。

namespace 修订包含实际路径/junction、默认与显式 profile、Windows 文件名别名、导入/备份及 SQLite 连接关闭；普通业务文本中的保留词不作为权限判断。UI 增加迟到回复隔离，清除失效登录链接，明确复制失败与停止观察错误。用户自行连接账号，固定 gpt-6-luna / medium，个人模型身份仍不能替代 S 企业权限。

验证证据：当前 Python 组合 **105 passed**（`python-final-first.xml`）；桌面相关 **92 passed**（`desktop-combined.xml`），三组 TypeScript 检查通过。独立安全复核另有 Python proof 30、独立关联边界 9、Node proof/lifecycle 42 通过，存在重叠，不能相加为总测试数。namespace 最新独立完整复跑 **34 passed**（`ns-upstream-frozen-final.xml`），保留此前 33 通过/1 子进程超时与单项复跑证据，未改原 fixture 或 35 秒阈值；父解释器以 UTF-8 模式启动。补充边界 **20 passed / 4 skipped**，其中 5 个真实 Windows junction 用例通过，4 跳过为 symlink 权限限制。所有首次失败和旧证据保留于本地 `p2-03-02-main-authority-20261022` 审计。

未完成项：旧 profile/backup/env 回归 **193 passed / 13 failed / 9 skipped**，失败涉及 Windows 权限/编码/脚本后缀/路径与换行等现象，尚未完成逐项基线归因，不能声称整套通过。实际 Node adapter → Python serve → 临时 S 合成验证仅完成 capabilities/status；首次 submit 返回 `LOCAL_TEXT_UNAVAILABLE`，尚未到 S prepare 或 SDK send，端到端未通过。未启动真实 Electron 原生入口验收，没有真实 OAuth、模型请求、部署或在线更新。原 UNKNOWN 不重放，停止观察不证明远端取消或未计费。

S 本轮仅同步正式进度文档，运行代码保持既有 context 实现。审计日志、临时依赖、构建/安装包、本地学习记录和无关 dirty 文件不纳入提交。

## 2026-10-22 P2-03-02R3 持续开发（当前）

已通过实际消息记录确认恢复授权：监督对话 `01a10694-60c4-7202-b4c9-fd94855797fa` 的人类消息 `01a161c8-cde6-7853-ab9f-17868f0aee10`（所在 turn 起始 2026-10-22T04:05:11Z）要求“继续推进二期项目开发。执行窗口还用 二期基线0.20.9”；随后 `01a161fc-8b0f-7fe0-84aa-726cf0eda018`（turn 起始 05:01:42Z）再次要求“继续推进”。两条均晚于本对话历史暂停/提交指令。此前将旧暂停套用于当前研发属于执行状态错误，已纠正。

当前 **ACTIVE_IMPLEMENTATION / P2-03-02R3**，基线 M `f27403243`、S `c32741b`。本项先完成第二独立预审，再闭合 main 私有证明与所有 owned auth/text 入口，复核 namespace/once、既有安全反例、产品入口与实际用户接入。新控制与证据在 `.cache/audits/p2-03-02-main-authority-20261022/`；恢复时先核其 `control.json` 及更新的人类消息，不能依据历史 checkpoint 文字自动暂停。

本项尚未完成或验收；不进入下一 Gate、不部署或再发布。交付检查点不等于停止研发。以下暂停段落只保留历史时点含义。

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
