# 企业助手外观设置与界面改版

用户在收藏、多标签迁移阶段追加了常驻设置入口、浅色模式、参照 Codex++ 皮肤功能以及 Codex 风格界面的要求。本阶段在独立工作树 `hermes-customer-service-integration-20261115` 中实现。验收跨越 2026-11-15 至 2026-11-16。

## 已实现

- 主侧栏底部增加“设置”，打开“外观”弹窗。
- 外观模式支持浅色、深色和跟随系统。新增 Codex 默认皮肤，保留原有六款内置皮肤，卡片预览当前模式的配色。
- 支持本机 PNG、JPG、WebP 背景图，大小上限 3 MB。图片解码通过后保存到本机，支持 65% 至 100% 的界面不透明度和恢复默认。
- 复用既有 ThemeProvider 与皮肤保存机制。背景偏好按 active gateway profile 保存，跨窗口 storage 事件同步，异步选图在切换档案或卸载后丢弃旧结果。
- 企业助手外壳、工作台、店铺、话术规则、人工待办、收藏、多标签和弹窗使用主题语义色。界面采用一层主侧栏、顶部业务页签、中性色平面布局和统一图标。原生 Windows 标题栏跟随外观设置。
- 收藏、多标签、店铺会话和客服业务继续使用上一阶段已核实的行为。原生代码证据入口位于店铺与客服页头，浏览器内另保留证据入口。

新安装默认 Codex 浅色，已有保存的皮肤和模式继续按用户偏好读取。当前交付包括内置皮肤、本地背景和模式设置。Codex++ 社区皮肤市场、远程下载及主题包导入仍未实现。

## 设计及代码依据

界面外观遵循用户本轮追加要求。收藏、标签、导航和侧栏尺寸的行为依据见 `shop-browser-workspace-20261115.md` 及其原生代码位置。原生待处理订单的服务端读取、普通收藏编辑和子项右键管理仍保留缺少证据的说明。

本机 Codex++ 安装目录为 `D:\Codexplus\Codex++`。本轮读取了其公开仓库 `BigPizzaV3/CodexPlusPlus` 中的 `apps/codex-plus-manager/src/dream-skin.ts`，参考 appearance 的 auto/light/dark、配色、背景图片和皮肤保存概念。本项目的界面组件及状态接入复用企业助手现有主题系统。

主要实现位于 `appearance-settings.tsx`、`enterprise-codex.css`、`enterprise-design-tokens.css` 和 `themes/presets.ts`。`DESIGN.md` 已更新外观契约。

## 原生浏览器浮层和拖动

嵌入的 WebContentsView 独立于 DOM 渲染。设置、收藏弹窗、菜单和侧栏拖动期间暂停原生页面显示，结束后恢复同一个页面实例。ShopBrowserWorkspace 监测打开的 DOM dialog，避免外观设置被原生页面覆盖。

桌面验收发现显式 pointer capture 后，原生子视图隐藏期间可能丢失后续 CDP 指针事件。拖动改为活动期间监听 window pointermove、pointerup、pointercancel 和 blur，结束时清理监听。默认 320、最小 260、收起 44 像素以及最大宽度计算继续依据原生代码。

## 验收

最终桌面证据位于 `D:\文档\抖店自动化\_codex_verify\results\customer-service-integration-20261115\appearance-desktop-release-check`。本机使用独立 CDP 53348、Vite 55348、接口夹具 55349、独立 userData 和 HERMES_HOME。店铺 HTTPS 页面、登录身份、消息及人工事项均使用本机模拟数据。

桌面脚本覆盖模式与皮肤切换、背景与透明度、刷新和整进程重启恢复，同时覆盖收藏、右键操作、标签共用 session、导航、关闭重开、侧栏拖动与收起、撤权释放页面，以及规则、转人工和明确恢复自动回复。`desktop-results.json` 保存逐项结果。设置弹窗打开期间另验证原生子视图均隐藏。

Computer Use 已查看完整 Electron 窗口、浅色布局和设置弹窗，确认原生页面、设置完成按钮及文本实际显示。页面 PNG 用于保存 renderer 布局，原生店铺页面通过独立 capturePage 捕获。

主题、外壳、店铺档案、截图及付款页面相关回归共 18 个文件 209 项通过，日志为同级 `appearance-regression-final.txt`。定向 ESLint、renderer 和 Electron 类型检查、Vite 构建及主进程 bundle 通过。上一阶段收藏、多标签及客服回归另有 15 个文件 221 项通过，见 `shop-browser-workspace-20261115.md`。

本轮未改动截图工作台和付款页面源码，SHA256 分别为 `42FFBC42426BFAAE2A9E6382152246C0B7398BBAF05683CBFA137AD79BF0F8A7` 和 `2D1D123F655421ACEBD9815E889AA2AD984D25222E7A63831B2CB2C4BE7F64B2`。安装版 PID 24704、后台 PID 49436 持续运行。完整验收的企业写请求仅包含本机模拟登录。

## 合并接入

先合入收藏与多标签提交 `a9ad5da9d`，再合入本轮外观提交。项目开发工作树已包含 `e04f195c1` 和 `73dc1a79f`，合并 `shop-browser-electron.ts` 时须同时保留 TD 分支提取的会话配置、身份读取、execution page、执行租约及授权失效处理，并接入浏览工作区可选第五参数和 browser controls。

完整迁入组件、样式、语义 token、i18n 与 ThemeProvider 改动，避免只合业务后重复设计界面。新外观仍需随项目开发对话的合并版本完成其真实店铺及最终安装包验收。
