# BugGPS · dsh-bug-gps

**简体中文** · [English](docs/i18n/README.en.md) · [日本語](docs/i18n/README.ja.md) · [한국어](docs/i18n/README.ko.md) · [Deutsch](docs/i18n/README.de.md) · [Français](docs/i18n/README.fr.md) · [Español](docs/i18n/README.es.md) · [Português (Brasil)](docs/i18n/README.pt-BR.md)

**录下问题，按原预期复核修复。**
**Record the bug. Verify the fix against the original expectation.**

DeepSeek Harness（DSH）插件。你在浏览器里把 bug 操作一遍，标出“正确应该是什么”；BugGPS 把它锁成一个会失败的检查，修复后由 BugGPS 自己启动应用、按原条件重放，只有全部检查都通过才给出 `VERIFIED`。

![BugGPS 演示：录制 bug → 锁定 → 错误修复被驳回 → 真修复通过](docs/media/buggps-demo.gif)

<sub>演示由脚本操作仓库自带的植入 bug 示例，并应用预置的错误和正确修改。页面与工具结果来自实际运行，采用关键帧剪辑；片长不代表任务耗时。结果卡片为演示排版，光标与字幕叠加。查看 [本次场景与运行摘要](docs/media/demo-run.json)；真实 DSH 集成另见测试说明。重新生成：`npm run demo:gif`（需要 ffmpeg）。也有 [MP4 版本](docs/media/buggps-demo.mp4)。</sub>

> 状态：预发布，**还没发布到 npm**。下面的命令已在 DSH 0.2.1-rc.5 / Windows 11 上实测，使用本地 checkout 或 `npm pack` 打出的包。

可直接使用经过验证的固定 Git 版本，见 [安装与移除](docs/installation.md)。当前版本的 [运行依据](docs/verification/1.0.0/README.md)记录 238 项检查、固定案例组、实际账户场景和分发路径，并区分各自的验证范围。

## 试用内置示例

首次从源码试用，使用已整合的预发布候选分支，再准备依赖。候选仍在验收中，阻断项见 [发布清单](https://github.com/lijiaqi-AI-Product-Manager/dsh-bug-gps/issues/4)：

```bash
git clone --branch fix/tool-output-preview --single-branch https://github.com/lijiaqi-AI-Product-Manager/dsh-bug-gps.git
cd dsh-bug-gps
npm ci
```

```bash
node bin/buggps.js demo ../buggps-demo
```

它会生成一个带植入 bug 的小商店（独立 git 仓库，已配置 `buggps.config.json`），并打印下一步：启动 `npm run dev`，然后在 DSH 里让 agent 用 BugGPS 修 bug。

```bash
node bin/buggps.js doctor --repo ../buggps-demo
```

检查 Node、git、系统 Edge/Chrome、pnpm、dsh、serve 配置和端口。

## 流程

录制工具栏默认简体中文，可切换英语、日语、韩语、德语、法语、西班牙语和巴西葡萄牙语。输入值、应消失、不应报错、检查点和关键步骤在「更多检查」中。选取页面元素时面板自动收起，确认或取消后恢复；Esc 可以取消选取。已设置的预期、检查点与关键步骤持续显示，语言、位置和收起状态跨页保留。

结束前会确认已发送的记录。缺少正向预期、输入不受支持或确认超时都会显示原因；保留未完成记录不会得到修复已验证的结论。可查看 [中文界面](docs/media/toolbar/zh-CN.png) 与 [英文界面](docs/media/toolbar/en.png)。截图由脚本操作内置植入问题示例，展示录制与预期设置，没有执行修复验证；从源码重新生成：`npm run demo:toolbar`。

1. **录制**（`buggps_record`）：浏览器打开，你操作一遍，在工具栏上标出：
   - **预期**：文本 / 输入值 / 应可见 / 应消失 / 不应报错。先标“不应报错”再标一个正向预期时，两个都会保留。
   - **检查点**（可选）：“此刻页面应为 …”。修复前后都必须成立，防止修复绕过你录下的情境；缩减步骤时也不会删掉它。
   - **关键步骤**（可选）：缩减时永远保留。
   - 识别为密码、验证码、卡号或 token 的输入字段和文本域只保存引用；重放时从环境变量 `BUGGPS_SECRET_<名字>` 读取。同名字段使用独立引用，再次填写同一字段时复用原引用。
   - 每份草稿使用独立标识保存，中文名称作为显示信息保留。重新锁定场景时使用新的 case id，已有用例不会被覆盖。
   - 保存初始窗口尺寸、语言、时区和像素比例。录制期间的窗口尺寸变化作为关键步骤保留，用于重放响应式布局问题。
2. **锁定**（`buggps_lock`）：BugGPS 用 `serve` 命令**自己启动应用**，在当前代码上默认重放 3 次，全部以同一种方式失败才锁定。锁定的用例有内容哈希，并且写保护。同时尝试缩短步骤，只靠重放，不调用模型。
3. **修复**：DSH 的 agent 用常规工具改代码。
4. **验证**（`buggps_verify`）：BugGPS 再次从工作区启动应用，默认重放你的**完整录制** 3 次。最后一步后先检查所有条件，再在观察窗口内按 50 ms 目标间隔重复检查（默认观察 1000 ms）；任一采样失败就不通过。运行记录保留实际采样次数和最大间隔。该检查不覆盖采样间隙及观察窗口以外的状态变化。

## 可复核的外部案例

ChartDB 的 DBML 导入曾将 GIN 索引显示为默认 B-tree。DSH 0.2.1-rc.5 在未提供参考补丁或修复历史的应用副本中修改一个源文件：候选通过 3/3，新启动的原代码再次匹配失败 3/3；12 个既有 DBML 导入测试文件共 99 项，前后均通过。会话耗时 206.5 秒，包含锁定、读取、修改和验证，环境准备及应用回归另计。

查看 [实际账户流程记录](bench/results/account-project-chartdb-dbml-index-2026-11-03.json)、[输入、补丁与复核命令](bench/repairs/chartdb-dbml-index/README.md)和 [输入校验修复后的补丁重放](bench/results/repair-replay-case-input-2026-11-03.json)。后一次重放耗时 497,334 ms，使用已安装依赖且没有模型调用；原代码、无关改动、候选及新启动的原代码控制均执行 3 次。两类运行分别记录，不把固定补丁重放当作新的独立修复。这一案例已用于改进实现，不能估算真实用户成功率。

## `buggps.config.json`

```json
{
  "serve": {
    "command": ["npm", "run", "dev", "--", "--port", "5199", "--strictPort"],
    "url": "http://127.0.0.1:5199/"
  },
  "observeMs": 1000
}
```

- `serve` 是 BugGPS 自己运行的命令，在仓库根目录执行，只接受 localhost 地址。端口要与你平时开发用的不同：录制时你的 dev server 照常运行，锁定和验证时 BugGPS 用自己的端口。端口被占用时直接报 `ENV_BLOCKED`，不会把别的服务器的结果当成证据。
- 锁定时 `serve` 会写进用例并参与哈希计算，之后修改配置文件不会影响已锁定的用例。
- CLI 与插件工具使用相同的配置校验。`observeMs` 在建立场景时覆盖输入草稿中的观察窗口；插件显式传入的 `observe_ms` 优先。锁定后验证使用保存的条件，不重新套用当前项目配置。

已有草稿可以直接锁定。字符串检查默认严格相等；需要验证动态文件名时，可在锁定前明确声明 `comparison: "startsWith"` 与固定前缀。`count` 检查使用一个明确的集合选择器和整数 `equals`，例如检查收藏入口数量。这些条件均参与用例指纹，不由修复过程自动放宽。检查器升级后，缺少兼容依据的旧锁需要重新确认和锁定。

## 判定

| 判定 | 含义 |
|---|---|
| `VERIFIED` | 候选版本的完整录制在全部配置次数中满足所有检查（默认 3 次），独立基线对照也重新出现锁定的原失败；补丁是锁定基线到候选代码的差异 |
| `PASSED_UNBOUND` | 检查通过了，但服务器不是 BugGPS 启动的，证明不了它运行的是这份补丁。没有 `serve` 时最多只能得到这个 |
| `NEEDS_REVIEW` | 检查通过了，但证据弱于“修好了”，需要人判断。原因见 `review_reasons`：<br>`disabled-control`：录制的操作打到了被禁用的控件<br>`negative-only`：仅检查不报错、目标消失或零匹配，仍缺少正向结果<br>`locator-drift`：动作、检查点或预期改用了其他定位候选，或旧记录缺少定位依据；需要重新确认场景<br>`evaluator-changed`：检查器版本与原失败记录不同，需在原代码上重新建立失败依据，另存新用例，保留旧记录<br>`baseline-not-reproduced`：独立基线对照未能重新出现锁定的原失败 |
| `STILL_FAILING` | 还是原来那个失败 |
| `DIFFERENT_FAILURE` | 症状变了但预期仍未满足，或者录制的检查点不再成立 |
| `NO_CODE_CHANGE` | 锁定后代码未变；修复任务继续修改和复验，仅验证的任务报告未变 |
| `CASE_TAMPERED` | 锁定的用例被改动过，不给判定 |
| `STALE` | 验证过程中文件发生了变化 |
| `TEST_INVALID` | 案例定义、定位器或录制无法执行；不作为应用故障 |
| `ENV_BLOCKED` | 环境问题，不是代码问题：浏览器、端口、dev server 或未提供的 secret |
| `FLAKY` | 多次重放结果不一致 |
| `BUDGET_EXHAUSTED` | 预算已耗尽，证据尚未齐备 |
| `ABORTED` | 任务已取消，不给出修复成功结论 |

**`VERIFIED` 只覆盖录制的那个场景。** 它不证明其它 bug 不存在。

`buggps_status` 按完成时间显示最近的有效运行。历史结果只有在代码、用例、锁定清单与检查器仍匹配时才标记为当前适用；`not_current_reasons` 说明不匹配的原因。`NO_CODE_CHANGE` 保留“代码未变”的判定，不表示修复成功。

工具文本预览最多 12,000 字符，优先显示判定、证据引用和下一步。看到 `output_preview: abbreviated` 时，按引用读取完整草稿、用例、运行记录或补丁。完整结构化结果和验收数据保持原样，不从省略的预览重建测试或采用补丁。

## 环境要求

- DeepSeek Harness **0.2.1-rc.5**。当前兼容声明仅覆盖这个已验收版本；扩大范围前会补充兼容记录
- PATH 上有 **pnpm ≥10**：`dsh plugin` 会调用 pnpm
- 已安装 **Microsoft Edge 或 Google Chrome**。BugGPS 不会下载浏览器
- Node ≥20，git；项目是 git 仓库

## 安装（本地 checkout，已实测）

```bash
dsh plugin --profile <你的 profile> add <path-to-dsh-bug-gps>
```

```bash
dsh --profile <你的 profile> --dump-config
```

输出里应该有一行 `# == dsh-bug-gps`。`--profile` 是必填参数。在 Windows 上，`DSH_HOME` 路径太深时会报 `ENAMETOOLONG`。

重启对应的 DSH 实例，在目标项目中调用 `buggps_status`，确认工具实际可用。`--dump-config` 中出现配置行只表示配置已经写入，不等于工具成功注册。

**桌面版与命令行的 profile 可能不同。** `--profile web` 只用于实际使用该 profile 的实例，不能据此确认桌面版已经安装。桌面版应先确认其内置 DSH 版本和实际 profile，再使用应用自己的插件管理入口。当前已完成的是官方 rc.5 CLI 的加载与执行验收；桌面安装路径仍待独立验收。

## 保护机制与已知限制

- **用例写保护**：`write`、`edit`、`str_replace_editor` 写 `.buggps/` 会被拒绝。拦截前会先规范化路径，包括大小写、`..`、junction，以及会话工作目录与进程目录不同的情况。
- **shell 写保护只能尽力**：shell 命令挡不住所有写法。内容哈希用于一致性检查；同一会话保存的用例和完整锁定清单指纹可识别定义、基线及原失败记录的改动。重启后没有独立可信锚点，不能将哈希当成不可伪造证明。
- **快照范围**：基于 git，包含未跟踪文件，不包含被 `.gitignore` 忽略的文件（如 `node_modules`、`.env`）。依赖或本地配置的变化不算在补丁里，也不会被检测到。
- **预热**：BugGPS 每次启动应用后，会先把录制完整重放一次再开始计数。这一次用宽松超时，结果丢弃，作用是让 Vite 这类按需编译的服务器把用到的模块先编译好。所以录制里的操作不能改动服务端数据；目前只支持状态都在浏览器里、每次都能重置的应用。
- **进程管理**：插件通过 DSH 的 `subprocess` 服务启动服务器并等待整个受控进程范围退出，取消信号覆盖启动、预热和回放。CLI 使用本地进程模式；若启动器退出后留下无法清理的后台服务，会返回 `ENV_BLOCKED`，不宣称停止成功。这类启动方式应通过 DSH 插件执行。
- **负向对照**：候选检查通过且没有其他审阅原因时，会在独立 Git worktree 中重新运行锁定快照。对照必须再次出现相同失败，否则为 `NEEDS_REVIEW`（`baseline-not-reproduced`）。根目录的 `node_modules` 作为共享依赖，未跟踪的 `.env*` 作为复制的环境输入，单独记入记录；不共享构建产物。其他忽略文件及特殊启动方式可能使对照受阻。worktree 用于代码分离，不是安全沙箱。
- **禁用控件**：“把触发按钮禁用”这类修法永远需要人工确认，不会自动通过。
- **定位依据**：保存动作与断言实际采用的候选，包括观察窗口内的变化。精确名称也可能换到另一个同名元素；出现新的候选时需要审阅。旧锁缺少这些记录时应重新录制、确认和锁定。稳定定位器本身不证明业务语义未变。
- **范围定位**：`within` 容器必须唯一，内部索引不能掩盖多个同名容器；集合检查也保留这一约束。范围写法只支持 `role` 与 `text` 候选，不支持的写法返回 `TEST_INVALID`。有等待预算的动作会先给原范围最多 1500 ms 的就绪机会，再使用内容相同的全页后备候选；更短的调用超时优先。独立 ID 等其他精确候选不受此等待影响，零时快照不增加等待。真正换候选仍需审阅。
- **执行截止时间**：复现与缩减的 `maxMs` 包含当前回放、缩减的初始计时、依赖探测和最终确认。到期会停止当前上下文中的等待，返回 `BUDGET_EXHAUSTED`；主动取消返回 `ABORTED`。单次回放默认上限 180 秒，复现默认总上限 180 秒，缩减默认总上限 120 秒（插件锁定流程为 90 秒）。每个上下文额外最多等待 2 秒清理；未完成的清理会明确报告，不能据此确认成功。缩减未能完成规定次数的同失败确认时保留原路径，不能将一次失败的候选当成已确认缩减。
- **多项检查**：失败指纹包含全部最终检查的结果、通过项的定位候选及各自的失败依据。缩减不能只保留主失败，却破坏原先通过的附加条件或换到另一个候选。建立失败依据时，任何不可执行检查都返回 `TEST_INVALID`，不被较早的业务失败遮蔽；观察期内检查从可执行变为不可执行仍按场景失败处理。
- **可见性历史**：每个 `visible` 条件单独记录实际出现的目标，包含步骤间采样和最终检查。目标后来从 DOM 移除时，记录明确使用 `priorResolution` 表示较早的定位依据；不把它描述为当前仍可定位，也不借用其他条件的出现历史。步骤间采样忽略模糊名称，短于采样间隔的变化可能无法捕获。
- **网络检查**：`no-failed-request` 包含 HTTP 4xx/5xx 和浏览器报告的请求失败。请求摘要移除 URL 用户信息、查询与片段；不覆盖返回 2xx 的业务错误。
- **宿主依赖**：当前支持范围为 rc.5，本仓库、独立消费项目和完整宿主的依赖分别审计。[宿主兼容清单与复核命令](docs/host-compatibility.md)记录隔离环境的版本约束和检查方法。
- **录制范围**：会记录点击、输入、选择、勾选、输入框回车、按钮空格键、Escape、窗口尺寸变化、浏览器全屏退出，以及确实打开了菜单的悬停。全屏退出和尺寸变化保留为关键步骤。不记录拖拽和其他全局键盘输入；iframe、多标签页、下载和系统对话框尚未验收。
- **代码编辑器输入**：Monaco 支持先全选、再粘贴的整段替换；回放触发编辑器自身的粘贴处理，不读取或改写系统剪贴板。保留字符串剪贴板格式及顺序，载荷合计上限 1 MiB、最多 32 种格式。识别为敏感字段时只支持纯文本引用，不保存格式化载荷。相邻短标题能唯一标识输入区时，会优先生成范围选择器；缺少唯一依据仍会报告歧义。局部粘贴、逐键编辑及尚未适配的富文本输入会标记录制不完整，CLI、插件与核心锁定均拒绝采用。旧 Monaco `fill` 不作为保真输入回放，需要重新录制；检查器更新为 v8，旧锁与历史运行保留。
- **操作就绪**：新录制保存控件操作时是否可用。原来可用的控件在回放时会等待其恢复可用，受当前步骤超时、总预算和取消约束；超时仍禁用时继续记录为受阻动作，不把禁用按钮当成修复成功。原来禁用的动作与缺少该元数据的历史录制保留既有处理。嵌套文本若与唯一按钮同名，新录制只保留该按钮范围并等待其出现，不提前采用画布或输入代码中的全页同名文本。
- **同名图标选项**：重复的控件名称若能由唯一命名图像区分，新录制会保留原动作标签和该图像。只接受原标签，以及它与图像名称前后组合的精确匹配，不扩大为任意包含匹配；操作名称改变、图像重复或目标不唯一时仍拒绝采用。
- **缩短步骤**：结果是“已验证过的较短路径”，不保证最短，也不代表因果链。判定始终以完整录制为准。
- **实测范围**：Chromium 系浏览器、Vite、可重置的前端状态与 DOM 断言；已保留 React、Vue 的具体历史案例和结果，框架兼容以实际场景为准。

## 证据

- `npm test`：单元测试和集成测试。其中 [test/counterexamples.test.js](test/counterexamples.test.js) 覆盖了“检查通过但问题仍未修复”的回归场景：
  - 换一台服务器
  - 删掉功能来消除报错
  - 把报错推迟 800 ms
  - 修复绕过检查点
  - 改名导致模糊匹配
  - 两个仓库用同一个 case id
- `node test/e2e/dsh-e2e.mjs`：在真实 DSH 上做端到端测试。模型是脚本化的，DSH 本身是真的。加 `BUGGPS_E2E_TARBALL=1` 则安装 `npm pack` 打出的包。
- `npm run test:live-model`：真实 DSH 0.2.1-rc.5 与现有账号的模型工作流，包含独立读取、修改源码后验证，以及遇到 `NEEDS_REVIEW` 时保留原判定。输入为植入问题示例的脚本录制，参见 [运行记录](bench/results/live-provider-rc5-a696fe2-2026-11-03.json)与 [宿主兼容记录](docs/host-compatibility.md)。运行需要显式提供宿主安装目录，不随普通回归自动消耗模型调用。
- [bench/RECORDING-GUIDE.md](bench/RECORDING-GUIDE.md)：冻结的 12 个历史案例及复核入口。应用版本、脚本输入、环境失败与上游修复结果分别记录；这类运行不调用模型。
- [bench/spike-s2-s3.md](bench/spike-s2-s3.md)：植入问题示例与 3 个早期开发案例的历史记录，不属于独立案例集。
- [spikes/s1-dsh/REPORT.md](spikes/s1-dsh/REPORT.md)：DSH 插件 API 实测。

## 开发

```bash
npm ci
```

```bash
npm test
```

`@deepseek-ai/dsh-tools` 是可选的宿主 peer，开发测试使用固定版本。独立 CLI 安装不会自动安装宿主工具依赖树；插件运行时由 DSH 提供该模块。依赖审计应同时检查开发仓库和全新消费项目安装的压缩包，不能从其中一个结果推断另一个。

[插件目录、市场适配与推荐规则](docs/distribution.md) · [收录条目与资源检查](distribution/README.md)

## License

BugGPS 软件包：MIT。ChartDB 历史案例的源上下文与补丁按 [AGPLv3](bench/repairs/chartdb-dbml-index/LICENSE) 提供，该夹具不进入 npm 文件范围。

<!-- project-growth:start -->

## 项目增长

Star 历史每天自动更新。更新日期采用 UTC，Star 日期沿用 GitHub 聚合口径。

<a href="https://github.com/lijiaqi-AI-Product-Manager/dsh-bug-gps/stargazers">
<picture>
  <source media="(max-width: 600px) and (prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/lijiaqi-AI-Product-Manager/lijiaqi-AI-Product-Manager/main/assets/growth/dsh-bug-gps/stars-mobile-dark.svg">
  <source media="(max-width: 600px)" srcset="https://raw.githubusercontent.com/lijiaqi-AI-Product-Manager/lijiaqi-AI-Product-Manager/main/assets/growth/dsh-bug-gps/stars-mobile-light.svg">
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/lijiaqi-AI-Product-Manager/lijiaqi-AI-Product-Manager/main/assets/growth/dsh-bug-gps/stars-dark.svg">
  <img src="https://raw.githubusercontent.com/lijiaqi-AI-Product-Manager/lijiaqi-AI-Product-Manager/main/assets/growth/dsh-bug-gps/stars-light.svg" width="960" alt="BugGPS · GitHub Star 历史">
</picture>
</a>

此项目没有发布对应的 npm／PyPI 包，暂不展示包下载统计。

[数据来源与统计口径](https://github.com/lijiaqi-AI-Product-Manager/lijiaqi-AI-Product-Manager/blob/main/docs/growth.md)

<!-- project-growth:end -->
