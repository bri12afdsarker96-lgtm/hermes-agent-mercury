# Mercury 二期企业集成基线（P2-00B）

## 2026-10-05 P2-03-02 进度封存并暂停（用户指令）

用户要求立即收尾、提交 Git 并暂停开发。当前为 **PAUSED_BY_USER / PARTIAL_CHECKPOINT**，不是 P2-03-02 完成或 Gate 通过。此前 P2-03-01 后端选择与“用户自行接入”修正已获监督接受；本轮仅增加 M 既有 app-server Session 的可选严格关联/终态事实、观察器失败关闭及 server-request 拒绝策略，53 项协议模拟测试通过。该策略未接入企业 UI，配置关闭 ACK 不能证明本机原生能力已经隔离。

用户本机摘要调用桥、owned OAuth 与实际一次请求仍未完成。no-tools Responses 接缝仅完成四角色增量预审，consensus 按用户停止指令中断；认证 grant 与 endpoint 家族待明确，不迁用默认开发凭据。S context API 尚未创建。本轮没有新登录、模型请求、旧 UNKNOWN 重放、部署或发布；个人账号不替代企业数据权限，产品默认仍为 gpt-6-luna/medium。

详见 [封存说明](D:/GitHub/同步/hermes-agent-mercury/.worktrees/enterprise-client/docs/phase2-03-02-checkpoint.md) 与本地审计 `p2-03-02-local-runtime-20261005`。下方旧状态保留其历史时点；任何恢复、03-03 或后续施工须等用户新指令。



> **2026-10-05 用户自行接入范围修正（当前）**：用户明确不考虑企业统一模型接入，由使用者在自己的设备上自行连接/登录。企业接入资格不再作为本机路线的前置条件；当前企业助手尚未接通用户本机 Codex，原因码改为 `CODEX_LOCAL_RUNTIME_REQUIRED`，不可据此推断用户未登录。个人模型账号不替代企业数据身份/权限。此轮仅修改合同、可见文案与有限原因码；没有新增本机调用桥、登录、推理请求、发布或 Gate 通过。旧审计保持；当前规则见 [后端选择合同](D:/GitHub/同步/Hermes_AI.worktrees/enterprise-v0199-scope-fix/docs/phase2-backend-choice-contract.md)。


## P2-03-01 后端选择实现已验证，待监督（2026-10-05）

当前唯一项为 **READY_FOR_SUPERVISION_IMPLEMENTATION_WITH_QUALIFICATION_DEPENDENCY**。服务端在可信租户内固定配置并拒绝伪造/不可用后端；客户端对话及客户接待复用原 stores 固定选择、保留 UNKNOWN 且不自动重发。Codex 软件默认 gpt-6-luna/medium，仍明确不可用。最终按测试文件去重：S 42 passed，M 75 passed/3 既有 skipped；三组 TypeScript 检查通过，独立 Agent 源码复核完成。Qualification/Product Gates NOT_PASSED，二期 NOT_COMPLETE；未提交、推送、部署或再发布。详见 [本项实施报告](D:/GitHub/同步/hermes-agent-mercury/.cache/audits/p2-03-01-backend-choice-20261005/REPORT.md)。旧时点记录继续保留。


## P2-02A 资格结果已交付：部分确认，待监督（2026-10-05）

当前结果为 **PARTIAL_WITH_SPECIFIC_EXTERNAL_DEPENDENCY**；设计已接受，Qualification/Product Gates NOT_PASSED，二期 NOT_COMPLETE。独立官方 ChatGPT 登录、0.159.2 握手与线程已确认；唯一短调用被接收后 60 秒无已观察终态，禁止自动重放。owned 本地 logout 已验，默认登录保持；远端取消/收费、Hermes 部署注册、企业工具/设备效果未验证。详见 [本项资格报告](D:/GitHub/同步/hermes-agent-mercury/.cache/audits/p2-02a-qualification-20261005/REPORT.md)。下一最小候选为 P2-03-01 既有后端选择与明确可用性；Codex 路线资格不足时明确不可用。下方“进行中”等记录保留登记时点含义，以本条及报告为准。


## 2026-10-05 P2-02R/T4 设计已接受；P2-02A 资格与设计登记进行中（当前）

用户二期全量授权保持；监督于 2026-10-05T11:53:52Z 接受 T4 条件性 exact-pin 共识设计（Design Gate ACCEPTED，Qualification/Product Gates NOT_PASSED）。当前唯一派发 **P2-02A / DISPATCHED_QUALIFICATION_AND_DESIGN_REGISTRATION**，资格最终报告待交付；尚无本项实际登录/模型/企业工具/设备效果/计费 PASS。D1–D9 条件、四角色证据及候选单一 S wrapper 见 [正式复用登记](D:/GitHub/同步/Hermes_AI.worktrees/enterprise-v0199-scope-fix/docs/upstream/p2-02r-reuse-resolution.md)。顺序仍为 02R→02A→03(3)→04(4)→05(4)→06(3)→07；P2-04 知识/任务闭环，Android/device 效果在 P2-05。下方旧 pending/未派发/CI/FAIL 段落保留为对应时点历史，不覆盖当前记录。

M 保留原生 HTTP 与不透明 enterpriseSessionId；新后端选择仅作已接受候选接缝，renderer 不取得 credential/tenant/permission 权威。当前 M 产品源码未改。

## 2026-10-05 P2-CI-FIX-01/T6C_EXECUTION 唯一隔离执行真实结果待监督审查（当前）

T6B REVIEW_ACCEPTED_STATIC_RUNTIME_PACKAGE_WITH_ARGV_OUTPUT_MODE_CONTRACT；T6C-PREFLIGHT REVIEW_ACCEPTED_READONLY_PREFLIGHT_ARGV_OUTPUT_CONTRACT_PACKAGE（旧21:49只读快照保持）；T6C_EXECUTION 已按 DISPATCHED_SINGLE_ISOLATED_EXECUTION 完成唯一新尝试，ACTUAL_EXECUTION_PASS_PENDING_SUPERVISION：新现场14环境/45actual argv输出契约通过，冻结controller3e52/guard135f/lifecyclebd16/runa181未改，job hermes-ci-fix-01-t6-20261005-ebca3cdf；2026-10-04 22:14:59—22:18:47 UTC / 2026-10-05 06:14:59—06:18:47 北京时间，228.73秒，controller工具66604d/session33467/完成0aebb4 OS0，execution/process/pytest/cleanup均0；1execute、0collect-only、无重试。本轮新JUnit180 passed/0failed/0errors/0skipped（58/52/63/7），原两H79均PASS，未借T4B180或T6A/B950。9上传及28下载bytes/hash、845源码before/pytest前/after、17constraints实际满足；23health绝对10秒槽无跳槽，实际start9.196831—10.399438秒/最大lateness1.117158秒、completedAfterStop0；45storage实际start4.999844—5.000156秒，PGDATA峰647060KiB/WAL458760KiB/backing最低68795276KiB。未将有抖动实际间隔声称严格每10秒，storage完整cycle逐行耗时未记录；预调用窄异步窗口仍在，无原子取消/全部故障或线程恢复保证。run-complete收尾PG137/OOMfalse发生在pytest0之后，非本轮测试失败；精确owned资源按原门锁/下载hash后清理，post14环境+45absence对照通过，无本job root/五对象/标签残留，三服务active/精确business hermes-pg healthy仅进程证据。固定S2bec+ec79/845e6c/145704960e787/17constraints/两digest/Mce不变；T6B原63/65与旧T6C19/21、T6A39/41、T5C76+66及所有历史FAIL/gap保留，runtime-review仅获准新增本轮日志。真实PG含部分authority/HTTP mock，非完整企业部署/Codex/Android实机/fullmatrix/GitHub-hosted PASS；无产品/SQL/依赖/workflow/生产/再发布/Git提交推送合并/新费，CI-FIX NOT_COMPLETE，证据待监督独立审查后停止。 [T6C_EXECUTION_REPORT](D:/GitHub/同步/hermes-agent-mercury/.cache/audits/p2-ci-fix-01-t6-20261005/t6c-execution/REPORT.md)。


## 2026-10-05 P2-CI-FIX-01/T6B 新身份静态运行脚本包接入完成待审（当前）

T6A REVIEW_ACCEPTED_LOCAL_ARGV_OUTPUT_MODE_CONTRACT_PACKAGE；T6B_DISPATCHED_SCRIPT_PACKAGE_REVIEW（SCRIPT_PACKAGE_REVIEW_ONLY）：独立新身份hermes-ci-fix-01-t6-20261005-ebca3cdf静态包，controller仅接入T6A9242候选，guard/lifecycle/run仅从T5B6a5d/27c4/7363机械映射，完整copy-before/diff/逆映射bytes与AST等价；73静态检查、10内存compile、2现有Bash-n以及本项另行950纯内存stub回放通过，包待监督完整审查。Windows相对SCP/实际args-mode/guard绝对槽与原预算/gates/stop/seal/锁/身份/cleanup顺序保持，pre-call窄异步窗口仍在；仅静态证据，无原子取消/真实恢复PASS。T6C及远端execute/collect-only NOT_DISPATCHED/未授权；当前连接/VPN/容量/业务进程/精确absence全部UNVERIFIED，pytest NOT_RUN/实际0/无JUnit/无新测试统计，health10/storage5实际NOT_ASSESSED。固定S2bec+ec79/845/17constraints/2digest images/Mce、T6A39及41总文件、T5C76+66前稿/T5B112/T5A68/T4/T3/Pilot/T1/T2不改；T4B180带gap/T5C失败/T6A950本地历史保持区别，CI-FIX NOT_COMPLETE，无Git提交/产品/生产/再发布。 [T6B_PLAN](D:/GitHub/同步/hermes-agent-mercury/.cache/audits/p2-ci-fix-01-t6-20261005/runtime-review/T6B_PLAN.md)。


## 2026-10-05 P2-CI-FIX-01/T6A 本地actual argv合同候选验证完成，待审（当前）

T5C REVIEW_ACCEPTED_PRELAUNCH_FAILURE_WITH_ARGV_MODE_GAP（唯一execute启动拒绝、一次collect66.86秒OS1；pytest NOT_RUN/实际0/无新JUnit，监控NOT_STARTED；原只读无残留结论仅业务进程证据）；T6A_DISPATCHED_LOCAL_ARGV_CONTRACT_REVIEW：独立候选完整复制1ec20a，仅两个同内容helper与三个raw消费点typed-json keyword；actual argv/timeout、formatted容器默认及成功inspect边界不变。950项本地回放（105默认helper/210旧默认断言/308新helper/304actual query-assert/6timeout/17present）、21AST与8内存compile通过，静态包待监督审查，不代表真实Docker/PG/cleanup/health10/storage5/线程/原子取消/恢复PASS。S2bec+ec79/Mce及所有旧冻结/76当前证据/66纠正前稿不改；T6B及后续remote attempt NOT_DISPATCHED，无新远端执行授权；CI-FIX NOT_COMPLETE，无Git提交/产品/生产/再发布。 [T6A_PLAN](D:/GitHub/同步/hermes-agent-mercury/.cache/audits/p2-ci-fix-01-t6-20261005/local-contract-review/T6A_PLAN.md)。


## 2026-10-05 P2-CI-FIX-01/T5C 唯一attempt启动合同拒绝，pytest未运行，待审（当前）

T5B REVIEW_ACCEPTED_STATIC_RUNTIME_PACKAGE_WITH_EXACT_ABSENCE_CONTRACT；T5C_PRELAUNCH_FAILURE_CONTRACT_MISMATCH_REVIEW_PENDING：唯一execute在bootstrap前置absence断言拒绝（无--format的inspect返回stdout=[]，冻结helper要求空stdout），controller直接OS退出1；collect-only一次等待封存后退出1，下载/cleanup未进入。pytest NOT_RUN/实际0测试/无新JUnit；storage5与health10真实节拍均NOT_STARTED，2H79本轮NOT_RUN。收尾只读24项通过：精确root/5对象/label均无残留，web/hub/nginx active、hermes-pg healthy，仅为进程证据。112旧包/T5A68/T4/T3及T4B180PASS历史保留；S2bec+ec79/Mce不变，无自动重跑、Git/产品/生产/再发布；CI-FIX未完成，停止待监督审查。 [T5C结果](D:/GitHub/同步/hermes-agent-mercury/.cache/audits/p2-ci-fix-01-t5-20261005/t5c/REPORT.md)。


## 2026-10-05 P2-CI-FIX-01/T5C 唯一真实隔离运行（当前）

T5B REVIEW_ACCEPTED_STATIC_RUNTIME_PACKAGE_WITH_EXACT_ABSENCE_CONTRACT；T5C_DISPATCHED_RUNNING：本次最新可信SSH/容量/业务进程/镜像/精确absence预检24项通过，真实CLI6/6匹配冻结合同；仅一次冻结controller的新隔离四文件PG attempt，真实pytest与storage5/health绝对10秒实际节拍待证据。S2bec+ec79/845/17constraints/原资源预算保持，旧T4B180PASS+15秒/T5A60模拟及112旧包不改；CI-FIX未完成，失败不自动重跑，无Git/产品/生产/再发布。 [T5C授权](D:/GitHub/同步/hermes-agent-mercury/.cache/audits/p2-ci-fix-01-t5-20261005/t5c/authorization.json)。


## 2026-10-05 P2-CI-FIX-01/T5B 精确absence同项补充（当前）

T5A REVIEW_ACCEPTED_LOCAL_CADENCE_AND_OBSERVED_STOP_PACKAGE（60本地模拟通过；实际10秒/fullguard/线程竞态/原子取消/云恢复未验）；T5B_DISPATCHED_SCRIPT_PACKAGE_REVIEW：新身份运行脚本包仅做本地机械接入、AST/compile/现有Bash-n和hash核对，待监督代码包审查。同项补充获准后，仅修正controller两嵌入helper和四absence断言；105 helper案例、210实际断言回放、17present边界及timeout传播均本地通过。原53d19前像/机械等价/缺口记录保留；当前连接/容量/业务进程/精确资源absence和真实故障恢复均UNVERIFIED。T5C未派发、执行未授权、pytest NOT_RUN，无新JUnit/测试计数；CI-FIX未完成。T4B180PASS与15秒历史保留，S2bec+ec79/Mce不变，不推进产品/Git/生产/再发布。

新任务身份仅存在本地脚本/manifest字符串；原T5A根68项和stop-supplement冻结材料不改、不扩原index。guard只机械适配job regex/runner名；controller在bootstrap/cleanup增加同内容exact_absence helper与必要re import，四处分支严格区分种类/完整精确名/正常非零exit/矛盾stdout/UTF8单条absence，其他创建停止收证据清理逻辑与argv/timeout保持。6份完整历史CLI（5typed+1generic）与99mock明确区分；本地结果不代表fresh CLI、云故障恢复或实际10秒通过。verifier/17constraints/固定源码字节保留。见 [T5B_PLAN](D:/GitHub/同步/hermes-agent-mercury/.cache/audits/p2-ci-fix-01-t5-20261005/runtime-review/T5B_PLAN.md)；未来实际单次运行须另行T5C明确派发，本轮不执行SSH/Docker/PG/产品pytest/完整controller或guard/收尾删除。


## 2026-10-05 P2-CI-FIX-01/T5B 本地运行包审查（当前）

T5A REVIEW_ACCEPTED_LOCAL_CADENCE_AND_OBSERVED_STOP_PACKAGE（60本地模拟通过；实际10秒/fullguard/线程竞态/原子取消/云恢复未验）；T5B_DISPATCHED_SCRIPT_PACKAGE_REVIEW：新身份运行脚本包仅做本地机械接入、AST/compile/现有Bash-n和hash核对，待监督代码包审查。继承controller的absence短词判定静态缺口已列具体diff、未应用；当前连接/容量/业务进程/精确资源absence均UNVERIFIED。T5C未派发、执行未授权、pytest NOT_RUN，无新JUnit/测试计数；CI-FIX未完成。T4B180PASS与15秒历史保留，S2bec+ec79/Mce不变，不推进产品/Git/生产/再发布。

新任务身份仅存在本地脚本/manifest字符串；原T5A根68项和stop-supplement冻结材料不改、不扩原index。guard只机械适配job regex/runner名，controller/lifecycle/run保持原Windows相对SCP cwd及控制流，verifier/17constraints/固定源码字节保留。见 [T5B_PLAN](D:/GitHub/同步/hermes-agent-mercury/.cache/audits/p2-ci-fix-01-t5-20261005/runtime-review/T5B_PLAN.md)；未来实际单次运行须另行T5C明确派发，本轮不执行SSH/Docker/PG/产品pytest/完整controller或guard/收尾删除。


## 2026-10-05 P2-CI-FIX-01/T5A 同项停止边界补充（当前）

T4B REVIEW_ACCEPTED_TEST_PASS_WITH_MONITOR_GAP（180/180、原两H79 PASS；实际health15.001–16.514秒历史保留）；T5A_DISPATCHED_LOCAL_CADENCE_REVIEW：同项停止查询范围补充获准后，本地60个案例全部通过；原49PASS+1gap结果与1edc/17361bytes前像保留。周期健康子查询前检查已观察停止，最终无参数收尾快照保留默认行为；检查/调用之间异步设位的窄窗口、真实线程竞态和云故障恢复未验证。未运行SSH/Docker/PG/产品pytest，未验证真实10秒节拍；T5B未派发，CI-FIX未完成。S2bec+ec79/Mce及旧证据保持，不推进产品/提交/推送/生产/再发布。

候选使用monotonic绝对0/10/20…到期槽，记录实际开始/完成/迟到与跳过槽；保留storage5秒、cycle>5秒停止、1200秒总预算/75秒收尾。已授权应用check_health_query与stop_on_event：周期调用True，health-after无参数默认False。模拟证明已观察停止后不启动下一健康子查询，已开始的有界查询可返回；取消/失败/停止后完成时间分别记录，不伪造成功样本。见 [T5A_PLAN](D:/GitHub/同步/hermes-agent-mercury/.cache/audits/p2-ci-fix-01-t5-20261005/T5A_PLAN.md)，完成包停在监督代码/模拟审查。


## 2026-10-05 P2-CI-FIX-01/T5A 本地节拍审查（当前）

T4B REVIEW_ACCEPTED_TEST_PASS_WITH_MONITOR_GAP（180/180、原两H79 PASS；实际health15.001–16.514秒历史保留）；T5A_DISPATCHED_LOCAL_CADENCE_REVIEW：新本地guard节拍候选与50个虚拟时钟案例已交审，49通过、1个范围外的停止子查询缺口，未全部满足合同。未运行SSH/Docker/PG/产品pytest，未验证真实10秒节拍；T5B未派发，CI-FIX未完成。S2bec+ec79/Mce及旧证据保持，不推进产品/提交/推送/生产/再发布。

候选使用monotonic绝对0/10/20…到期槽，记录实际开始/完成/迟到与跳过槽；保留storage5秒、cycle>5秒停止、1200秒总预算/75秒收尾。现有process_health执行途中停止后的子查询续发已用stub复现；越过本轮仅时间元数据范围的修复建议只列diff、未应用。见 [T5A_PLAN](D:/GitHub/同步/hermes-agent-mercury/.cache/audits/p2-ci-fix-01-t5-20261005/T5A_PLAN.md)，完成包停在监督代码/模拟审查。


> **当前状态（2026-10-05 · P2-CI-FIX-01 / T4B收尾）**：T4A **REVIEW_ACCEPTED_LOCAL_CONTRACT_PACKAGE**；T4B **T4B_EXECUTED_TEST_PASS_REVIEW_PENDING**，唯一attempt真实四文件PG结果 **180 passed / 0 failed / 0 errors / 0 skipped**，逐文件58/52/63/7，原两H79均PASS。controller命令OS完成exit0（独立工具会话出处）、remote execution/process/pytest记录0，28份下载bytes/hash核验通过，cleanup exit0；总449.09秒。CI-FIX **NOT_COMPLETE / 质量待监督复核**，不自行推进下一项。
> 固定S2bec＋唯一62946bytes ec79 overlay、e787 archive与845/e6c清单不变；源码前/pytest前/后均核对，仅6项生成egg-info排除。Python3.12.15/PG16.15/pip25.0.1，两个固定镜像digest和17项外部依赖无增删改变。prep/tests实际2GiB1.25CPU/pids256、PG768MiB.25CPU/pids128、swap=memory，无公开端口/privileged；tests/PG在精确internal网络，PG仅挂全新本任务local named卷，2GiB为监控预算非hard quota。
> **监控节拍缺口如实保留**：storage88次实际间隔5.000267–5.097045秒；health/resource30次实际15.001162–16.513915秒、均值15.212840，偏离约定10秒，不能写成全监控合同已PASS。冻结guard在完成health采样后重置last_health并在5秒循环检查；本轮不修脚本或重跑，交监督判断。PGDATA观测峰681056KiB（665.094MiB）、WAL峰458760KiB（448.008MiB）、backing观测最低68808152KiB；stop原因为run-complete/stopErrors空。PG退出137且OOMKilled=false发生于pytest结束后的guard精确kill；prep/tests退出0，不能笼统写三容器均0。
> 清理后新只读24项核对通过：精确root/三容器/net/volume均不存在、三类exact-job标签列表exit0空；web/hub/nginx active、hermes-pg running/healthy **仅进程/容器健康状态证据**，不替代业务全链验收。前置v1误把旧测试PG列入业务检查的拒绝保留，v2按deploy/preprod/docker-compose.yml:8精确hermes-pg刷新通过；本地取证v1将prep普通bridge误写为default字面值而拒绝，原记录保留，v2仅纠正分析表示，冻结运行/证据不改。
> [T4B真实报告/逐文件结果/阶段hash](D:/GitHub/同步/hermes-agent-mercury/.cache/audits/p2-ci-fix-01-t4-20261005/t4b/REPORT.md)。T4A43项、T3A57项/T3B78项及pilot108/2、T2 112passed/68setup errors、T3B NOT_RUN历史不覆盖。真实PG含部分authority/HTTP mock，未做部署企业HTTP/Codex/Android/全矩阵/GitHub-hosted验收或额外故障注入。未提交/推送、生产部署/迁移、合并/再发布或产品接线；完成本次报告后停监督复核。下方RUNNING/静态/旧候选状态按历史阅读。


> **当前状态（2026-10-05 · P2-CI-FIX-01 / T4B）**：T4A **REVIEW_ACCEPTED_LOCAL_CONTRACT_PACKAGE**，56本地合同样例、43静态证据与92结构检查已独立接受；接受不代表完整guard/PG/CI PASS。当前T4B **DISPATCHED_RUNNING**：真实新预检24项通过，未来新job已明确授权冻结controller执行一次；pytest是否开始/结果待实际证据，CI-FIX尚未完成。T3B REVIEW_ACCEPTED_PRELAUNCH_FAILURE（pytest NOT_RUN/0项）与pilot/T2历史保留。
> 用户手动恢复同一个“Hermes 内部预发布”VPN；SSH沿用现有StrictHostKeyChecking=yes。预检UTC17:32:06：MemAvailable5591456 KiB、实际Docker backing可用69847968 KiB，hermes-web/hermes-hub/nginx active、业务hermes-pg running/healthy；两固定digest、3容器/net/volume/root精确absence及标签空通过。当前真实CLI4个完整输出按冻结owned/helper本地回放4/4通过。首次只读预检误把旧测试PG归入业务检查，未执行；旧拒绝记录保留，deploy/preprod/docker-compose.yml确认业务精确名称hermes-pg后刷新通过。
> 新job `hermes-ci-fix-01-t4-20261005-e82d29e2`；固定S2bec+ec79 overlay、e787 archive/845e6c inventory、两个镜像digest/17constraints、唯一单worker四文件命令及1200秒/2.75GiB1.5CPU/新local卷监控预算不变。只执行冻结 `execute_t4.py --execute-authorized-T4B` 一次；不改脚本/测试/SQL/fixture/产品/依赖，失败或启动前停止不重跑。下载hash与冻结精确所有权清理，遇不确定保留残留并审查。
> 本次授权/预检/运行阶段证据在 `p2-ci-fix-01-t4-20261005/t4b/`，T4A43原静态文件与快照不回写。尚无测试PASS声明；完成真实报告后停监督复核，不提交/推送、生产部署/迁移、再发布或产品接线。下方T4A/T3B等段落按历史阅读。


> **当前状态（2026-10-05 · P2-CI-FIX-01 / T4A）**：T3A **REVIEW_ACCEPTED** 保持；T3B **REVIEW_ACCEPTED_PRELAUNCH_FAILURE**（实际结果 T3B_PRE_EXECUTION_FAILED），失败取证与单独授权的精确目录清理已由监督接受，pytest **NOT_RUN / 0项执行 / 无JUnit**，不代表质量PASS。当前 T4A **T4A_DISPATCHED_LOCAL_CONTRACT_REVIEW**，本地包已冻结待监督复核；CI-FIX 尚未完成，T4B **NOT_DISPATCHED**。
> 新包仅在 `p2-ci-fix-01-t4-20261005/` 复制冻结脚本；只在新guard `owned()` 与同文件必要helper修正明确absence合同。兼容大小写object/container响应，但必须正非零exit、完整精确查询名称、单条明确absence且无冲突输出；成功inspect只接受精确任务标签及正常LF/CRLF，foreign/missing/invalid标签、timeout/权限/daemon/socket/empty/mixed错误均拒绝。controller/lifecycle/runner仅机械替换新任务标识与文件名。
> 本地AST函数抽取检查 **56 passed / 0 failed / 0 untested**：3个完整历史CLI回放、1个真实exit/stderr＋显式mock stdout、2个实际SSH传输失败回放、50个受控mock。未导入完整guard或运行产品pytest；本轮两次只读SSH查询均exit255超时，未获得新Docker输出、未创建远端资源。6个Python文件＋2个controller嵌入脚本AST/内存编译通过；现有Git Bash 5.2.26对当前run-t4.sh执行bash -n退出0。
> 固定S2bec9611 base＋ec79 overlay、845条目/e6c2 inventory、e787 archive、两个镜像digest、17项constraints及四文件保持；锁、live gate、身份/进程组、不确定操作保留、下载hash后精确标签清理不变。新job `hermes-ci-fix-01-t4-20261005-e82d29e2` 仅预留在本地，没有执行；资源/20分钟/监控阈值保持T3A合同。
> [T4A冻结审查包与真实hash](D:/GitHub/同步/hermes-agent-mercury/.cache/audits/p2-ci-fix-01-t4-20261005/T4A_PLAN.md)。T3A 57项、T3B 78项旧证据均bytes/hash不变；pilot108 passed/2 failed与T2 112 passed/68 setup errors/退出1均保留。完成本地包后停在监督复核；无提交、推送、生产改动、重跑或T4B。下方T3B/T2/T1及旧候选状态均按当时历史阅读。


> **当前状态（2026-10-05 · P2-CI-FIX-01 / T3B 收尾）**：T3A **REVIEW_ACCEPTED** 历史保持；T3B **T3B_PRE_EXECUTION_FAILED**，唯一 execute attempt 在 live-guard-start-gate 结束（controller退出1，17.67秒，guard processExit90）。**pytest NOT_RUN，实际测试执行0项，无JUnit/逐项统计，四文件结果不可评估**；原H79本轮也未运行，T2两项PASS仅为历史，CI-FIX尚未完成。
> 原因已由监督独立复核：冻结 guard `owned()` 只识别大写 `No such object/No such container`；Docker实际返回小写 `error: no such object: <exact name>`，因此在上传期间误判查询失败并封5份证据。controller启动检查真实拒绝已停止/封存状态，无runner-pid，未进入源码安装/prep/PG/pytest，未创建三容器/network/volume；未改任何冻结脚本或重跑。
> 收证据与精确目录清理已由监督独立接受，接受不代表测试质量PASS。collect-only收证据退出1，但5份下载bytes/SHA-256全匹配；stopErrors原样保留并阻止自动cleanup。随后按单独明确目录清理授权刷新五个对象/精确标签/guard退出/无runner/无uncertain/无文件写者/路径owner mode0700与sealed hash，只删除唯一 `/var/tmp/hermes-ci-fix-01-t3-20261004-6e4fc5c2`；清理退出0，rootExists=false，标签容器/网络/卷列表再次为空。失败fuser查询记录保留，改用支持的只读绝对路径argv取得无写者证据后才清理；没有kill/rm/prune其他资源。
> [T3B最终报告与阶段证据](D:/GitHub/同步/hermes-agent-mercury/.cache/audits/p2-ci-fix-01-t3-20261004/t3b/REPORT.md)。pilot108 passed/2 failed、T2 112 passed/68 setup errors/退出1、T3A全部静态审查原件与hash不覆盖。T4A仅一个 **CANDIDATE_NOT_DISPATCHED**：在新本地审计副本最小修正absence大小写合同并受控检查CLI样例，仍需非零exit+exact-name+明确absence，查询错误继续拒绝；当前不修改旧T3脚本或执行下一轮。完成本包后停在监督结果复核，不提交/推送、产品接线、生产部署/迁移、合并或再发布。下方RUNNING及先前阶段按历史阅读。


> **当前状态（2026-10-05 · P2-CI-FIX-01 / T3B）**：T3A 修正版静态包 **REVIEW_ACCEPTED**；T3B **DISPATCHED_RUNNING**，明确授权只运行已冻结 controller `--execute-authorized-T3B` 一次，job `hermes-ci-fix-01-t3-20261004-6e4fc5c2`，不修改已审查代码或自动重跑。T3A 原 source/input/evidence/verification/PLAN/hash 和旧草稿原件保留。
> 最新只读预检通过：2026-10-05 00:00:47（+08:00）MemAvailable 5612288 KiB，实际 Docker volumes backing `/dev/vda2` ext4 available 69794352 KiB；三业务服务 active，两个固定 digest 镜像已缓存，exact root/三容器/network/volume 均不存在。仅证明当时资源/进程状态，不预判测试结果。
> 固定 S `2bec9611` + overlay `ec79d32b…`、845 条目 `e6c2edf7…`、T2 两镜像/17 项约束及核准四文件；单 pytest/单 worker、无 retry，prep/tests 串行2 GiB/1.25 CPU，PG768 MiB/.25 CPU，无额外 swap，合计2.75 GiB/1.5 CPU，完整 bootstrap/上传/准备/PG/pytest 1200秒。卷预算2 GiB非硬quota、1792 MiB停、backing启动8 GiB/运行6 GiB，5秒容量/10秒资源采样和独立watchdog、live guard/阶段/gate拒绝条件保持。
> [T3B 当前授权、预检及运行结果](D:/GitHub/同步/hermes-agent-mercury/.cache/audits/p2-ci-fix-01-t3-20261004/t3b/REPORT.md)。pilot108 passed/2 failed与T2 112 passed/68 setup errors/退出1历史不覆盖；CI-FIX仍未完成。实际结果/退出码/skip/容量峰值/证据下载hash/清理或残留待采集；下载hash核对后才按冻结代码清owned资源，断连只collect-only恢复。未获准Git提交/推送、产品接线、生产部署/迁移、合并或再发布；完成后停在监督结果复核。下方T3A/T2历史按当时阅读。


> **当前状态（2026-10-04 · P2-CI-FIX-01 / T3A）**：T2 最终报告/逐文件结果/七文档及审计 hash 已由监督接受为真实 **FAIL** 交付（180 项=112 passed/0 failed/68 setup errors/0 skipped，退出 1，原 H79 两项 PASS）；CI-FIX **尚未完成**，报告接受不等于四文件质量 PASS。B/T1/pilot/T2 历史证据不覆盖。
> 当前 **T3A_DISPATCHED_SCRIPT_REVIEW**：仅本地审计脚本包冻结、Python AST/内存编译与可用 shell 语法检查、只读服务器存储/环境预检，及这七文档必要状态记录。方案为全新专属 Docker local named volume 替代 384 MiB tmpfs，使用预算 2 GiB（普通卷非硬配额）、1792 MiB 停止、backing filesystem ≥8 GiB 启动/低于6 GiB停止；5 秒存储监测/10 秒资源与业务进程记录，独立有界 watchdog 与 hash 下载后精确标签清理。
> 固定 S `2bec9611c3deea42d8229f5ad9e44956535d7761` + overlay `ec79d32b72e62d27cc759831be5e786d2b516fb8cc623d5d312a874fb7710947`、845 条目源清单、相同 digest 镜像/17 项外部约束及四文件/单 pytest/单 worker；prep/tests 串行 2 GiB/1.25 CPU，PG 768 MiB/.25 CPU，无额外 swap，未来上传/准备/PG/测试总上限1200秒。
> [T3A 冻结包与审查证据](D:/GitHub/同步/hermes-agent-mercury/.cache/audits/p2-ci-fix-01-t3-20261004/T3A_PLAN.md)。本轮没有创建远端目录/容器/网络/卷，没有启动 PG/pytest、安装工具、复用 T2 资源或改产品/SQL/grants/fixture/测试/依赖/workflow；T3B **NOT_DISPATCHED**，完成脚本包后停在监督审查，不提交/推送或开启产品研发。下方 T2/T1/B 状态按历史阅读。


> **当前状态（2026-10-04 · P2-CI-FIX-01 / T2 完成）**：B **REVIEW_ACCEPTED**；T1 限定 diff 已独立接受，原两项 H79 在 T2 真实 PG 中均 **PASS**。P2-CI-FIX-01 **T2_EXECUTED_FAIL**：一次四文件执行/pytest 退出码 1，JUnit **180 tests / 112 passed / 0 failed / 68 errors / 0 skipped**；CI-FIX 总体尚未收口。
> 逐文件：followup 58/58 passed，dataplane 52/52 passed，pg_identity_repository 2 passed + 61 setup errors，identity_login_pg 7 setup errors。首个错误为隔离 PG 的 **384 MiB PGDATA tmpfs 内 pg_wal 空间不足**，随后恢复/连接错误；这是测试环境容量失败，不能记为 skip、产品断言失败或整体 PASS，新增身份/登录对照尚未验证完成。
> 固定 S base `2bec9611c3deea42d8229f5ad9e44956535d7761` + 单文件 overlay SHA-256 `ec79d32b72e62d27cc759831be5e786d2b516fb8cc623d5d312a874fb7710947`；845 条目源码前后 hash 一致，17 项约束依赖无增删改。只执行一次，未重跑或改 SQL/fixtures/产品；25 份远端证据下载 hash 已核对，专属三容器/网络/目录已清理。前后业务服务 active 仅证明进程状态。原 pilot **108 passed / 2 failed / 0 errors / 0 skipped** 及 B/T1 冻结证据保持历史事实。
> [T2 最终报告与 T3 单一候选方案](D:/GitHub/同步/hermes-agent-mercury/.cache/audits/p2-ci-fix-01-t2-20261004/REPORT.md)：T3 仅候选 **NOT_DISPATCHED**（专属测试磁盘卷替代 tmpfs，现有 CPU/内存/20 分钟及四文件保持）；尚未获准执行。完成本轮报告/七文档状态后停在监督复核，不提交/推送、生产部署/迁移、合并、再发布或开始下一 P2 项。下方 RUNNING/T1/B 条目均按当时历史阅读。


> **当前状态（2026-10-04 · P2-CI-FIX-01 / T2）**：B **REVIEW_ACCEPTED**，T1 限定 diff/语法/范围已由监督独立接受；P2-CI-FIX-01 **DISPATCHED_T2_RUNNING**，仅一次隔离真实 PG 复验。固定 S base `2bec9611c3deea42d8229f5ad9e44956535d7761` + 单文件 overlay SHA-256 `ec79d32b72e62d27cc759831be5e786d2b516fb8cc623d5d312a874fb7710947`，没有新 Git 提交，不改测试或夹入 dirty 文档/学习记录。
>
> 本轮仅运行 followup、dataplane PG、pg_identity_repository、identity_login_pg 四文件，一个 pytest 进程串行；全新库/内部网络，合计 2.75 GiB/1.5 CPU、20 分钟，先下载验 hash 再清任务资源。不使用业务 DSN/卷/用户凭据、端口、host network、Docker socket、runner或付费资源；不自动重跑、不部署/迁移/合并/发布或提交推送。实际结果待采集，**没有测试 PASS 承诺**，原 pilot **108 passed / 2 failed / 0 errors / 0 skipped** 保留。真实 PG 环境不等于已部署 HTTP/Codex/Android 全链。
>
> [T2 运行与清理证据](D:/GitHub/同步/hermes-agent-mercury/.cache/audits/p2-ci-fix-01-t2-20261004/REPORT.md)。B/T1 原审计不覆盖，后续 Git 收口或下一 P2 项等待监督复核；下方阶段状态按当时历史阅读。


> **当前状态（2026-10-04 · P2-CI-FIX-01 / T1）**：P2-00B **REVIEW_ACCEPTED**，仅为 7 文档规划接受，不是复用、资格、产品能力或 CI 质量 PASS。P2-CI-FIX-01 **DISPATCHED_T1_REVIEW**：当前仅获准修改 S `tests/test_dataplane_pg.py` 的两项 H79 用例及必要同文件 fixture，并更新既有 7 文档的状态/任务卡/日志。本次实际差异仅两函数，共享 fixture 未改；按现行返回列/参数合同保留并加强敏感字段不泄漏与角色拒绝断言。
>
> 原 pilot 仍为 **108 passed / 2 failed / 0 errors / 0 skipped**。T1 只完成只读合同/调用方复核、限定测试 diff、语法及差异检查；**未执行 PG 测试**、未提交/推送或改产品/SQL/grant/workflow/依赖/生产。T2 须监督复核 diff 后另行下发，不先跑云；当前停在 diff 审查。
>
> 本阶段证据：[T1 合同、差异与 T2 计划](D:/GitHub/同步/hermes-agent-mercury/.cache/audits/p2-ci-fix-01-t1-20261004/T1_REVIEW.md)。B 原证据 `D:/GitHub/同步/hermes-agent-mercury/.cache/audits/p2-00b-20261004/` 保留未覆盖。下方 B 的 DOCS_READY_FOR_REVIEW 与未 dispatch 状态是接受前的历史，不替代本条。


**B 规划状态（接受前历史）：DOCS_READY_FOR_REVIEW。** 本轮仅新增本文件，与服务端 6 份规划文档形成 7 文件 docs-only 交付。产品实现、测试、配置、工作流、SQL、部署、迁移及发布不在 B 范围。当前文档未提交或推送；后续施工须独立授权。

## 1. 当前交付与源码

| 项目 | 已核对事实 |
| --- | --- |
| Mercury 基线 | `ce4169683981f06a54be3b51d8baf02333e854b7`，tree `ca7763da8cb14fdca236b4605dbfceec63fe20c0`，分支 `codex/enterprise-client-integration-20260905`；提交、正常推送及远端一致性已接受（P2-01） |
| Hermes_AI 基线 | `2bec9611c3deea42d8229f5ad9e44956535d7761`，tree `45ec93fae5218c4303d19a29abca5662dcd35471`，分支 `codex/enterprise-v0199-scope-fix`；当前服务端源码基线，无新增产品提交 |
| 在线更新 | 0.20.9 已发布，真实旧客户端检测、完整下载与双哈希通过；用户安装后任务栏图标/Windows 高 DPI 仍需现场确认 |
| P2-CI-PILOT-01 | 服务端独立云 PG 测试 110 项：108 passed / 2 failed / 0 errors / 0 skipped，退出码 1；运行能力已证明，测试质量 FAIL。本轮没有执行客户端测试 |
| GitHub CI | Mercury 此 HEAD 无 workflow/check run，不能写 GitHub-hosted PASS；服务端 `37118000011` startup_failure、jobs 空，未实际测试，原因未确认 |

原 0.20.9 包构建 stamp 是 `130d43f5ad426eaae15364f5a895162a8c5271c2`、dirty=true、source=local、builtAt `2026-10-03T17:11:47.282Z`，早于 ce416968。独立编译与 ASAR 对应 107 个 runtime、33 个 native 字节相同；两份 package.json 差异为已解释的构建元数据裁剪。不得改写原包出处。

包：`apps/desktop/release/0.20.9/Hermes-企业助手-0.20.9-x64.exe`，257057101 字节，SHA-256 `ef2e2b7dd7e337070916b7947ee583c89bc81400b6bab7a103e5205de4b7f2ba`。[发布记录](../apps/desktop/RELEASE_0209.md)。更新源 `https://ppbb096.site/desktop-updates/windows/x64/latest.yml`；此前清单 0.20.7 已保留回退。本机代理会阻断该域名，已有验收使用企业 VPN 直连。

## 2. 权威文档与任务 ID

服务端当前方向与登记册位于：

- [master-roadmap-v3.md](D:/GitHub/同步/Hermes_AI.worktrees/enterprise-v0199-scope-fix/docs/master-roadmap-v3.md)：最高方向约束。
- [phase2-unified-platform-blueprint.md](D:/GitHub/同步/Hermes_AI.worktrees/enterprise-v0199-scope-fix/docs/phase2-unified-platform-blueprint.md)：二期目标、权威和失败合同。
- [phase2-task-register.md](D:/GitHub/同步/Hermes_AI.worktrees/enterprise-v0199-scope-fix/docs/phase2-task-register.md)：最小 task cards、依赖及证据标准。

同步状态：P2-01 ACCEPTED、P2-00B REVIEW_ACCEPTED；T6B REVIEW_ACCEPTED_STATIC_RUNTIME_PACKAGE_WITH_ARGV_OUTPUT_MODE_CONTRACT；T6C-PREFLIGHT REVIEW_ACCEPTED_READONLY_PREFLIGHT_ARGV_OUTPUT_CONTRACT_PACKAGE（旧21:49只读快照保持）；T6C_EXECUTION 已按 DISPATCHED_SINGLE_ISOLATED_EXECUTION 完成唯一新尝试，ACTUAL_EXECUTION_PASS_PENDING_SUPERVISION：新现场14环境/45actual argv输出契约通过，冻结controller3e52/guard135f/lifecyclebd16/runa181未改，job hermes-ci-fix-01-t6-20261005-ebca3cdf；2026-10-04 22:14:59—22:18:47 UTC / 2026-10-05 06:14:59—06:18:47 北京时间，228.73秒，controller工具66604d/session33467/完成0aebb4 OS0，execution/process/pytest/cleanup均0；1execute、0collect-only、无重试。本轮新JUnit180 passed/0failed/0errors/0skipped（58/52/63/7），原两H79均PASS，未借T4B180或T6A/B950。9上传及28下载bytes/hash、845源码before/pytest前/after、17constraints实际满足；23health绝对10秒槽无跳槽，实际start9.196831—10.399438秒/最大lateness1.117158秒、completedAfterStop0；45storage实际start4.999844—5.000156秒，PGDATA峰647060KiB/WAL458760KiB/backing最低68795276KiB。未将有抖动实际间隔声称严格每10秒，storage完整cycle逐行耗时未记录；预调用窄异步窗口仍在，无原子取消/全部故障或线程恢复保证。run-complete收尾PG137/OOMfalse发生在pytest0之后，非本轮测试失败；精确owned资源按原门锁/下载hash后清理，post14环境+45absence对照通过，无本job root/五对象/标签残留，三服务active/精确business hermes-pg healthy仅进程证据。固定S2bec+ec79/845e6c/145704960e787/17constraints/两digest/Mce不变；T6B原63/65与旧T6C19/21、T6A39/41、T5C76+66及所有历史FAIL/gap保留，runtime-review仅获准新增本轮日志。真实PG含部分authority/HTTP mock，非完整企业部署/Codex/Android实机/fullmatrix/GitHub-hosted PASS；无产品/SQL/依赖/workflow/生产/再发布/Git提交推送合并/新费，CI-FIX NOT_COMPLETE，证据待监督独立审查后停止。 [T6C_EXECUTION_REPORT](D:/GitHub/同步/hermes-agent-mercury/.cache/audits/p2-ci-fix-01-t6-20261005/t6c-execution/REPORT.md)。 P2-02R/02A/03/04/05/06/07仍REGISTERED_NOT_DISPATCHED。

顺序为可选Codex → 企业知识/任务 → Android单设备 → 有限多设备 → 统一验收。T6B REVIEW_ACCEPTED_STATIC_RUNTIME_PACKAGE_WITH_ARGV_OUTPUT_MODE_CONTRACT；T6C-PREFLIGHT REVIEW_ACCEPTED_READONLY_PREFLIGHT_ARGV_OUTPUT_CONTRACT_PACKAGE（旧21:49只读快照保持）；T6C_EXECUTION 已按 DISPATCHED_SINGLE_ISOLATED_EXECUTION 完成唯一新尝试，ACTUAL_EXECUTION_PASS_PENDING_SUPERVISION：新现场14环境/45actual argv输出契约通过，冻结controller3e52/guard135f/lifecyclebd16/runa181未改，job hermes-ci-fix-01-t6-20261005-ebca3cdf；2026-10-04 22:14:59—22:18:47 UTC / 2026-10-05 06:14:59—06:18:47 北京时间，228.73秒，controller工具66604d/session33467/完成0aebb4 OS0，execution/process/pytest/cleanup均0；1execute、0collect-only、无重试。本轮新JUnit180 passed/0failed/0errors/0skipped（58/52/63/7），原两H79均PASS，未借T4B180或T6A/B950。9上传及28下载bytes/hash、845源码before/pytest前/after、17constraints实际满足；23health绝对10秒槽无跳槽，实际start9.196831—10.399438秒/最大lateness1.117158秒、completedAfterStop0；45storage实际start4.999844—5.000156秒，PGDATA峰647060KiB/WAL458760KiB/backing最低68795276KiB。未将有抖动实际间隔声称严格每10秒，storage完整cycle逐行耗时未记录；预调用窄异步窗口仍在，无原子取消/全部故障或线程恢复保证。run-complete收尾PG137/OOMfalse发生在pytest0之后，非本轮测试失败；精确owned资源按原门锁/下载hash后清理，post14环境+45absence对照通过，无本job root/五对象/标签残留，三服务active/精确business hermes-pg healthy仅进程证据。固定S2bec+ec79/845e6c/145704960e787/17constraints/两digest/Mce不变；T6B原63/65与旧T6C19/21、T6A39/41、T5C76+66及所有历史FAIL/gap保留，runtime-review仅获准新增本轮日志。真实PG含部分authority/HTTP mock，非完整企业部署/Codex/Android实机/fullmatrix/GitHub-hosted PASS；无产品/SQL/依赖/workflow/生产/再发布/Git提交推送合并/新费，CI-FIX NOT_COMPLETE，证据待监督独立审查后停止。 [T6C_EXECUTION_REPORT](D:/GitHub/同步/hermes-agent-mercury/.cache/audits/p2-ci-fix-01-t6-20261005/t6c-execution/REPORT.md)。 飞书、员工画像/评分和Full S5仍DEFERRED。

## 3. 客户端实际接线与候选触点

当前企业助手：`apps/desktop/src/enterprise-client/assistant-page.tsx:419` → runtime.post → `apps/desktop/electron/main.ts:14268` `hermes:enterprise:request` → 服务端 `/api/tenant-ai-assist`。会话凭据由 Electron/可信服务端承载，renderer 只做展示与受控调用。企业入口没有验收 Codex 企业工具桥。

通用 Codex 源码链：`hermes_cli/runtime_provider.py:443` → `agent/conversation_loop.py:1900` → `agent/codex_runtime.py:677` → `agent/transports/codex_app_server_session.py:265` / `codex_app_server.py:54`。登录在 `hermes_cli/auth.py` device-code/import/refresh。这里只是已读源码；没有读取 auth store、登录、运行真实订阅或企业授权映射。

候选客户端范围按登记册独立批准：

| 子项 | 用户可见结果 | 候选现有文件/接口 |
| --- | --- | --- |
| P2-03-01 | 清晰选择已验证可用的后端，并保留现有模型入口 | `assistant-page.tsx`、`runtime.ts`，服务端 tenant-ai config/models |
| P2-03-02 | 企业请求与模型运行可靠衔接 | 通用 runtime 源码只作复用参考；新 provider/plugin/企业桥路径须 P2-02R 决议后精确登记，不能先改核心 |
| P2-03-03 | 流式、审批、取消、撤销/断线状态可见 | `assistant-page.tsx`、`assistant-session.ts`、`runtime.ts`、`electron/enterprise-transport.ts`、`main.ts` 的受控 IPC |
| P2-04-03/04 | 任务状态与失败/未知效果可反查 | `assistant-page.tsx`、`assistant-response.ts`，服务端 scoped biz-task / audit；新增 UI 文件须再冻结范围 |

历史测试资产：`assistant-page.test.tsx`、`assistant-session.test.ts`、`runtime.test.ts`、`electron/enterprise-transport.test.ts`；通用 runtime/session/event 单测有 mock。不能把资产存在或 0.20.9 历史模拟 UI 结果当真实 Codex、企业权限、Android 或多设备运行通过。

## 4. 客户端必须遵守的合同

- 个人 Codex 认证只决定模型资格，不能决定 Tenant/Principal/EffectivePermissions。renderer 不持企业授权权威，不直连 PG，不自报设备归属。
- 每次企业工具调用、审批后与实际设备执行前由服务端检查当前权限、撤销及绑定；UI 错误不能通过 legacy/开发 DSN fallback 绕过。
- 订阅、登录、runtime 兼容和计费仍 UNVERIFIED，不承诺无限调用，不默认迁移个人 token/全部 MCP。企业 MCP 总数 ≤20，所选工具和 prompt 在单会话保持稳定。
- Sources 依 C4 统一净化，个人记忆不替代已发布业务知识。任务幂等 ID 与服务端状态可核对；断线/取消不宣称回滚已发生动作。
- Android `ok=false` 不显示成功；注入成功不等于业务完成；副作用未知、重启遗留 `running`、部分完成工作流必须人工确认，不自动重放。
- TypeScript 沿用特性所属 nanostore、薄入口、明确 async handler，不复制服务端状态机；独立复用决议前不冻结 ADOPT/WRAP 或新增核心工具。

## 5. 证据与文件治理

[源码与包对应证据](D:/GitHub/同步/hermes-agent-mercury/.cache/audits/hermes-enterprise-0.20.9-baseline-20261004/P2_BASELINE_AND_CAPABILITIES.md)、[在线发布报告](D:/GitHub/同步/hermes-agent-mercury/.cache/releases/desktop-0.20.9-20261004/PUBLISH_REPORT.md)、[云试点 FAIL 报告](D:/GitHub/同步/hermes-agent-mercury/.cache/audits/p2-ci-pilot-01-20261004/REPORT.md)。B diff、前后 SHA 与文档校验保留在 `D:/GitHub/同步/hermes-agent-mercury/.cache/audits/p2-00b-20261004/`。

云任务容器、网络及服务器临时目录已清理，日志保留。客户端已有无关 dirty `contributors/emails/agent@Agents-Mac-mini.local` 与未跟踪交付日志/学习记录保持原状，不纳入 B。`.agent_tmp/p2-base-0209/compiled` 是源码/包核对临时输出；其 DryRun 清理曾被自动审查以 `blocked by policy` 拒绝，目录保留，未删除、未提交，也不是产品产物。
