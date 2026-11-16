# 原生关联与桌面金额类型核查

2026-11-16 在独立工作树核查。TD 基线为 f91f76774264e89296c65b7f54c586180408a646，Hermes 基线为 6cfaafc90e8e43a35bf081838814b1cf7e31d0c4。本轮集成 TD 提交为 `7a439e3`。主开发对话继续处理已安装 0.20.13 的飞鸽搜索与付款记录验收。本轮仅执行原生文件静态读取、模拟付款和合成工作簿只读预扫描。

证据目录为 `D:/文档/抖店自动化/_codex_verify/results/native-binding-deep-20261116`。原生完整分析见其中 `原生商品与交易绑定深入核查.md`。46 条 REA 证据导出包 SHA256 为 `192ea845eb57b3a1b8494982713388077211bdbcbaa8b5bb7140e0f31af4449a`。31 条 BAML 与提取文件逐项 SHA256 相等，31 份恢复 XAML 可解析，合计 107 条 Binding。

## 原生证据与缺口

- 原生订单解析显式读取 13 个字段。ProductName 与 SpecText 表示名称和规格文本。ActualPayAmountDesc 与 PayTypeDesc 表示订单实付描述和订单支付方式。该返回模型没有商品 ID、SKU ID 或付款交易号字段，也没有原始 JObject/JToken 扩展容器。
- 订单页 WebResourceRequested 监听沿代码触发 `/backstage/currentuser` 和店铺身份更新，当前链路没有读取订单列表响应正文。
- 原生商品 ID/SKU 到付款申请的关联、单笔补偿回执的金额与类型及交易号绑定、服务端幂等仍缺少证据。恢复资源、反射检查和全部字段检查仅覆盖已恢复代码。运行时扩展与外部网页保留未知。
- 企业助手 CDP 适配器此前已按当前订单、金额、补差价类型和记录变化核查。交易号仍返回 null，绑定标志 false。此次没有补造交易号选择器。

## 实现

`PaymentFormEvaluator.cs` 增加完整金额原文比较与精确解析，拒绝更长金额子串、数字拼接、千分位和指数写法及超长小数被 decimal 舍入。保留 `.5`、`5.`、前导零和完整 decimal 精度，写入金额使用完整精度格式。Host 继续使用已有字符串参数契约，CLI 复用同一解析器。

`FeigeAccessibilityReader.cs` 在原有快照线程读取 ValuePattern 原值，新增 RadioButton 和 SelectionItem/Toggle 选中状态。两个模式冲突、Indeterminate 或读取异常为未知。金额输入候选须唯一，补差价须在表单内唯一且明确选中，同区其他补偿类型选中则拒绝。

`ScreenAutomation.cs` 的桌面兼容流程先精确读回金额，再读取补差价选中状态。UIA 已读到错误金额时继续等待，不用 OCR 覆盖已知不一致。UIA 金额不可用时，OCR 裁剪文字须完整匹配金额。类型缺少明确状态时停止于提交前。

桌面提交后单独出现成功文字、款项记录或重复付款文字，缺少当前订单、精确金额、类型及变化记录绑定，统一进入 Unknown，沿既有工作流保存需人工核验并暂停。提交前已有记录跳过和跨工作簿账本继续沿用。该保护由本轮工程核查加入，原生付款服务实现仍待证。

`PaymentSubmitFeedbackTests.cs` 与 `PaymentHostEngineTests.cs` 覆盖实际编译程序集和 Host 正常入口。三个既有测试编译脚本补入金额解析器与规则依赖。

## 验证

| 检查 | 本轮结果 | 证据 |
| --- | --- | --- |
| 实际编译程序集的金额、类型、提交反馈 | 68 项通过 | compiled-feedback-r3.log |
| 桌面 Host 模拟流程 | 48 项通过 | desktop-host-r2.log |
| CDP Host 离线分发 | 41 场景、310 断言通过 | cdp-host-final.log |
| 持久账本与八进程争用 | 19 断言通过 | ledger.log |
| 工作簿续接和预检 | 33 项通过 | workbook.log |
| 真实 WPS 合成工作簿只读扫描 | 12 项通过，工作簿 hash 相等 | real-preflight-final.log |
| 编译后断点保存 | 9 项通过 | compiled-resume-final.log |
| DOM 付款适配器 | 65 项通过 | dom.log |
| Hermes 界面与集成回归 | 138 通过、1 项既有跳过 | hermes-regression.log |
| Host 隔离与店铺 IPC | 26 项及店铺 IPC 通过 | host-isolation.log、shop-ipc.log |
| TD 完整构建 | 0 错误、3 个既有 CS4014 警告 | td-build-final-r3.log |

当前外部飞鸽实际表单是否暴露 SelectionItem/Toggle 状态仍待只读现场验证。本轮使用构造的 UIA 快照验证判定函数，使用已编译 ScreenAutomation 验证提交反馈，没有把这些结果当作真实付款后回执证据。新严格状态要求可能使桌面兼容路径提前停止，需要现场控件证据才能评估覆盖率。

候选包使用独立目录与已关闭档案副本。实际启动和视觉核验、安装包哈希及主对话同步结果记录在证据目录的 `交付验收记录.md`。本轮未发送真实消息、未实际付款。
