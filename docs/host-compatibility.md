# rc.5 宿主依赖兼容

BugGPS 当前仅声明 DSH `0.2.1-rc.5`。本仓库的 `overrides` 固定开发环境中的 Zod；实际宿主和插件安装目录的依赖需要分别检查。独立 CLI 消费项目、开发仓库和完整宿主的审计结果各自记录。

[`test/fixtures/host-rc5/package.json`](../test/fixtures/host-rc5/package.json) 提供独立宿主的检查清单，使用 Node 24，保持 DSH 本身为 rc.5，并固定以下版本：

| 依赖 | 固定版本 | 依据 |
| --- | --- | --- |
| Zod | 4.6.7 | [上游版本](https://github.com/colinhacks/zod/releases/tag/v4.6.7)、[安全公告](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) |
| undici | 8.12.2 | [安全公告](https://github.com/advisories/GHSA-2m5v-pch6-74hx) |
| MCP client | 2.3.0 | [安全公告](https://github.com/advisories/GHSA-6prh-2h8m-c8cw) |
| fflate | 0.8.3 | [安全公告](https://github.com/advisories/GHSA-px8p-9vwx-vf98) |

此清单用于隔离的兼容检查，并提供完整锁文件。使用 `npm ci` 按锁安装，保留实际版本和锁文件指纹；更新依赖后需重新运行检查。它不改写桌面安装目录。

在仓库根目录运行以下 PowerShell 命令：

```powershell
npm.cmd ci --prefix test/fixtures/host-rc5 --ignore-scripts --no-audit --no-fund
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

账户检查使用一次性示例项目及本次创建的唯一配置，记录固定条件与补丁的指纹及结构化结果。示例工作区会清理；此入口不导出完整补丁，独立项目的可重放补丁另有[案例说明](../bench/repairs/chartdb-dbml-index/README.md)。金额成本在服务未返回时为未知，分享前应检查结果中的路径和业务内容。

## 已执行的限定检查

[兼容记录](../bench/results/host-rc5-compatibility-2026-11-03.json)分别记录开发仓库和宿主夹具的审计、4 项受控进程检查、15 项脚本模型压缩包检查，以及首次请求前退出的负向控制。两个依赖审计均为 0 条已知公告；此结论不覆盖现有桌面安装目录。

实际账户使用 `deepseek-account / deepseek-flash`，安装本地生成的压缩包，检查结果如下：

| 检查 | 结果 | 依据 |
| --- | --- | --- |
| 修正流程指引前的优惠计算任务 | 未完成 | 停在 `NO_CODE_CHANGE`，没有应用修改或 `VERIFIED`；[失败记录](../bench/results/live-provider-rc5-baseline-9cfc279-2026-11-03.json)保留 |
| 修正后的同一优惠计算任务 | `VERIFIED` | 会话 162,423 ms，10 次工具调用，候选 3/3 通过，原代码对照匹配原失败，固定条件未变 |
| 禁用按钮以规避错误的候选 | `NEEDS_REVIEW` | 会话 90,611 ms，断言虽通过，禁用交互仍需业务判断，未计为确认修复 |

后两项的[结构化账户记录](../bench/results/live-provider-rc5-a696fe2-2026-11-03.json)包含源提交、压缩包指纹、工具判定、用量及受保护条件指纹。时长只计对应会话，准备工作另计；金额成本未知。这些是植入问题示例及脚本输入，不能估算真实用户成功率。前一次未完成任务的唯一根因尚未确定。

依赖审计反映检查时数据库中的已知公告。Zod 的长度约束能在解析超大集合前拒绝输入；未设置约束的集合仍会逐项解析。验证结论限定在实际执行的 BugGPS 流程和记录的依赖环境中。

English: this fixture checks BugGPS on DSH rc.5 with the exact versions above. Repository, standalone-package and host audits are separate. `BUGGPS_E2E_TARBALL=1` tests the packed plugin with a scripted model; `BUGGPS_LIVE_PACKAGE` selects a tarball for the optional signed-in account check. The fixture does not patch an installed desktop application. Keep each generated lockfile and the corresponding run record when reproducing results.

持续集成的 `host-rc5` 作业运行锁定依赖安装、两种依赖审计、受控进程检查、压缩包完整流程和启动失败控制。实际账户检查另行显式运行。
