# Hermes Project · 交接基线（2026-09-05）

> **交接结论**：服务端租户凭证 authority 已完成候选集成与 CI 收口；云端已完成
> 候选代码落位、离机数据库备份、主密钥引用配置和 PostgreSQL 幂等迁移，**尚未切换
> 服务进程到候选代码**。这不是正式上线，也不是完整 Desktop 企业产品验收完成。

## 1. 三个权威仓库

| 范围 | GitHub 仓库 | 当前职责 |
| --- | --- | --- |
| Desktop / Mercury | <https://github.com/bri12afdsarker96-lgtm/hermes-agent-mercury> | 独立 Enterprise Desktop 壳、中文视觉系统、Electron、真实服务适配、打包 |
| Server / Hermes_AI | <https://github.com/bri12afdsarker96-lgtm/Hermes_AI> | Tenant/Identity/Permission authority、PostgreSQL/RLS、WeCom、知识库和业务运行时 |
| 上游 | <https://github.com/NousResearch/hermes-agent> | Hermes 基础能力来源；只作复用与对照，不提交本产品代码 |

能力施工顺序仍为：当前 Hermes seam → Mercury 已有实现 → 官方上游 → 官方 SDK/成熟库 → 最小新增。

## 2. GitHub 精确锚点

### Server 候选集成线

| 项目 | 状态 |
| --- | --- |
| Server 集成 PR | [#156](https://github.com/bri12afdsarker96-lgtm/Hermes_AI/pull/156)，Draft，未合入 `main` |
| 候选 HEAD | `70fa07be8781acbbddc609959db3f533165071f6` |
| P0 租户 AI/企业微信加密 authority | [#158](https://github.com/bri12afdsarker96-lgtm/Hermes_AI/pull/158) 已合入候选线，merge commit `96c079b8ed2f0aa187ad7f411e80c79ecc03af8a` |
| 首位租户管理员任命 | [#157](https://github.com/bri12afdsarker96-lgtm/Hermes_AI/pull/157) 已合入候选线，merge commit `70fa07be8781acbbddc609959db3f533165071f6` |
| #156 CI | Linux/Windows pytest、PostgreSQL dataplane、WeCom 均已通过 |

P0 的安全契约：租户 API Key、WeCom Secret/Token/AES Key 只以密文存入
`tenant_integration_credentials`；表强制 RLS；普通状态接口只返回脱敏状态；平台
`super_admin` 不能借普通租户接口读取密钥；AI/WeCom 运行时按已鉴权 `tenant_id` 解密。

### Desktop

| 项目 | 状态 |
| --- | --- |
| 统一交接入口 | [Mercury #71](https://github.com/bri12afdsarker96-lgtm/hermes-agent-mercury/pull/71)，Draft；本文件追加到该入口 |
| 平台控制台及重连 | [#72](https://github.com/bri12afdsarker96-lgtm/hermes-agent-mercury/pull/72)，Draft，HEAD `8d293912c8273c494fe6f678df0f9cf90ad7575` |
| #72 阻塞 | 代码检查已绿；因 CI/Electron 打包链改动，缺维护者实质审查后的 `ci-reviewed` 标签。不得为解锁而形式化加标签。 |
| 知识库真实上传 UI | [#73](https://github.com/bri12afdsarker96-lgtm/hermes-agent-mercury/pull/73)，Draft，HEAD `362197652d74422800d4681b2bd94c0e534119ff`；依赖 #72 |

## 3. 腾讯云候选环境：已完成与未完成

### 已完成（本次）

1. 当前运行服务已核验健康：`hermes-hub`、`hermes-web` active，PostgreSQL healthy。
2. 在候选切换前完成 PostgreSQL `pg_dump -Fc`、`pg_restore --list` 可读校验并成功上传腾讯云 COS，作为回滚点。
3. 服务器 root-only（`0600`）运行时密钥文件已配置
   `HERMES_TENANT_CREDENTIAL_MASTER_KEY`，且已通过 systemd drop-in 供 `hermes-hub` 与 `hermes-web` 下次重启时读取。密钥值未读取、未输出、未进入 Git 或本地项目目录。
4. 从 GitHub 精确候选 SHA 生成并校验归档，云端独立 release 目录已落位；旧 `/opt/hermes/Hermes_AI` checkout 未覆盖。
5. 候选 `schema.sql`、`roles.sql`、`projection.sql` 已在健康的既有 PostgreSQL 上按既有部署逻辑幂等执行；新租户凭证表已确认存在。

### 当前仍未完成（严禁表述为已上线）

- 运行服务仍是旧候选 `a64dda4520b5ced3671304714dcadb0aeaf7c112`；服务尚未切到 `70fa07b`。
- 候选 virtualenv 尚未安装，`hermes-hub`/`hermes-web` 未因本轮操作重启。
- 新主密钥尚缺独立于服务器磁盘的恢复备份。**在完成该备份前，不得让真实租户保存 AI 或 WeCom 密文。**
- 首位租户管理员仍需在 Keycloak 建立或绑定身份；创建 Hermes authority 不等于账号可登录。
- 平台管理员→创建租户→首位租户管理员→跨租户隔离的真实 E2E 尚未执行。

### 安全切换/回滚顺序

1. 先将主密钥置入经批准的离机秘密管理/恢复体系，并验证恢复演练；绝不写入 Git、日志或客户端。
2. 在独立候选 venv 从已校验 release 安装 `hermes-devices[dev,pg]`，运行 import 与定向测试。
3. 复核 `tenant_integration_credentials` 的 RLS、FORCE RLS 和运行时角色权限。
4. 以 systemd drop-in 原子指向候选 venv，重启 `hermes-hub` 和 `hermes-web`，执行 `/api/health`、认证和最小租户端点烟测。
5. 异常时移除候选 ExecStart drop-in，恢复旧 `/opt/hermes/venv` 启动目标并重启；数据库采用已验证的离机备份/恢复 runbook，不做未经验证的手工回滚。

## 4. 必守身份与数据边界

- 平台管理员：全局 `super_admin`、启用、`tenant_id = null`；不得关联“早鸟科技”或任何租户。
- 平台管理员仅负责租户、首位租户管理员、全局审计与平台配置。
- 租户管理员仅能操作本租户的员工、角色、知识库、AI 和企业微信配置。
- 主管创建员工仅产生待批准申请；企业管理员批准后才允许可登录账号。
- 不将现有全局 AI/WeCom 环境变量开放给租户配置页面。
- 不返回、不记录、不提交 API Key、WeCom Secret、数据库密码、Keycloak 密码、腾讯云密钥或 GitHub Token。

## 5. 后续工作安排（严格顺序）

### A. 候选服务端切换与 E2E（优先）

1. 完成主密钥离机恢复备份。
2. 安装并切换 Server #156 候选 venv，保存旧 venv 回滚指针。
3. 验收：平台管理员登录 → 创建“早鸟科技” → 任命首位租户管理员 → Keycloak 绑定 → 租户管理员登录。
4. 验收 A/B 租户隔离、主管申请/管理员批准、停用、审计。
5. 验收 AI 保存/测试、WeCom 保存/测试与删除 tombstone；所有读取均应脱敏。

### B. Desktop 合并与接入

1. 对 #72 的 CI/Electron/打包改动做实质审查；通过后添加 `ci-reviewed` 标签、重跑门禁并合并。
2. #73 rebase 到新的 Desktop 基线，重跑 CI 后合并。
3. 基于已部署并稳定的 Server 契约实现租户管理员页面：员工审批、AI 配置、企业微信配置、知识库进度/重试。不可使用 mock 数据假装已接入。
4. 所有 UI 继续使用 Hermes Enterprise 中文设计系统与 HarmonyOS Sans SC；不要回退为上游原生 Hermes UI。

### C. 真机与发布

1. 验证最小化、前后台切换、休眠恢复、短时断网后的重新鉴权和重连。
2. 记录 DNS、TLS、认证刷新、API 请求耗时；不要将“卡顿”笼统归因于网络。
3. 仅在完整 E2E 通过后重新打包、安装并开始真机验收；候选环境不等同正式生产发布。

## 6. 本地同步审计（本次交接）

| 范围 | 处理 |
| --- | --- |
| Server P0/Onboarding 源码 | 已在 GitHub #158/#157 合入候选 #156；工作树干净 |
| 两条本地历史文档线 | 已保全至 `codex/archive/gate4-readiness-docs-local-20260905` 与 `codex/archive/p3-m0-contracts-local-20260905`，未覆盖远端同名协作分支 |
| Mercury 主工作区 | 存在未提交的 Reminder UI/package-lock 变更及贡献者邮箱本地修改；非本次交接产物，已保留、未提交 |
| Server 主工作区 | 存在既有未跟踪本地文件；已保留、未上传 |
| 临时候选归档 | 仅作为本机/云端 release 传输工件，不是产品源码提交，不进入 Git |

## 7. 协作与 Git 约定

- 本机到 GitHub 的 HTTPS 不稳定时，使用 SSH `ssh.github.com:443`；不要修改共享 `origin` 以免影响其他工作树。
- 每次开发完成：定向测试 → `git diff --check` → CI → 推送分支/PR；涉及候选部署需额外验证备份、迁移和真实 E2E。
- 不强推、删除、整理其他协作者的工作树或历史分支。若同名远端分支前进，创建具名 archive 分支保全本地历史。
- 交接前必须先审计工作树、待推送提交、PR/CI、云端 SHA、服务健康、回滚点和秘密边界。

## 8. 禁止事项

- 不将 #156 候选或云端候选表述为 `main`、正式发布或端到端上线。
- 不在未完成主密钥离机恢复备份前写入真实租户凭证。
- 不把平台管理员绑定到任何租户。
- 不绕过 #72 的 `ci-reviewed` 维护者审查门禁。
- 不提交 `.env`、私钥、Token、密码、临时归档或用户本地文件。
