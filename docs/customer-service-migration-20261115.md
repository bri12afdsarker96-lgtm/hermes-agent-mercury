# 店铺与客服迁移交接

本轮在独立工作树完成桌面模块与流程接线，日期为 2026-11-15。

## 可接手成果

- 工作树为 `D:\文档\抖店自动化\_codex_verify\hermes-customer-service-integration-20261115`。
- 分支为 `feature/customer-service-integration-20261115`。
- 父提交为 `e94aa14d6f7073ad32e83b67e7dadaef314fd53f`，已包含 `f93ce33b` 的店铺档案迁移与后续导航等待修复。
- 企业助手导航新增“店铺与客服”，直接挂载 React 页面与现有 Electron 主进程桥接。界面包含深色侧栏、店铺档案表、规则表、1040 宽规则编辑窗、四栏坐席工作台、人工完成确认及恢复操作。
- 页面已适配 Hermes 现有外壳的可用宽度。内部侧栏为 190 像素，窄屏为 160 像素。四栏工作台支持内部横向滚动。此项属于迁入 Hermes 时的布局适配。
- 规则、待办、去重记录、会话模式及处理事件由主进程按企业 origin、tenant、principal、档案与店铺隔离保存，采用原子文件替换及版本冲突检查。
- 店铺登录继续复用现有 Electron 持久 Chromium 会话。新档案短目录布局和旧档案兼容已纳入父提交。可重试身份读取错误保留页面，企业权限或会话变化关闭旧页面。

## 原生证据

管理端程序集为 `D:\逆向软件存放\逆向1\店铺管理端\MDSAGD.dll`，SHA256 为 `AC5067DBDB723E8DF0366C2F40C2EAC43565ABB29480699164160299B3F790B5`。

客服端程序集为 `D:\逆向软件存放\逆向1\客服端(4)\MDSAGG.dll`，SHA256 为 `16CEDDBEB1964014866A16F73F4FA8E659F7AB598B2537968D6165A7A47C08D4`。

| 已核对内容 | 原生依据 | 本轮实现 |
| --- | --- | --- |
| 规则字段与非负 Int32 校验，关键词允许留空 | `REA分析\shop-update-20261115\source\MDSAGD.Views\IntentRuleEditWindow.cs` 383–505 | 同名原生数据字段与主进程校验 |
| 回复、不再邀请、转人工、已评价核实四种动作数组 | 同文件 688–791 | 按原生编辑器数组顺序生成 `ActionsJson` |
| 编辑窗宽度、控件分组、优先级默认 500、命中停止默认勾选 | `REA分析\shop-update-20261115\ui\decompiled\views\intentruleeditwindow.xaml` | 编辑弹窗布局及默认值 |
| 规则表的列与编辑、删除入口 | 同目录 `views\pages\intentrulespage.xaml` | 规则表及确认流程 |
| 待办完成确认、调用网关后清空选中并刷新 | `REA分析\recovered-client-v6-source\MDSAGG.Views.Pages\WorkbenchPage.cs` 2931–3295，`MDSAGG.Services\GatewayClient.cs` 2595 | 本机完成确认与待办状态更新 |
| 按店铺找到档案并打开飞鸽处理 | `WorkbenchPage.cs` 8333–8448 | “去处理”打开当前档案的飞鸽页面 |
| 店铺与四栏工作台的颜色和分区 | 恢复的原生界面资源、`REA分析\ui-shop-evidence.md`、`REA分析\ui-client-evidence.md` 和用户截图 | 同步迁入本阶段对应布局 |

## 明确的证据边界

原生消息执行器和服务端恢复实现仍缺少程序文件。因此，关键词拆分、大小写归一化、优先级排序、会话冷却和模拟去重归属于 Hermes 本机模拟策略。界面和代码中已标明。

本机待办完成后进入 `waiting_resume`，填写原因并明确确认后回到 `auto`。该流程用于验证 Hermes 的人工处理与恢复接线。原生客户端调用 complete 后的服务端行为仍待补证。

`process_evaluated_claim` 只生成本机事件记录。真实返款校验、服务端付款幂等及业务网关的执行逻辑仍待补证。

企业接口核验当前企业、员工及现有 `doudian_review` 产品能力。档案属于员工私有本机范围。逐店铺共享授权、管理员分配店铺及跨员工规则共享仍待权威接口对齐。

浏览器档案尚未接入 TD 截图和付款浏览器引擎。收藏夹、浏览器多标签与其他原生设置仍保留在先前网页版还原成果中，本阶段迁入范围为店铺档案、规则及坐席流程对应页面。

## 桌面验收

证据根目录为 `D:\文档\抖店自动化\_codex_verify\results\customer-service-integration-20261115`。

`desktop-delivery-final\desktop-results.json` 记录真实企业助手 Electron 主窗口、preload、IPC 与主进程存储的执行结果。HTTP 企业接口和平台页面均由本地夹具提供，店铺与消息为合成数据。测试使用独立 `userData` 和 `HERMES_HOME`。

已覆盖规则校验、模拟回复、转人工、去重、人工期间抑制回复、已读、完成确认取消与提交、等待恢复、原因确认恢复、缺失时间戳拒绝及相同消息 ID 重试、renderer 刷新、整个 Electron 进程重启、Cookie/localStorage/业务状态恢复、权限撤销后清空业务内容及恢复访问。“去处理”还验证原生 WebContentsView 的可视边界。

`desktop-delivery-final` 中的 PNG 来自运行中的 Electron 窗口。`native-shop-page.png` 来自内嵌原生 WebContents 的实际捕获。另已通过 Computer Use 检查独立桌面窗口的四栏布局。

回归日志为 `regression-final.txt`，12 个文件共 289 项通过。接入父提交导航等待修复的专项为 `navigation-integration-final.txt`，3 文件 21 项通过。入口收尾后又复验档案 UI、导航与档案控制器，共 3 文件 28 项通过。两套类型检查均通过，日志为 `renderer-typecheck-final.txt` 与 `electron-typecheck-final.txt`。新客服模块、档案 UI 与类型模块定向 ESLint 已通过，结果见 `eslint-final.txt`。Vite 构建见 `vite-build-final.txt`。

## 与原验收环境的关系

原截图、打款验收进程在操作前后均复核。安装版主进程 PID 24704 及后端 PID 49436 保持运行。`protected-files-final.json` 记录截图工作台和付款页面源码与操作前基线的哈希一致。

原项目开发对话继续进行真实店铺登录复验，已识别真实店铺。其整客户端重启后的企业登录与店铺身份恢复仍按该对话实际进度记录。本轮桌面模拟通过不替代那项真实平台验收。

本轮只使用本地模拟消息和模拟返款事件。企业接口夹具唯一写请求为测试登录，其余请求为读取。正式环境无业务写入。

## 重跑

在本工作树 `apps\desktop` 下先用 Node 启动独立 Vite。

```powershell
& 'D:\Hermes\node\node.exe' '../../node_modules/vite/bin/vite.js' --host 127.0.0.1 --port 55348 --strictPort
```

在另一个终端运行以下命令。55349 为本地企业接口夹具，53348 为本次 Electron CDP。请先核对这些端口属于本工作树。

```powershell
& 'D:\Hermes\node\node.exe' 'scripts/bundle-electron-main.mjs' --dev
& 'D:\Hermes\node\node.exe' 'scripts/customer-service-desktop-e2e.mjs' 'D:\文档\抖店自动化\_codex_verify\results\customer-service-integration-20261115\rerun' --keep-open
```

脚本会创建新的独立模拟资料，完成全流程并保持最新版窗口可体验。退出该窗口后本地夹具服务结束。
