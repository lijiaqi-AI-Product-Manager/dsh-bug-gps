# rc.5 宿主依赖兼容

BugGPS 当前仅声明 DSH `0.2.1-rc.5`。本仓库的 `overrides` 固定开发环境中的 Zod；实际宿主和插件安装目录的依赖需要分别检查。独立 CLI 消费项目、开发仓库和完整宿主的审计结果各自记录。

[`test/fixtures/host-rc5/package.json`](../test/fixtures/host-rc5/package.json) 提供独立宿主的检查清单，使用 Node 24，保持 DSH 本身为 rc.5，并固定以下版本：

| 依赖 | 固定版本 | 依据 |
| --- | --- | --- |
| Zod | 4.6.7 | [上游版本](https://github.com/colinhacks/zod/releases/tag/v4.6.7)、[安全公告](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) |
| undici | 8.12.2 | [安全公告](https://github.com/advisories/GHSA-2m5v-pch6-74hx) |
| MCP client | 2.3.0 | [安全公告](https://github.com/advisories/GHSA-6prh-2h8m-c8cw) |
| fflate | 0.8.3 | [安全公告](https://github.com/advisories/GHSA-px8p-9vwx-vf98) |

此清单用于隔离的兼容检查。每次安装生成自己的锁文件，其他传递依赖的解析结果可能变化，需保留实际版本和锁文件指纹。它不改写桌面安装目录。

在仓库根目录运行以下 PowerShell 命令：

```powershell
npm.cmd install --prefix test/fixtures/host-rc5 --ignore-scripts --no-fund
npm.cmd audit --prefix test/fixtures/host-rc5 --omit=dev
$env:BUGGPS_DSH_DIR = (Resolve-Path test/fixtures/host-rc5).Path
node --test test/e2e/managed-process.test.mjs
$env:BUGGPS_E2E_TARBALL = '1'
node test/e2e/dsh-e2e.mjs
```

压缩包检查在任务自己的宿主目录中运行，使用脚本模型和植入问题示例，检查技能加载、工具注册、固定条件保护、错误修复仍失败和正确修复通过。宿主在首次请求前退出时，也会保存退出码、信号、有界错误片段和未执行检查，整体判为失败。

可将 `BUGGPS_E2E_STARTUP_IMPORT` 指向 `test/fixtures/host-startup-failure.mjs` 验证启动前失败控制。此时预期进程返回非零，记录中 `hostExit.code` 为 1、`requestLog.status` 为 `MISSING`，错误片段包含夹具消息，整体 `passed` 为 `false`。正常检查时应移除这个环境变量。

实际账户检查复用已经登录的官方账户，另行调用模型。可通过 `BUGGPS_LIVE_PACKAGE` 指定本地生成的 `.tgz`，验证实际压缩包；默认使用当前源码目录。原始事件应放在私有目录：

```powershell
New-Item -ItemType Directory -Force .buggps/host-check | Out-Null
$packed = npm.cmd pack --pack-destination .buggps/host-check --json | ConvertFrom-Json
$env:BUGGPS_LIVE_PACKAGE = (Resolve-Path (Join-Path .buggps/host-check $packed[0].filename)).Path
$env:BUGGPS_LIVE_RAW_DIR = (Join-Path (Resolve-Path .buggps/host-check).Path 'private-events')
npm.cmd run test:live-model
```

账户检查使用一次性示例项目及本次创建的唯一配置，保留固定条件、补丁及结构化结果；金额成本在服务未返回时为未知。分享前应检查结果中的路径和业务内容。演示素材沿用现有 GIF。

依赖审计反映检查时数据库中的已知公告。Zod 的长度约束能在解析超大集合前拒绝输入；未设置约束的集合仍会逐项解析。验证结论限定在实际执行的 BugGPS 流程和记录的依赖环境中。

English: this fixture checks BugGPS on DSH rc.5 with the exact versions above. Repository, standalone-package and host audits are separate. `BUGGPS_E2E_TARBALL=1` tests the packed plugin with a scripted model; `BUGGPS_LIVE_PACKAGE` selects a tarball for the optional signed-in account check. The fixture does not patch an installed desktop application. Keep each generated lockfile and the corresponding run record when reproducing results.
