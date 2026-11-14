# 0.20.12 抖店迁移验证

基线 `3b5586d17760584029b355ff6328f77626dc3d78`，迁移源 `refs/review/source-0209`。仅迁订单截图和原版打款入口；未修改或部署服务端，飞鸽官方接口另行处理。

## 依赖

原基线根 `package.json` 为独立桌面包，无法匹配根工作区锁文件。本分支采用迁移源中与锁文件匹配的工作区声明，桌面版本仍为 0.20.12。使用 Node 22.23.2、npm CLI 10.9.4 在本工作区执行 `npm ci --ignore-scripts --no-audit --no-fund`，安装 1299 个包。该结果证明当前源码和锁文件可安装，不证明线上发布时使用了同一安装方式；忽略安装脚本亦不包含 Electron 二进制与原生模块完整安装。

## 离线验证

- `tsc --noEmit` 与 `tsc --noEmit -p tsconfig.electron.json`：通过。
- `vite build` 和 `node scripts/bundle-electron-main.mjs`：通过。
- 14 个相关 Vitest 文件：145 通过、1 跳过。包含 Controller、页面、权限边界、暂存和打包；通过环境变量 `HERMES_TD_TEST_HOST` 指向由 TD `Test-HermesHostIsolation.ps1 -BuildPipeDirectory` 编译的测试宿主，跨进程实际分发使用假引擎和合成表格。
- `stage-doudian.mjs` 针对 TD `0259071fb7aaf658e9366b2857d7fa3c06e99a94` 的既有构建产物运行：真实宿主握手通过；85 项（含清单）与既有 `candidate-assets-0259071-UNTRUSTED.json` 一致，514282819 字节。该候选清单不是正式发布信任清单；旧正式清单与之有主程序及 manifest 两项差异。

重跑时，先以 Node 22.23.2 安装依赖；在 `apps/desktop` 执行：

```powershell
& 'D:\Hermes\node\node.exe' '../../node_modules/typescript/bin/tsc' --noEmit
& 'D:\Hermes\node\node.exe' '../../node_modules/typescript/bin/tsc' --noEmit -p tsconfig.electron.json
& 'D:\Hermes\node\node.exe' '../../node_modules/vite/bin/vite.js' build
& 'D:\Hermes\node\node.exe' scripts/bundle-electron-main.mjs
```

定向 Vitest 文件：`electron/doudian-{host,original,payment,task-isolation,pipe-integration}.test.ts`，`src/enterprise-client/{payment-page,payment-original-window,doudian-workbench,doudian-original-window}.test.tsx`，`src/enterprise-client/{runtime,role-presentation}.test.ts`，`scripts/{doudian-package,before-pack,local-deployment}.test.mjs`。实际 shell 展开文件名，勿将花括号当成 PowerShell 展开语法。

## 未覆盖与约束

- 没有安装或启动本次 0.20.12 组合安装包，没有验收真实店铺或真实资金，不能将离线测试当作业务验收。
- 当前分支并未实现经过验证的 0.20.12 本地联调运行时隔离，因此本地联调打包和注入入口被明确拒绝；不得当作 P10 已完成。
- 主进程按 whoami 返回的 `doudian_review`、`doudian_payment` 能力分别拦截操作。尚未核实当前生产服务端对这两个字段的实际返回与租户开通状态；缺少或未启用时入口不可用。
- TD 旧构建的 `LicenseSession.Local()` 不证明原激活码校验；资产来源与旧正式信任合同的差异必须在发布前审核。
