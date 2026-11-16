# 云店铺会话导入时序修复

## 缺陷与实现

基线为 `29d70b6a84db6760e1123716a5eeedb7e0b2551b`。真实空本地环境能够登录企业并取得店铺 metadata，导入 155 项 localStorage 时，有 7–8 项被平台启动脚本更新。原实现加载网页后再将当前值与备份逐项比较，报 `SHOP_CLOUD_RESTORE_FAILED_origin-storage-values`，清理该次导入并显示云服务不可用。

`electron/shop-browser-session.ts` 继续通过 `Page.addScriptToEvaluateOnNewDocument` 写入数据，并在同一次脚本执行内逐项读取校验。该脚本使用独立 JavaScript world。网页启动后，主进程从同一隔离 world 读取验证结果。默认网页 world 无法修改该标记。原有域名限制、Cookie 校验、租户状态检查、导入超时、失败清理及导入后的实际店铺身份核验继续生效。

首次尝试的受控空文档方案在 Electron 自定义 HTTPS protocol fixture 中无法覆盖请求，已移除。最终方案直接修复写入与验证的时序。

## 定向回归

现有 `shop-browser-native-fixture.ts` 增加平台启动脚本，更新临时 localStorage 并在默认 world 写入同名假标记。稳定登录值须保留，临时值须由平台重新计算。使用真实 Electron、Chromium Cookie/localStorage、CDP、独立磁盘分区和三次进程启动。

| 验收 | 结果 |
| --- | --- |
| 原实现在新原生用例中复现 | `SHOP_CLOUD_RESTORE_FAILED_origin-storage-values`，exit 1 |
| 修复后同类原生回归 | `NATIVE_PROFILE_STORAGE_PASS`，exit 0 |
| 稳定存储值与 Cookie 恢复 | 通过 |
| 网页启动后临时值更新 | 通过 |
| 默认 world 假标记隔离 | 通过 |
| 关闭重开、分区隔离、重新登录轮换、撤权与删除恢复 | 通过 |
| 7 个相关 Vitest 文件 | 85 passed |
| Renderer / Electron 类型检查 | 两组 exit 0 |

命令从 `apps/desktop` 执行，Node 为 v22.23.2。

```powershell
& 'D:\Hermes\node\node.exe' ../../node_modules/typescript/bin/tsc --noEmit
& 'D:\Hermes\node\node.exe' ../../node_modules/typescript/bin/tsc --noEmit -p tsconfig.electron.json
& 'D:\Hermes\node\node.exe' ../../node_modules/vitest/vitest.mjs run electron/shop-browser-cloud.test.ts electron/shop-browser-profiles.test.ts electron/shop-browser-electron.test.ts electron/shop-browser-execution.test.ts src/enterprise-client/shop-browser-profiles.test.tsx src/enterprise-client/shop-service-assignment.test.tsx src/enterprise-client/shop-cloud-status.test.tsx
& 'D:\Hermes\node\node.exe' scripts/test-shop-browser-native.mjs '<全新独立结果目录>'
```

原始日志位于主工作区 `_codex_verify/results/` 下的 `cloud-session-restore-before-20261116.log`、`cloud-session-restore-after-final-20261116.log` 和 `cloud-session-restore-vitest-20261116.log`。原生窗口截图和逐步结果位于 `cloud-session-restore-20261116/after-final/`。真实店铺云恢复在统一候选验收中继续核验，第二台实体电脑按用户安排延后。
