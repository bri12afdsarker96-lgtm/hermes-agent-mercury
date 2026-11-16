# 店铺业务配置云同步

每店业务配置归企业店铺资产。当前服务员工与企业管理员可以读取、修改和恢复。主管沿用既有权限，店铺转移仍仅由企业管理员执行。

## 配置合同

| 字段 | 含义 | 校验 |
| --- | --- | --- |
| remitAmount | 每单金额 | 保留现有非空字符串语义，保存时去除首尾空白 |
| payoutReviewDays | 评价天数 | 1 至 2147483647 的整数 |
| payoutRequireReviewWithinDays | 是否要求指定天数内评价 | 布尔值 |
| payoutGoodReviewMode | 评价模式 | 0 或 1 |
| payoutRefundChannel | 退款渠道 | small_remit 或 refund_only |

云档案新增 `payout_settings` 与 `payout_settings_revision`。尚未配置时返回 null 与 0。已有配置返回完整五字段及正整数版本。

沿用 `POST /api/shop-login-profiles` 保存业务配置，请求字段为 `profile_id`、`expected_revision`、`expected_payout_settings_revision` 与 `payout_settings`。服务端在同一事务内验证店铺访问权、资产版本与配置版本。成功后同时增加两个版本。客户端收到有效成功响应后才写入本机。

## 恢复与兼容

换电脑时，云配置随店铺档案恢复。管理员把店铺从 A 转给 B 后，配置继续归该店铺，B 与管理员可以恢复，A 的列表、读取和保存权限失效。员工从个人列表移除店铺时，企业资产与配置继续保留。

已有本地五字段配置在云端尚无配置时自动补传。云端已有配置时使用云端值。尚未识别店铺身份的本地档案先保留配置，店铺核验并建立云资产后补传。旧客户端刷新登录资料会保留服务端配置。

断网、服务异常、无效回包及版本冲突会返回保存失败。本机已保存的配置继续保留，客户端不会自动重发写请求。旧服务端能够继续提供既有登录档案，但新客户端会拒绝宣称业务配置已云保存。退出或换租户后，迟到回包通过既有会话边界拦截。

实现位于 `apps/desktop/electron/shop-browser-cloud.ts` 与 `shop-browser-profiles.ts`。界面继续使用既有 `savePayoutSettings` IPC 和 `expectedRevision`，金额保持手动设置。

## 定向回归

从 `apps/desktop` 使用满足 engines 的 Node 执行。

```powershell
$node = 'D:\Hermes\node\node.exe'
& $node ../../node_modules/vitest/vitest.mjs run --project electron electron/shop-browser-cloud.test.ts electron/shop-browser-profiles.test.ts
& $node ../../node_modules/typescript/bin/tsc --noEmit
& $node ../../node_modules/typescript/bin/tsc --noEmit -p tsconfig.electron.json
& $node ../../node_modules/typescript/bin/tsc --noEmit -p tsconfig.e2e.json
```

回归通过临时目录调用真实云 provider 与 `ShopBrowserProfiles`，覆盖五字段恢复、重启恢复、旧配置补传、登录备份保留配置、个人移除、转移撤权、并发冲突、失败关闭及退出后的迟到响应。HTTP 和真实存储联调的证据单独归档。

统一安装包与第二台实体电脑验收按用户要求安排在另一工作线的功能和 UI 对齐完成之后。已有店铺档案和验收目录继续保留。
