**回执绑定和跨工作簿防重集成**

2026-11-16 用户明确按单订单执行打款策略。商品 ID/SKU 与付款交易号的关联已从开发和验收项中移除。

2026-11-16 在独立环境集成 TD `f91f76774264e89296c65b7f54c586180408a646`。桌面基线包含主开发对话的 `2030328af932227ef846a34c24229794aba4701e`，保留加载期间手动输入的金额草稿，并串行处理快速切页的只读宿主请求。本轮桌面功能没有额外布局变更。

TD 的具体文件和实现见其 `docs/receipt-workbook-binding-20261116.md`。仓外证据根目录为 `D:/文档/抖店自动化/_codex_verify/results/receipt-workbook-binding-20261116`。

| 验证 | 结果 | 证据 |
| --- | --- | --- |
| DOM 付款适配器 | 65 项通过 | dom.log |
| 真实独立 Chrome/CDP 本地页面 | 11 个场景通过，页面网络由 fixture 返回 | mock-cdp-results.json |
| 真实 CDP Host 离线分发 | 41 场景、310 断言通过 | cdp-host-final.log |
| 桌面兼容 Host 模拟 | 42 项通过 | desktop-host-ledger-final-42.log |
| 持久账本与八个真实进程竞争 | 19 断言通过，仅一个进程占用成功 | ledger-file-tests.log |
| 工作簿续接分类与预检 | 33 项通过 | workbook-resume-ledger-final.log |
| 真实 WPS 合成工作簿只读预扫描 | 12 项通过，原工作簿 hash 保持一致 | real-preflight-ledger.log |
| 编译后断点保存 | 9 项通过 | compiled-resume-final.log |
| 主开发金额与快速切页回归 | 118 通过、1 既有跳过 | hermes-navigation-tests.log |
| TD 完整构建 | 0 错误、3 个既有 CS4014 警告 | td-build.log |
| 暂存真实 Windows Host 握手 | 通过，84 个运行文件加清单 | td-stage.log |

CDP 成功回执再次校验本次订单、精确金额、补差价类型、提交、确认及款项记录变化。不一致会保存需人工核验并停止后续订单。成功结果记录本单补差价结果，既有交易号观测字段仅作接口兼容信息。桌面金额与类型读回的后续实现见 `native-binding-deep-20261116.md`。

原生客服订单模型的 ActualPayAmountDesc/PayTypeDesc 分别表示订单实付金额与订单支付方式，不能由这些字段证明补差价回执绑定。ProductName/SpecText 仅证明商品名称与规格读取。当前执行和验收按本单策略及本机订单防重处理。

本机共享账本默认位于 `%LOCALAPPDATA%/ZaoNiaoAiDedicated/payment-submissions`，按规范化订单号占用。换工作簿、金额、模式或同一用户的应用资料目录会命中同一记录。提交前先写 D 列，再原子占用。提交后未知、失败、异常、取消均保留占用。预检会导入已读取工作簿中所有表的历史已打款和人工核验记录，包括起始行之前的记录及待处理为零的文件。普通未提交安全失败允许重试。

这是企业助手新增的工程保护。同一订单号跨店铺也会保守阻止，账本不会自动过期。其他机器、其他 Windows 用户、尚未读取的旧工作簿及未使用账本的旧版本不在覆盖范围。人工核验与后续权威服务对账仍需要明确结果。

候选包在独立目录构建，正式验收窗口和正在使用的资料目录不由本轮操作。体验档案从已关闭的 `D:/HTest/hermes-ui-merged-20261116` 复制至 `D:/HTest/hermes-rbind-20261116`，排除所有权、锁和 CDP 端口文件。店铺档案 1093 文件、133159409 字节逐项 SHA256 一致。原目录保留。

本轮测试与构建没有发送真实消息或实际打款。安装包与桌面视觉证据完成后写入仓外 `交付验收记录.md`，并同步主开发对话 `019f53ef-58dc-7b51-9f34-cadd6c0aa933`。
