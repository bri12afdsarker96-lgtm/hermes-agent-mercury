# 0.20.12 发布基线交接

本目录于 2026-11-12 从 2026-10-26 实际发布工作树整理。用于另一台电脑对齐发布基线，不代表当前 R2 已完成验收。

## 获取

仓库：bri12afdsarker96-lgtm/hermes-agent-mercury
分支：handoff/released-0.20.12-20261112
基线：ce4169683981f06a54be3b51d8baf02333e854b7（发布 0.20.9 源码）。本分支在该基线上包含 0.20.10–0.20.12 发布改动。

本分支是可检出的完整客户端源码；desktop-from-ce4169683.patch 包含全部 11 个已修改/新增文件（包括新建的平台管理组件和测试）。旧临时 release-02012.patch 未包含当时未跟踪的新文件，不应再作为完整补丁使用。

其他机器可把本仓库作为额外 remote，fetch 本分支，在独立 worktree 检查。不要直接覆盖 integration/desktop-r2-20261112，也不要整树合并两个不同来源的仓库。先逐文件比较，再迁移冲突中的功能。source-sha256.json 对应本次整理时的工作树文件字节；Git 换行转换可能改变字节哈希，应同时检查 git diff 与文件内容。

## 已发布功能必须保留

- 企业微信绑定真实状态、账号展示及轮询。
- 客户端默认公共 HTTPS 登录，关闭可选的旧 VPN 引导。
- PostgreSQL 真实操作员坐席统计；主管及企业管理员不占用操作员配额。
- 平台企业筛选、剩余容量、管理员查看/重置和受限操作记录。
- 原有提醒调度与投递修复不可因采用旧服务端基线而丢失。

## 发布产物

公网目录：https://ppbb096.site/desktop-updates/windows/x64/
安装包：Hermes-企业助手-0.20.12-x64.exe
大小：257058491 字节
SHA256：abce71a874c19bac113b512a0af146e9c455df0d5e95e4ae5d4c29f361e75319

upload-manifest-02012.json 包含安装包、blockmap、latest.yml 的 SHA256。verify-02012.json 是当时安装器内嵌 payload/ASAR/构建文件核验记录，不代表重建后安装器字节必须相同。latest.yml 是固定的历史发布元数据；公网 latest.yml 未来可能升级。

## 服务端边界

运行源目录：/opt/hermes/releases/enterprise-web-v0.20.8-fix11-20261003
PYTHONPATH 指向该目录，不是其下的 hermes_devices，也不是旧虚拟环境的 site-packages。

platform-02012-patch.json + platform_governance.py 是当时实际部署的平台管理窄补丁；before-hashes.json 是应用该补丁前的两个源文件哈希。补丁 JSON 包含 pg_old/pg_new、插入方法和路由，必须逐个检查唯一锚点，不能对当前线上代码盲目重放。

这些文件不是完整服务端快照，也不包含此前全部企业微信/提醒热修。11 月 12 日线上已有其他 agent 的新增补丁，禁止使用 10 月备份整体覆盖。后续服务端集成必须从当前实际模块路径读取源码并比对已授权功能；仅有本目录不等于服务端发布基线完全对齐。

历史服务端备份：/opt/hermes/backups/platform-02012-20261026T022343Z
历史网页备份：/opt/hermes/backups/platform-web-02012-20261026T022615Z
历史更新源备份：/opt/hermes/backups/desktop-feed-02012-20261026T022642Z

## 构建与验证

使用仓库既有依赖/安装流程。桌面：apps/desktop 下 npm run typecheck、npm run build；打包沿用 scripts/run-electron-builder.mjs --win nsis --x64 --publish never。安装包核验 scripts/verify-enterprise-release.mjs 需要本机可用 7z 路径。不要把 node_modules、凭据或本机临时目录提交为依赖。

历史验证：65 PostgreSQL 测试、6 相关 HTTP 测试、12 客户端测试及类型检查；这些是 10 月发布证据，不是 R2 新代码的测试结果。本次交接重新核验了本机安装包/元数据 SHA256。

## 给接手 agent 的修正

1. 可继续补执行端服务端权威能力检查；不新增业务未要求的打款审批。
2. 鉴权 HTTP 联调应在隔离身份/测试库中运行，不必等待真实员工密码。
3. find 指定文件名无结果不能证明实际数据库为空：先解析运行进程的 HERMES_ASSISTANT_MEMORY_DB、HOME、模块默认路径和挂载环境，再查询记录数。不要打印其他环境变量或凭据。
4. 旧幂等表重建会丢失重复请求历史，不能把“正文未丢”称作完全无损；升级期间应规定旧请求重放策略。
5. 90 天停止召回尚未获业务确认。将其标为待定，不宣称已确认规则，不进行物理删除。
6. 保持独立测试包流程；新采纳/原生功能验证通过前，不推进正式更新或周审页面。
