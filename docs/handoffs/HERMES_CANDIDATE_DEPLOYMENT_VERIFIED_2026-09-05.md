# Hermes 候选部署接续验证 · 2026-09-05

本记录接续 [交接入口 #71](https://github.com/bri12afdsarker96-lgtm/hermes-agent-mercury/pull/71)。仅更新候选部署事实；不替代总纲，也不表示完整业务验收或正式发布。

## 当前结论

2026-09-05 11:22（Asia/Shanghai），`hermes-hub` 与 `hermes-web` 已从旧候选 `a64dda4520b5ced3671304714dcadb0aeaf7c112` 切换到 Server 候选 `70fa07be8781acbbddc609959db3f533165071f6`。原 checkout 和 `/opt/hermes/venv` 保留作回滚。

Server [#156](https://github.com/bri12afdsarker96-lgtm/Hermes_AI/pull/156) 仍是候选集成 PR；[#158](https://github.com/bri12afdsarker96-lgtm/Hermes_AI/pull/158) 和 [#157](https://github.com/bri12afdsarker96-lgtm/Hermes_AI/pull/157) 已合入该候选线。本次没有合并其他产品 PR，也没有修改产品源码。

## 已完成及证据

| 核验项 | 结果与边界 |
| --- | --- |
| GitHub 源码对应 | 对照固定 SHA 的 Git tree 核验全部 681 个 blob；681 个内容一致，其中 650 个需将已有 CRLF 规范化为 LF 比较；无其他内容差异。未以目录名代替源码验证。 |
| 候选运行环境 | 独立 release 下 `.venv`，editable 安装 `hermes-devices[dev,pg,wecom]`，保持 SQL/资源文件可用；`pip check` 与运行目录外的 import 验证通过。 |
| 离线定向测试 | 租户集成、WeCom 凭证、加解密、provider、delivery、HTTP loopback、E2E 测试切片：111 passed、1 skipped。跳过项不计为通过。 |
| PostgreSQL 行为验证 | 新建独立测试容器，执行 `test_tenant_integrations_pg.py`：2 passed，证明租户密文、A/B 隔离、审计、删除清空密文、app reference 解析后重入 RLS。仅操作测试数据库；测试容器已移除。 |
| 真实数据库只读预检 | `tenant_integration_credentials` 的 RLS / FORCE RLS 均为 true；实际 runtime DSN 登录角色为 `hermes_identity_runtime`，非 SUPERUSER/BYPASSRLS/CREATEDB/CREATEROLE。 |
| 主密钥离机恢复 | 经用户指定，恢复包保存在其本地服务器密钥目录。AES-256-GCM 加密，数据密钥以现有 SSH RSA 公钥 OAEP/SHA-256 包装；独立离线解密、摘要比对及 Fernet 密钥格式校验通过。未保存本地明文、未输出密钥。本 Git 记录不包含恢复包或私钥。 |
| 切换前数据库备份 | `hermes-20260905-112112.dump`：既有 pg_dump/pg_restore-list 流程通过并上传配置中的 COS；额外读取 COS 对象，完整 SHA-256 与本地 dump 一致。此项是备份完整性验证，不是本轮全量数据库恢复演练。 |
| 服务切换 | 两个单元通过独立 `candidate-release.conf` drop-in 指向候选 venv；保留原配置和主密钥 drop-in。健康失败时切换程序会移除本轮候选 override 并恢复旧启动目标。 |
| 服务运行 | `hermes-hub`、`hermes-web` active；切换后核验各自实际 PID 的主密钥已加载，NRestarts 均为 0。 |
| 公网鉴权 | `https://enterprise.qiqiaoban.top/api/health`：200 / strict；未鉴权 `/api/whoami`、`/api/tenant-integrations` 均为 401。 |
| 平台身份边界 | 用现有 bootstrap 管理凭据在服务器本机访问 whoami：super_admin、tenant_id=null；访问普通租户集成接口为 403。凭据只在进程内存和本机受控请求中使用，不输出。此项不代替 Desktop/Keycloak 用户登录 E2E。 |

## 云端运行指针与回滚

- Release：`/opt/hermes/releases/70fa07be8781acbbddc609959db3f533165071f6`
- Hub override：`/etc/systemd/system/hermes-hub.service.d/candidate-release.conf`
- Web override：`/etc/systemd/system/hermes-web.service.d/candidate-release.conf`
- 非秘密部署标记：release 目录中的 `deployment-state.json`，记录 SHA、切换时间、服务 PID 和回滚目标。
- `/opt/hermes/Hermes_AI` 仍停留在旧候选；它现在是保留的回滚 checkout，不能继续用它的 HEAD 推断运行服务版本。
- 若需应用级回滚，仅移除本轮两个 `candidate-release.conf`，保留 `tenant-integrations.conf`，执行 daemon-reload 后重启两项服务，核验旧 `/opt/hermes/venv` 与 strict health。不要删除其他协作者的 override。
- 本轮没有执行数据库回滚。数据库恢复须按既有恢复 runbook 和已校验离机备份进行；不得手工删表充当回滚。

## 尚未完成，后续顺序

1. 真实客户端平台管理员登录 → 确认平台控制台 → 创建/核对目标租户 → 任命首位租户管理员 → Keycloak 创建或绑定 → 租户管理员登录。本次没有创建业务租户、任命人员或改变 Keycloak 权限。
2. 真实业务权限与调用：主管申请、管理员批准/驳回、离职停用、跨租户隔离、审计；AI/WeCom 的实际厂商或渠道调用需使用目标租户真实配置。本轮独立数据库测试和健康检查不能替代这些验收。
3. Desktop [#72](https://github.com/bri12afdsarker96-lgtm/hermes-agent-mercury/pull/72) 实时 HEAD：`8d293912c8273c494fe6f678df0f9cf90ad757a5`，仍为 Draft；失败项为 `Review label gate / Review label gate` 与 `All required checks pass`。完成实质维护者审查后按政策处理，不能形式化添加 `ci-reviewed`。此完整 SHA 修正了前次交接表中的笔误。
4. Desktop [#73](https://github.com/bri12afdsarker96-lgtm/hermes-agent-mercury/pull/73) `362197652d74422800d4681b2bd94c0e534119ff`，依赖 #72；再验证/集成知识上传，以及 AI、企业微信、员工审批页面的真实服务接入。
5. 完成最小化、前后台切换、休眠和短时断网恢复验证后，按既定业务验收门禁重新打包。继续使用自有中文设计系统与 HarmonyOS Sans SC，Hermes 仅作为基础能力来源。

## 协作边界

- Desktop 仓库：<https://github.com/bri12afdsarker96-lgtm/hermes-agent-mercury>
- Server 仓库：<https://github.com/bri12afdsarker96-lgtm/Hermes_AI>
- 上游能力源：<https://github.com/NousResearch/hermes-agent>
- 本轮在独立文档工作树同步证据；主工作树原有贡献者映射变更保持未动。未强推、清理或整理历史产品分支。
- 当前电脑不存在旧交接所列 `D:\GitHub\同步` / `D:\HI-RAG-1.5` 路径；不能把其他电脑的本地目录视为本机事实。后续涉及总纲变更前需取得对应权威资料。
- 私钥、主密钥恢复包、部署环境文件、数据库 dump、工具临时输出均不进入 Git。
