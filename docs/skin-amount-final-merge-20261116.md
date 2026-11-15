**企业助手皮肤与金额流程最终合并验收**

2026-11-16 在本机 Windows 完成最终合并、候选打包和桌面视觉核验。主开发对话为 `019f53ef-58dc-7b51-9f34-cadd6c0aa933`。本记录对应用户要求的界面、店铺档案、多标签及空款项记录后的金额表单回归。

本地证据根目录如下。

| 工作线 | 本地结果目录 |
| --- | --- |
| 本轮最终合并与视觉 | `D:/文档/抖店自动化/_codex_verify/results/skin-final-merge-20261116` |
| 金额与截图组合回归 | `D:/文档/抖店自动化/_codex_verify/results/amount-form-regression-20261116` |
| 主开发对话独立复核 | `D:/文档/抖店自动化/_codex_verify/results/payment-search-final-check-20261116` |

**合并内容与实现依据**

| 提交 | 文件或范围 | 触发与最终行为 |
| --- | --- | --- |
| `1e1d34b34` | 店铺浏览器工作区、收藏和标签 | 已有界面迁移的组成部分，复用原生布局与已确认操作 |
| `7eb89c3ff`、`667b7f47c` | 外观设置与主题样式 | 设置入口、深浅模式、7 款皮肤、本机背景设置及 Codex 风格布局 |
| `77cd61e4e`、`f562d3e7c` | 后台浏览器执行与合并界面 | 截图、付款任务持有独立后台页，可见店铺工作区提供多标签 |
| `0b092da23927407f66f5d15240f485a6625c8966` | `apps/desktop/src/enterprise-client/payment-page.tsx`、对应测试 | 首次进入付款页先完成档案发现再轮询状态，暂时的后台 `TASK_BUSY` 继续等待 |
| `63f6aa6ee32cc17e0ef6a22c6629e6aa275389be` | 同上 | 以已认证 runtime 为键保存内存草稿，切页回来恢复金额原始字符串、工作簿、行范围和仍获授权的档案。切换企业 runtime 后重新选择 |
| TD `ae631409b0162cc0503d85207965f1961fc8cc39` | `PaymentWorkflow.Cdp.cs`、`Assets/ReviewCapture/feige-payment.js`、`tests/feige-payment.test.cjs` | 零可见搜索框或唯一禁用框返回 `SEARCH_NOT_READY`，复用有界等待。多个可见框立即拒绝 |
| TD `8218e2c68b613fcfd2ed942695f0794b765f9404` | `tests/PaymentCdpChromeStub.cs`、`tests/PaymentCdpIntegrationTests.cs` | 补齐真实 Host 测试替身及冷启动、超时、歧义、暂停继续和停止回归 |
| TD `53bb984a24e62d6595ca2ce4aef1854abecb1b44` | `docs/payment-search-controls-20261116.md` | 主开发对话的独立复核报告 |

Hermes 权威分支 `feature/shop-profile-td-engines-20261115` 已快进到 `63f6aa6ee`。TD 权威分支 `feature/embedded-profile-engine-20261115` 已快进到 `53bb984`。TD 后两项仅改变测试和报告，运行时代码与 `ae63140` 差异为零。安装包的桌面源码树与已通过组合回归的 `63f6aa6ee` 一致。

**代码与构建验证**

| 检查 | 结果 | 原始证据 |
| --- | --- | --- |
| 首次页面竞争回归 | 修复前 2 失败，修复后 100 通过 | 金额目录 `payment-race-before.txt`、`payment-race-after.txt` |
| 运行中切页草稿恢复 | 修复前 1 失败，修复后 101 通过 | 金额目录 `form-navigation-before.txt`、`form-navigation-after.txt` |
| 桌面定向组合回归 | 24 文件通过、2 文件跳过，416 项通过、9 项跳过 | 金额目录 `desktop-regression-final.txt` |
| Renderer 和 Electron 类型检查 | 两者退出码 0 | 金额目录 `tsc-renderer-final.txt`、`tsc-electron-final.txt` |
| 合并后付款文件 ESLint | 0 错误，1 项既有 `revision.current` 清理依赖警告 | 本轮 `merged-payment-eslint.json` |
| DOM 付款适配器 | 58 通过，0 失败 | 主开发复核目录 `dom-after.log` |
| 真实 Host 离线分发 | 23 场景、191 断言通过 | 主开发复核目录 `host-after.log` |
| TD 构建 | 0 错误，3 处既有 CS4014 警告 | 金额目录 `td-build.txt` |
| 合并后运行时暂存 | 真实 Windows Host 握手与禁止命令探测通过，84 个运行文件和 1 个清单 | 本轮 `merged-td-stage.log` |
| 最终候选构建 | Renderer、主进程、NSIS 构建和解包验证完成 | 本轮 `package-merged-r4.log` |

持续搜索未就绪时，单次等待上限 15 秒，既有两次未提交安全尝试实测合计约 30.1 秒。暂停时间从等待预算中扣除。最初真实冷启动失败没有捕获当时的搜索框数量，零框归因仍属于代码和行为推断，本记录保留该证据边界。

**真实桌面与表单验收**

| 场景 | 实际结果 | 证据 |
| --- | --- | --- |
| 空款项记录后的 5 元表单 | 实际记录精确匹配“暂无记录，每个订单最多打款5次”，原生表单准备完成 | 金额目录 `command-trace.jsonl`、`prepared-native-form-5.png` |
| 手动 7.50 元表单 | 补差价选中，原生金额为 7.50，适配器 `prepared=true` | 金额目录 `prepared-native-form.png`、`combined-events.jsonl` |
| 金额任务运行期间切页与两标签切换 | 后台页继续存在，返回付款页恢复原始字符串 7.50、工作簿、范围和档案，表单保持锁定 | 金额目录 `decimal-navigation-final.png`、`decimal-navigation-final.txt`、`combined-events.jsonl` |
| 提交前拦截后的 D 列保护 | D2 写入需人工核验，再预检待处理 0、人工核验 1、开始禁用 | 金额目录 `repreflight-fenced.txt`、`workbook-results-final.json` |
| 多标签期间实际截图 | 真实订单图片落入 B2，一张 1640×167 PNG、21408 字节 | 金额目录 `review-active-tabs.png`、`review-navigation-final.txt`、`review-actual-image.png` |
| 主开发独立暂停继续 | 7.50 元原生表单暂停后恢复同一任务，到提交拦截结束 | 主开发复核目录 `live-paused.png`、`live-resumed-to-guard.png` |
| 主开发独立停止与续接 | 搜索阶段停止，D2 空白，再次预检可继续 | 主开发复核目录 `live-stopped.png`、`live-stop-repreflight.png` |
| 主开发关闭重开后的防重 | 人工核验行继续排除，开始禁用 | 主开发复核目录 `live-restart-D-fence.png` |
| 7 款皮肤实际切换 | Codex、Nous、Midnight、Ember、Mono、Cyberpunk、Slate 均更新选中状态及实际根主题，弹窗无横向溢出 | 本轮 `skin-events.jsonl`、`skin-*-state.json`、`skin-*-renderer.png` |
| 深浅 Codex 桌面视觉 | Computer Use 观察到实际深浅画面，文字、皮肤卡片、底部按钮完整，内嵌店铺页面挂起后弹窗可见 | 本轮 `computer-use-dark.png`、`computer-use-light.png` |
| 关闭重开后的外观恢复 | 未重新设置主题，检查仍为 Codex、浅色 | 本轮 `skin-codex-inspect-state.json`、`skin-events.jsonl` |
| 最终店铺与收藏恢复 | 实际识别已有店铺，原“工作收藏（验收）”文件夹可见，新建与切换两个标签成功 | 本轮 `profiles-latest.txt`、`computer-use-final.png` |

实际截图 PNG SHA256 为 `fcd258b798aebcfdb43f5d5a13834edadbdfcda904ce591d4ef308156b1b627b`。截图页输入草稿切页后重置为既有行为，本轮已验证后台任务完成和工作簿图片保存。

视觉记录先用 CDP 操作与读回状态，再通过 Computer Use 检查真实桌面。最初同一路径的两窗口绑定出现画面歧义，最终改用本轮独立包路径重新核验，以上两张皮肤和最终工作区截图均来自该独立路径。

**店铺档案保留与隔离**

最终体验目录为 `D:/HTest/hermes-skin-final-20261116`。从已正常退出的旧体验目录 `D:/HTest/hermes-ui-merged-20261116` 复制 Electron 与 Hermes 数据，保留登录、店铺档案、收藏和外观。复制时排除进程所有权、CDP 端口和锁文件。

店铺档案共 1093 个文件、133159409 字节，复制前后逐项 SHA256 一致，原始目录保留。证据为 `final-profile-copy.log` 与 `final-profile-copy-verification.json`。启动后实际恢复企业记住密码登录、已有店铺身份与收藏文件夹。

现有安装版 PID 24704 与后台 PID 49436 在本轮前后持续存在，启动时间分别为 2026-11-15 20:49:10 和 20:49:13。最终候选使用独立目录，保护现有截图与打款验收。

**最终安装包**

| 字段 | 值 |
| --- | --- |
| 路径 | 本轮目录 `installer-merged-r4/Hermes-企业助手-0.20.13-x64-candidate.exe` |
| 字节数 | 286760403 |
| SHA512 | `3d429bf910bc9bb1a62aa9f0d0d3a4f2ebce0d015cb5a3e945e563af3f1457ec2e204eb7ad1b47bee9822fa0526e381aa1abd1d4d23d56add31994e2d46eb394` |
| 桌面运行时代码 | `63f6aa6ee32cc17e0ef6a22c6629e6aa275389be` |
| TD 运行时代码 | `ae631409b0162cc0503d85207965f1961fc8cc39` |
| 实际解包资产 | 85/85，514340675 字节，路径、大小与 SHA256 全部一致 |
| 发布状态 | `candidate_build=true`、`asset_approval=UNTRUSTED`、`published=false`、`publication_allowed=false` |
| 体验入口 | `D:/桌面/Hermes-企业助手-新版体验-0.20.13.lnk`，指向本轮 `打开新版企业助手.ps1` |

独立复算证据为本轮 `package-independent-verification.json`。当前已打开实际解包后的候选程序，浅色 Codex 风格，显示恢复后的店铺工作区和收藏。桌面入口使用同一独立体验数据目录。

本轮启动器在 Chromium 调用前拦截付款 `submit` 与 `confirm`，两条拦截均已探测生效。这些诊断钩子只存在于仓外验收启动器。原生文件选择结果由诊断层返回验收副本路径，后续界面、Controller、宿主和工作簿处理走实际实现。

本轮没有发送真实消息或实际打款。平台提交后的校验、商品关联要求及到账结果仍需后续真实资金验收。原生订单待办的服务端读取流程仍待补证，页面保留待确认提示。本轮未重跑历史 49 条完整桌面流程，当前引用的新增组合回归和真实运行证据已逐项列出。
