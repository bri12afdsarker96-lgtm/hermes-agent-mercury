# 内嵌店铺登录与档案迁移

## 入口与存储

企业助手的订单截图页进入店铺管理后，使用内嵌店铺登录面板创建档案、打开店铺后台或飞鸽、识别当前店铺、关闭重开、清除登录以及删除档案。店铺页面运行在当前 Electron 窗口的 WebContentsView 中。

主进程持有档案、Chromium session 与企业会话。renderer 通过受限动作传入档案 ID 和页面布局边界，第三方页面没有 Hermes preload 或 Node 权限。登录识别使用 Electron 内部 CDP 执行固定只读查询，只返回店铺 ID 与名称。

元数据按企业 origin、tenant_id、principal_id 的 SHA256 分区保存在当前 userData 的 shop-browser-profiles 下。每个档案有独立 UUID，创建时立即保存。新会话采用 storageLayout=2，目录由 scope、档案 ID、存储代次计算 SHA256，路径为根目录下的 sessions/<digest>。旧档案继续使用原目录，显式重新登录后切换新布局。

短路径布局解决 Windows 长根目录下 Chromium Cookies 文件无法正常持久化的问题。接手工作树先复现并定位此问题，本工作树复用该兼容修正，再在独立长目录完成跨进程原生回归。

## 权限与生命周期

每次创建、列表读取、打开、身份识别、重新登录和删除，都重新获取真实企业 whoami，沿用现有 doudian_review capability 与角色、改密及租户检查。档案属于创建它的企业和员工。企业退出、切换会话或 renderer 销毁立即关闭旧 view。打开页面期间每 15 秒重新核对权限，失败后关闭。

识别结果在异步返回后再次核对当前企业会话。已绑定档案若识别到不同店铺，会拒绝静默换绑。重新登录关闭 view 并清理原 session，再生成新的存储代次、清空店铺身份并保存。删除清理 session 并移除持久元数据。Chromium 持有的旧目录可能留到进程退出，新档案不会继续引用这些旧目录。

## 验证入口

Node 使用 v22.23.2。在 apps/desktop 下执行两套类型检查与定向 Vitest。

```powershell
& 'D:\Hermes\node\node.exe' '../../node_modules/typescript/bin/tsc' --noEmit
& 'D:\Hermes\node\node.exe' '../../node_modules/typescript/bin/tsc' --noEmit -p tsconfig.electron.json
& 'D:\Hermes\node\node.exe' '../../node_modules/vitest/vitest.mjs' run electron/shop-browser-profiles.test.ts electron/shop-browser-electron.test.ts src/enterprise-client/shop-browser-profiles.test.tsx src/enterprise-client/runtime.test.ts electron/doudian-shop-management.test.ts src/enterprise-client/doudian-shop-management.test.tsx electron/doudian-task-isolation.test.ts electron/doudian-payment.test.ts src/enterprise-client/payment-page.test.tsx src/enterprise-client/doudian-workbench.test.tsx
& 'D:\Hermes\node\node.exe' '../../node_modules/vite/bin/vite.js' build
& 'D:\Hermes\node\node.exe' 'scripts/bundle-electron-main.mjs' --dev
```

原生 Chromium 存储验收使用已有 Playwright Electron 设施，在显式指定的新空目录执行。脚本通过三个独立进程验证创建保存、关闭重开 Cookie 恢复、档案 Cookie 隔离、重新登录清理、撤权关闭与删除后重启。它只使用合成存储值和本地页面，平台请求由本地 protocol handler 接管，真实账号登录另外验收。

```powershell
& 'D:\Hermes\node\node.exe' 'scripts/test-shop-browser-native.mjs' '<新的绝对证据目录>'
```

本轮命令原文、原生窗口截图及结构化结果位于工作区外侧的 _codex_verify/results/shop-profiles-20261115。verified-layout2-final.txt 记录两套类型检查均为 0、10 个文件 264 项测试通过，以及 main/preload bundle 成功。build-final.txt 记录 Vite build 成功，耗时 1.80 秒。

native-layout2-visual-04.txt 至 native-layout2-visual-06.txt 记录三轮连续长目录验收，每轮启动三个独立 Electron 进程，结果均为 NATIVE_PROFILE_STORAGE_PASS。各同名目录下有 native-results.json 和两张非空 PNG。窗口截图用于证明测试窗口渲染，尚未覆盖完整企业助手内的真实店铺页面布局。

早期失败输出完整保留。native-storage.txt 记录 ESM 测试夹具启动超时，后续采用仓库既有 CJS 启动方式。native-layout2-visual.txt 与 native-layout2-visual-03.txt 记录 Playwright 主进程执行上下文丢失，测试调用固定到已获取的 API 句柄后完成上述三轮连续验收。早期 window.capturePage 生成空图的问题已改为 Playwright screenshot，并断言图片包含渲染数据。成功验收以 visual-04 至 visual-06 为准。

## 仍待集成与验收

- 用户真实店铺账号登录、平台重定向、验证码与只读身份识别尚待验收。用户亲自在内嵌页面输入账号和验证码。
- 当前后端尚未提供已确认的逐店铺共享授权合同，本阶段边界为产品权限与员工私有档案。管理员分配同一店铺给其他员工需要后续服务端合同。
- 新档案尚未供 TD 截图或付款引擎使用。已有 TD 店铺管理与业务链路保持当前实现。
- 规则配置、人工待办和自动回复恢复由后续集成工作树负责。
- 完整企业助手真实会话下的窗口布局、导航与重开仍需桌面验收。原生存储夹具通过只证明真实 Electron 持久化路径。

本阶段没有平台消息发送或付款动作。原截图和付款验收工作树及已安装客户端继续保留。
