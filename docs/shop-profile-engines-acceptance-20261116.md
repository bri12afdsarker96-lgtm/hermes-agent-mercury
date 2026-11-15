# 店铺档案接入 TD 引擎验收

验收日期为 2026-11-16，客户端版本为 0.20.13。企业身份使用真实登录处理，店铺使用已保存且已核验的内嵌档案。订单和图片仅保存在仓库外验收副本中。

## 源码与构建

| 项目 | 对应版本 |
| --- | --- |
| Hermes 分支 | `feature/shop-profile-td-engines-20261115` |
| 已实际运行的引擎接线提交 | `cf83f57e439b1a52be0c2de64176a9ab7fc6aaa8` |
| 新 UI 来源 | `feature/ui-shop-merged-package-20261116`，`77cd61e4e01de739ea43c66030f2b2ecf3804d37` |
| 合并提交 | `f562d3e7c111b89e4859d721fb2505b20f9bdced` |
| TD 分支 | `feature/embedded-profile-engine-20261115` |
| TD 提交 | `2615caa6496c42e64268aae290b92fb13b879c3f` |
| TD EXE SHA256 | `05E49E2F559FB8054DFCA6CA9CA5DF37A878241D2FAAA58063EB8D2AF6EAF118` |
| TD EXE 字节数 | 2094080 |

合并后的 `apps/desktop` 与 UI 来源提交逐文件差异为零。冲突仅涉及可见店铺视图的构造处，采用多标签工作区，同时保留本轮后台执行页和身份入口修复。合并后已重新执行类型检查、16 文件定向回归、Vite 构建和主进程打包。

TD 构建目录为 `D:\文档\抖店自动化\_codex_verify\embedded-profile-timeout-fix-build-20261116`。`build-files.sha256.json` 包含 89 个条目，连同该清单实际共 90 个文件。桌面暂存目录 `apps/desktop/build/doudian` 包含 84 个清单内运行文件，加 `manifest.json` 共 85 个文件，84 项 SHA256 全部一致。

本工作线使用本地提交。当前 Hermes remote 为公开仓，沿用既有边界保留本地归档。

## 真实故障与修复

1. 未挂载的 `WebContentsView` 缺少稳定绘制表面，真实 `Page.captureScreenshot` 等待至 45 秒超时。改为任务持有的隐藏 offscreen `BrowserWindow`，绑定主窗口生命周期、固定页面尺寸、复用原档案 session。企业助手仍是唯一可见的任务界面。
2. TD 身份探测的后台起始地址与可见订单页面地址不同。新增执行专用后台首页入口，可见店铺工作区仍保留订单页入口。
3. 内部命令超时曾被当作用户取消回传。TD 现在将命令超时保留为 `TimeoutException` 和 `failed`，用户停止保持 `stopped`。

主要代码位于 `apps/desktop/electron/shop-browser-electron.ts`、`shop-browser-execution.ts`、`main.ts`，以及 TD 的 `ChromeBrowserSession.cs`、`HermesReviewHost.cs`。本批相对 `de6a90b` 的 `PaymentWorkflow.cs` 和 `Assets/ReviewCapture/feige-payment.js` 内容差异均为零。

## 真实运行结果

| 验收项 | 结果 | 证据文件 |
| --- | --- | --- |
| 已保存档案进入截图任务 | 通过，使用真实 Controller、TD 宿主和原截图引擎 | `review-success.json` |
| 截图写入 B2 | 通过，PNG 1640×167，21975 字节，工作簿内 1 张图片，锚点 B2 | `review-extracted.png`、`workbook-verification.json` |
| B 列续接 | 通过，重新准备为待处理 0、已占用 1 | `review-resume-preflight.txt` |
| 付款订单搜索及款项记录读取 | 通过，实际读到历史 1 笔、合计 5 元，执行跳过 | `payment-live-trace-final.json` |
| 付款暂停与继续 | 通过，真实按钮进入已暂停，再继续同一任务 | `payment-paused.png`、`payment-record-skip.txt` |
| 付款停止 | 通过，暂停后点击停止，回传任务已停止 | `payment-stopped.png`、`payment-stopped.txt` |
| 停止后重新准备 | 通过，未处理行仍为待处理 1 | `payment-after-stop-preflight.txt` |
| D 列保存及续接 | 通过，两份真实处理副本写入跳过，再准备为待处理 0、已占用 1 | `payment-final-repreflight.txt`、`workbook-verification.json` |
| 旧失败结果保护 | 通过，初次失败副本及待人工核验分类保留 | `payment-first-attempt.txt` |
| 提交前资金拦截 | 通过，submit 与 confirm 均在 Chromium 调用前抛出验收中止错误 | `payment-submit-guard-final.json` |
| 后台任务页回收 | 通过，终态后仅剩主渲染页 | `payment-live-trace-final.json` |
| 独立窗口正常退出 | 通过，PID 52956 正常退出，启动器退出码 0，原安装版 PID 24704 继续存在 | `PROFILE_COPY_READY.md` |
| 空记录后的补差价和金额表单 | 未覆盖，本次两笔实际处理订单均有历史款项 | 同上款项证据 |
| 真实付款与消息发送 | 未执行 | 验收边界 |
| 合并 UI 的真实安装包运行 | 本工作线未复跑，交由独立打包验收线记录 | 新 UI 分支对应报告 |

截图单条运行中 `Page.captureScreenshot` 实测 144ms，查询与截图阶段 3948ms。包含首次身份恢复的任务处理及写入队列总耗时 18345ms。以上是单行实测，批量吞吐尚未测量。

系统文件选择存在窗口干扰，验收时仅将原生选文件的返回值一次性替换为仓外副本路径。之后页面、Controller、预检、租约、TD 执行、浏览器和工作簿回填均走真实实现。企业认证与店铺身份识别使用真实链路。

资金拦截位于仓外验收启动器，覆盖本进程全部浏览器内容。它用于保证测试不会提交资金。金额仍来自界面手动输入，本次使用已指定的 5 元。

## 定向回归

证据根目录为 `D:\文档\抖店自动化\_codex_verify\results\shop-profile-engines-20261115`。

合并后桌面原始输出位于 `merged-regression.txt`。

```text
Test Files  16 passed (16)
     Tests  362 passed | 1 skipped (363)
  Start at  00:38:33
  Duration  13.22s
```

两套类型检查退出码均为 0。Vite 构建 2.08 秒成功，主进程和 preload bundle 成功。现有 Vite 的 `__dirname` 和 `advancedChunks` 提示保留在 `merged-vite-build.txt`。

TD 原始日志目录为 `D:\文档\抖店自动化\_codex_verify\embedded-profile-timeout-fix-tests-20261116`。

```text
proxy-host-dispatch.log
TIMEOUT_ELAPSED_SECONDS=45.017
PASS real host dispatch screenshot timeout faults with TimeoutException and failed
RESULT passed=12 failed=0

host-regression.log
RESULT passed=26 failed=0

payment-cdp.log
PASS Payment CDP offline integration 18 cases 155 assertions
```

TD 编译 0 错误，3 处既有 CS4014 警告。此次完成源码编译、定向测试和暂存哈希验证。旧发布信任清单继续保持原值。

## 重跑入口

桌面从 `apps/desktop` 执行，使用 `D:\Hermes\node\node.exe`。

```powershell
& 'D:\Hermes\node\node.exe' '..\..\node_modules\typescript\bin\tsc' --noEmit
& 'D:\Hermes\node\node.exe' '..\..\node_modules\typescript\bin\tsc' --noEmit -p tsconfig.electron.json
& 'D:\Hermes\node\node.exe' '..\..\node_modules\vitest\vitest.mjs' run electron/doudian-host.test.ts electron/doudian-task-isolation.test.ts electron/doudian-payment.test.ts electron/doudian-embedded-profile.test.ts electron/shop-browser-execution.test.ts electron/shop-browser-electron.test.ts electron/shop-browser-profiles.test.ts electron/shop-browser-bookmarks.test.ts electron/shop-browser-tabs.test.ts electron/customer-service-preview.test.ts src/enterprise-client/app.test.tsx src/enterprise-client/doudian-workbench.test.tsx src/enterprise-client/payment-page.test.tsx src/enterprise-client/shop-browser-profiles.test.tsx src/enterprise-client/runtime.test.ts src/enterprise-client/role-presentation.test.ts
```

TD 从 `客户定制/早鸟Ai专用版/代码仓/01_外呼截图系统_桌面工具` 执行。

```powershell
& .\scripts\Build-Source.ps1 -HermesIntegration -PackageCache 'D:\文档\抖店自动化\_codex_verify\payment-assets-final-packages-20261111' -OutputDirectory '<新的仓外构建目录>'
& .\tests\Test-HermesHostIsolation.ps1 -EmbeddedBrowser
& .\tests\Test-HermesHostIsolation.ps1
& .\tests\Test-PaymentCdpIntegration.ps1 -Newtonsoft 'D:\文档\抖店自动化\_codex_verify\payment-assets-final-packages-20261111\newtonsoft.json\13.0.3\lib\net45\Newtonsoft.Json.dll' -OutputDirectory '<新的仓外夹具目录>'
```

工作簿独立复核可运行仓外 `verify-engine-workbooks.py`。实际图片、订单副本、浏览器轨迹、店铺档案和登录数据均留在本地验收目录中。

## 新版组合候选归档

2026-11-16 00:50（Asia/Shanghai）收到独立打包工作线交付后，本工作线复核了实际包文件、BUILD_INFO、提取载荷与源码树。

| 项目 | 归档结果 |
| --- | --- |
| 安装包 | `Hermes-企业助手-0.20.13-x64-candidate.exe` |
| 字节数 | 286760052 |
| SHA256 | `FCDE12DC0CF46253B2AD72935031C63DF149389ABBB2D9D38972C916E00EB814` |
| BUILD_INFO SHA512 | `99d1e3e9f3822967abcc8cdadd2c0accdfaba526e831d0f15ad1ca8227b4b6b458462f96c42a96fdfb13f25c8e1764884423c458e50b3e250a5d580648f3c833`，实际文件复算一致 |
| 包对应桌面提交 | `77cd61e4e01de739ea43c66030f2b2ecf3804d37`，与 `e428e4f0f` 的 `apps/desktop` 差异为零 |
| 包对应 TD 提交 | `2615caa6496c42e64268aae290b92fb13b879c3f` |
| 载荷复核 | `extracted-payload/resources/doudian` 实际 85 个文件、514340675 字节，逐项路径、字节数和 SHA256 匹配 |
| 发布状态 | `candidate_build=true`、`asset_approval=UNTRUSTED`、`published=false`、`publication_allowed=false` |

包目录为 `D:\文档\抖店自动化\_codex_verify\results\ui-shop-merged-package-20261116\installer-77cd61e4e-r2`。本工作线新增的独立复算输出为证据根目录下的 `packaged-artifact-verification.txt`。

独立打包工作线的 `desktop-regression-final.txt` 原始输出为 23 文件、395 通过、1 跳过。其 49 条桌面流程、实际打包程序登录与整进程重开、实时店铺识别、多标签及收藏恢复结果，详见同级 `交付验收记录.md`、`desktop-e2e-final/desktop-results.json`、`packaged-desktop/restore-result.json`。本工作线读取了这些交付记录，沿用该工作线的运行证据。

实际窗口截图为 `packaged-desktop/computer-use-final.png`。桌面入口为 `D:\桌面\Hermes-企业助手-新版体验-0.20.13.lnk`。归档时候选 PID 42268、原安装版 PID 24704、原后台 PID 49436 均存在。当前候选保持打开供用户体验。

已知范围继续保留。两个 Electron 文件仍有历史格式检查项。订单待办的服务端读取待补证。多标签跨进程重开创建首页标签，登录档案和收藏恢复。空款项记录后的金额表单分支仍未完成真实验证。真实消息与真实付款均未执行。
