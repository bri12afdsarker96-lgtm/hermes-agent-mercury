# Hermes Project 交接与接手细则（2026-09-04）

## 目的与当前结论

本文件是后续同事接手 Hermes Project 的唯一版本化交接基线。先读完本文、两个仓库内的 `AGENTS.md`，再修改代码或部署。

截至本文件更新时，服务端候选已经部署并通过生产健康检查；Desktop Enterprise Client 候选仍在 PR #66，必须等待 CI 与人工审查完成后再合并。没有任何密码、Token、私钥或 `.env` 值应被写入 Git、PR 评论或交接文档。

## 三个仓库及职责

| 仓库 | 地址 | 职责 | 当前接手方式 |
| --- | --- | --- | --- |
| Mercury / Desktop | `https://github.com/bri12afdsarker96-lgtm/hermes-agent-mercury` | Windows Electron/React 客户端、Enterprise Client 外壳、桌面打包与视觉验证 | 克隆后以 `main` 为稳定基线；继续 Enterprise Client 时从 PR #66 的 head 建新分支 |
| Hermes_AI / Server | `https://github.com/bri12afdsarker96-lgtm/Hermes_AI` | Identity、Tenant、Permission、RLS、知识库、提醒、审计、企业 API 与生产 dataplane | 以已部署的 server candidate 为运行基线；不要把候选线误认为默认发布线 |
| NousResearch 上游 | `https://github.com/NousResearch/hermes-agent` | Hermes 基础能力来源，不提交本项目产品代码 | 每个新能力先检查 exact seam、Mercury、upstream、官方 SDK/成熟库，最后才最小新增 |

能力复用顺序固定为：现有 Hermes seam → Mercury 已有实现 → 官方上游 → SDK/成熟库 → 最小新增实现。Hermes 是底座，不是本项目 UI；Enterprise 外观、页面信息架构和业务接入由 Mercury 自己负责。

## 已固化的 Git 状态

### Mercury / Desktop

- `main`：`bde2a00547f75b9c0613cc4b8c87b3367fc5a052`。
- PR #67 已合并到 `main`，包含两个已验证的 upstream 测试稳定性回移。
- Enterprise Client 当前候选为 [PR #66](https://github.com/bri12afdsarker96-lgtm/hermes-agent-mercury/pull/66)：
  - 分支：`codex/principal-provisioning-withdrawal-01`
  - 最新 head：`f4a288736e`（完整 SHA 以 PR 页面为准）
  - 基线：`main`
  - 状态：Draft，未合并、未发布桌面安装包。
  - 本轮修复：按服务端 `desktop_surfaces` 做可见性门禁，同时仅用服务端角色生成中文产品文案；员工看到“我的任务”，但服务端未开放或角色不适用的页面不会由客户端自行授予。
  - 视觉 E2E 已通过；最新 lint 修复已推送并会触发新 run。若 CI 页面仍显示红色，先确认它是否为旧 run。`Review label gate` 在 Draft/未标人工复核标签时属于流程门禁，不应被当作代码错误绕过。

### Hermes_AI / Server

- PR #154 已合并到 server candidate。
- 云端当前部署提交：`7e3a4bb8241e584589fa97483c0f8971bbe85ae2`。
- 本次部署只修复健康检查读取 root-only 运维配置的边界；没有改变业务 API 合约。
- 已执行生产健康检查，结果为 `FAIL=0`：PostgreSQL/pgvector、RLS、Identity 登录烟测、systemd 服务、严格鉴权 API、离机备份与远端备份均通过。

## 生产入口与网络边界

| 入口 | 当前职责 | 不可违反的边界 |
| --- | --- | --- |
| `https://agent.qiqiaoban.top` | Hermes Agent Gateway | 上游 gateway 反代；保持 WebSocket upgrade/timeout 配置 |
| `https://enterprise.qiqiaoban.top` | Hermes Enterprise Desktop 的严格鉴权 API origin | 根路径是中性服务页；仅 `/api`、`/api/*` 反代到受 systemd 管理的 `hermes-web`（回环 8080） |
| `https://login.qiqiaoban.top` | 登录/身份入口 | 与 Enterprise API 分离，不能让 renderer 持有 bearer 或自行选择地址 |

所有内部服务继续只监听服务器回环地址；公网只经 Nginx TLS 终止。证书自动续期已启用。

### 已解决的错误路由

此前 `enterprise.qiqiaoban.top` 错误转发到回环 18080 的遗留候选 Python 进程，浏览器因此出现“水星AI · 数字员工指挥台”。这不是本阶段 Enterprise 产品界面。

现已完成：

- `enterprise` 根路径改为中性“Enterprise 服务已就绪，请使用 Enterprise Desktop”页面；不再公开数字员工 UI。
- `/api/*` 转到 systemd 管理的 8080 服务，`/api/health` 返回严格鉴权健康结果。
- 18080 遗留候选进程已以 `SIGTERM` 正常退出，端口已释放。
- `nginx`、`hermes-web`、`hermes-hub` 均在运行。

Nginx 实际配置仍位于服务器 `/etc/nginx/sites-available/hermes-enterprise-candidate`；已经保留操作前备份。后续应将此站点定义纳入 Server 仓库的版本化 deploy 配置，消除手工配置漂移，但在未验证替代方案前不要恢复数字员工根页面。

## Desktop 企业连接事实

- Electron 主进程是 Enterprise API origin 和 native bearer 的唯一持有者。
- Renderer 只能拿到短生命周期、按 `webContents` 围栏的 opaque session ID；不得向 renderer 暴露 token、URL 输入框或任意代理能力。
- 当前 Windows 用户已设置非敏感配置：`HERMES_DESKTOP_ENTERPRISE_ORIGIN=https://enterprise.qiqiaoban.top`，且已广播环境变更。新启动的 Hermes 客户端会继承它。
- 若客户端仍显示“企业服务不可用”，先区分：
  1. `no_enterprise_origin`：启动进程没有继承可信 origin；
  2. `no_native_session`：用户尚无原生登录会话；
  3. `401/403`：服务端身份/权限拒绝；
  4. `503` 或网络错误：服务端/网络路径问题。
  不要把这些不同错误重新折叠成“请检查网络”。

## 同事的接手顺序

1. 使用各仓库 `main`/候选 PR 的精确提交复现状态，先运行 `git status --short`。现有 `contributors/emails/agent@Agents-Mac-mini.local` 修改属于用户工作区，不得纳入提交或清理。
2. 在 PR #66 等待本次 CI 完结，读取失败作业的精确日志，而不是根据汇总红/绿猜测。
3. 仅当 TypeScript/lint、Desktop UI、Desktop platform、Linux visual E2E 与相关 Python 矩阵通过后，转为 ready-for-review；人工复查 UI、权限收敛、错误合约和中英文文案，再按团队流程合并。
4. Desktop 合并不会自动改变云端企业 API。发布客户端前，在干净 Windows 用户环境启动客户端，验证主进程 origin、原生登录、`/api/whoami`、角色导航和知识库入口。
5. Server 后续变更始终先走 PR/CI，再以增量 bundle 部署：校验 bundle → 写部署前锚点 → 切换候选提交 → 运行 `deploy/preprod/bin/99_health_check.sh`。绝不覆盖云端未跟踪运行报告或配置。
6. 每个新页面先定义服务端 authority（身份、权限、tenant、数据范围），再接入 Desktop。客户端不可仅依据 role 字符串把 server-backed 页面显示出来。

## 当前开发边界与下一阶段

已交付/已候选：企业 shell、原生 one-login IPC 桥、错误契约、角色/服务面导航、知识库、提醒/业务运营、会话、人工接管、权限/治理等页面骨架与多项真实 API 接入。

下一阶段建议按以下粒度推进，而不是大规模重写：

1. **PR #66 收口**：先完成 CI、人工 visual review、再合并；不要混入无关重构。
2. **真实账号 E2E**：用低权限员工、主管、租户管理员分别验证 `whoami.desktop_surfaces`、RLS、知识删除/恢复策略和错误文案；禁止在测试证据中记录真实 bearer。
3. **知识库生命周期**：明确上传→预览→分块→提交→检索→删除的状态、审计与保留策略。管理员删除应走服务端 authority，并以业务规则定义软删除、冻结或物理删除，而不是客户端猜测。
4. **部署配置版本化**：将三域 Nginx 配置与健康检查拓扑纳入 Server deploy 资产，提供 `nginx -t`、回滚和公网根路径/API 冒烟检查。
5. **数字员工功能延期**：除非有单独需求、服务端权限合约、独立域名/路由和审查 PR，不得再把数字员工 Web UI 绑定到 `enterprise.qiqiaoban.top`。

## 不可跳过的验证

- Desktop：类型检查、lint、UI 三分片、electron/platform、Linux Playwright Enterprise visual；截图只可在人工审查后更新基线。
- Server：Python 3.10/3.11/3.12 的 Ubuntu/Windows 矩阵、dataplane PostgreSQL、WeCom，以及生产 `99_health_check.sh`。
- 生产：`https://enterprise.qiqiaoban.top/` 不得出现数字员工页面；`https://enterprise.qiqiaoban.top/api/health` 必须可达且返回严格鉴权状态；三个 systemd/Nginx 服务均 active。

## 安全与协作红线

- 不提交 `.env`、私钥、Token、数据库 DSN 或含 secret 的终端输出。
- 不以全局环境变量判断远程 Desktop 会话能力；会话可见能力来自 session source/toolset，Enterprise origin 是主进程受信任配置。
- 不在 renderer 暴露 native bearer、任意 URL 代理或未校验的上传路径。
- 不对用户已有未提交文件执行 reset、checkout、清理或顺手提交。
- 不因 CI 汇总红色而跳过日志定位；`Review label gate` 与代码/测试失败必须区分。
