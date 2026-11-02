# Spike S2 / S3 report（2026-11-01）

> **数据性质**：全部来自 `examples/cart-shop`（**植入 Bug 的示例应用**），会话由脚本驱动。录制器捕获的是真实 DOM 事件，但这**不是人工录制**，也**不是真实开源项目**。不能拿这些数字宣传"真实案例效果"。
> 原始数据：`bench/results/2026-11-01T10-32-55-010Z.json`，复现命令：`npm run bench`。

环境：Windows 11（10.0.26300）、Intel Core Ultra 7 255H、Node v24.22.0、playwright-core 1.64.1、系统自带 **msedge 156.0.4314.42**（未下载任何浏览器）。

## S2 浏览器执行：PASS（仅限本机）

| 检查 | 结果 |
|---|---|
| 用系统 Edge 启动，不下载 Chromium | PASS：`channel: 'msedge'`，回退顺序 `chrome` |
| 找不到浏览器时 | `EnvBlockedError`，附下一步提示，不会静默下载（测试覆盖） |
| 录制 → 回放 | 19 步会话，录制 1.2 s；回放 3/3 复现，用时 4.1 s |
| 每步的定位候选 | role+name / label / #id / testid，没有坐标；`dropped=0` |
| 仓库路径带空格（临时仓库 `buggps repo *`） | PASS（verify 测试） |
| dev server 未启动 | `ENV_BLOCKED`，第一次就停，不会计为复现 |

**未验证**：有头模式下真人操作的录制体验、iframe/Shadow DOM、文件上传、Chrome 渠道、macOS/Linux。

## S3 缩减可行性：在植入数据上通过；真实应用这一关仍未验证

| 案例 | 原始步数 | 策略 | 结果 | trial 次数 | 用时 | 模型调用 |
|---|---|---|---|---|---|---|
| stale-discount（折扣过期） | 19 | **units**（依赖感知） | **6**，已确认 3/3 | 32 + 3 次探测 | 20.7 s | 0 |
| stale-discount | 19 | ddmin（经典） | 15，**预算耗尽**（80 次） | 80 | 41.8 s | 0 |
| stale-discount | 19 | units + **loose 匹配** | **1（错误缩减）** | 22 | 16.3 s | 0 |
| changelog-crash（页面异常） | 13 | units | **4**，已确认 3/3 | 20 + 3 | 13.6 s | 0 |
| changelog-crash | 13 | ddmin | 4，已确认 3/3 | 32 | 17.5 s | 0 |
| flaky-total（不稳定） | 2 | — | 10 次中 6 次失败 → **FLAKY**，不进入缩减 | 10 | 4.3 s | 0 |

stale-discount 的 6 步结果正好是因果链：`打开 / Add Apple / Add Banana / 填 Coupon=SAVE10 / Apply coupon / Remove Apple`。

### 三条会改变设计的发现

1. **经典 ddmin 在 UI 轨迹上效果差**。因果步骤分散在噪声之间（加入 Cherry 后又移除、切页面后再切回），按块删除几乎每次都会破坏前置条件，或者改变失败值：80 次 trial 里 43 次"失败但签名不同"，26 次"步骤无法执行"。**依赖感知的 units 策略**（一次插桩回放，记录每步的目标在哪一步之后才变得可用；删除某步时连同依赖它的步骤一起删；候选并行测试再联合接受；每轮重新探测）用 32 次 trial 就找到了 6 步。现在 units 是默认策略，ddmin 保留作对照。
2. **失败签名必须包含实际观测值**。只比较"断言类型+目标"的 loose 匹配会把 19 步删到只剩"打开页面"：空购物车显示 $0.00，同样"不等于 $18.00"，但这已经是另一个现象。strict 模式要求观测值还是同一个 `$17.00`，这个错误被拦住了。测试 `loose matching accepts a wrong reduction` 把这个反例固定成回归用例。
3. **缩减不花 token，但花墙钟时间**。一次 trial 约 0.5–1.6 s（新 BrowserContext + 250 ms 稳定期），默认并发 4。真实 Vite 应用首屏更慢，预计会成倍增加，需要在真实应用上实测。

## 修复验证（RED → GREEN）：机制通过

临时 git 仓库里的 `test/verify.test.js` 全部通过：

| 情况 | 判定 |
|---|---|
| 代码没改 | `NO_CODE_CHANGE`（不可能是 VERIFIED） |
| 看似合理的错误修复（只把负数总价夹到 0） | `STILL_FAILING` |
| 改变了症状的修复（直接清零折扣 → $20.00） | `DIFFERENT_FAILURE` |
| 真修复 + 把锁定预期改弱 | `CASE_TAMPERED` |
| 真修复 | `VERIFIED` 3/3，产出 `--binary` 补丁（不含 `.buggps/`） |
| 快照 | 不改动 index 和工作区，能看到未跟踪文件 |

## 真实应用（2026-11-01/02）：3 个开源项目的历史 bug

> **数据性质**：**真实应用、真实历史 bug、上游真实修复**，但会话由**脚本**驱动（`bench/real-sessions.js`），**还不是人工录制**。原始数据在 `bench/results/real-*.json`，复现命令：`node bench/real.mjs check <case> <recording>`。

| 案例 | 复现（有 bug 的版本） | 缩减 | 应用上游真实修复后 | 缩减版是否与录制一致 |
|---|---|---|---|---|
| drawdb-943（取消后宽度仍被改） | 3/3，看到 `300`，预期 `220` | 12→9，20 次，48 s，**正确** | **VERIFIED**，补丁正好是上游 PR 改的 2 个文件 | 一致 |
| qwerty-842（再点「章节选择」后列表消失） | 3/3 | 9→3，21 次，34 s，**删错了** | **NEEDS_REVIEW**（上游修法是禁用已选中的按钮） | **不一致，已标出** |
| chartdb-896（改类型后默认值残留） | 3/3，看到 `0`，预期空 | 16→8，47 次，147 s，**删错了** | **VERIFIED**，2 行补丁 | **不一致，已标出** |
| qwerty-842 + 标记关键步骤 | 同上 | 9→3，17 次，**正确** | NEEDS_REVIEW | 一致 |
| chartdb-896 + 标记关键步骤 | 同上 | 16→9，42 次，**正确** | VERIFIED | 一致 |

### 结论 1：判定可靠，3/3 正确，没有误报 VERIFIED

### 结论 2：自动缩减**不能当卖点**，也**不能决定判定**

两次错误缩减属于同一类：**bug 的症状恰好等于"没触发 bug"时的正常状态**。
- qwerty："打开对话框再关掉"，章节同样"出现过、后来不可见"。
- chartdb：不改类型时，默认值本来就该保留 `0`。

最终状态里的失败签名一模一样。从最终状态出发，任何自动规则都区分不出来。所以设计改成：
- **验证以用户的原始录制为准**，缩减版只用于阅读和定位，并在每次验证时复核。不一致就标出 `agreesWithRecording: false`。
- **录制工具栏加「⚑ 上一步是关键」**：被标记的步骤，缩减时永远保留。实测标记后两个案例都缩对了。
- 对外叙事从"N 步缩到 M 步"改成"**录一次，改到真修好为止**"，缩减只作为一项辅助能力。

### 结论 3：「禁用触发按钮」这种修法需要人确认

qwerty 的上游修复本身是正确的，做法是禁用已选中的切换按钮。但同样的手法也能被拿来"修掉"任何 bug。BugGPS 把它判为 `NEEDS_REVIEW`，并列出被禁用的步骤。这是对外可以讲的一个具体差异点。

### 真实应用暴露并已修复的录制/回放问题（都有测试或真实案例覆盖）

| 问题 | 出现在 | 修法 |
|---|---|---|
| 悬停菜单不录 | drawdb | 只在悬停**确实弹出** menu/listbox 时记 hover；点击或输入会取消待定的 hover |
| `div` 卡片点击不录 | drawdb | React 会给有 onClick 的元素挂空 `onclick`，以此识别；取最近的可点击祖先 |
| 无名控件被丢弃 | drawdb、chartdb | 先用 placeholder 当名字；再在"有名字且唯一"的容器内按序号定位；最后只按角色 |
| 可访问名称与 Playwright 不一致 | drawdb（"plus 添加表"） | 子元素的 aria-label/alt 计入名称；回放时退回包含匹配，仍要求唯一 |
| 多个选项同名（都叫 "Toggle bold"） | chartdb | 角色 + 名称 + 内部带名字的图片 |
| Escape 关浮层不录 | chartdb | 记录页面级 `key Escape` |
| 关闭动画期间点击被吞 | chartdb | 每步之后等动画结束，最多 1 s |
| 慢应用超时，或缩减时超时过短 | chartdb | 回放默认 5 s；缩减超时取原始最慢一步的 2 倍，750 ms–5 s |
| 异步渲染导致"出现过"漏检 | qwerty | 每步后检查一次，外加 100 ms 后台轮询 |
| 依赖探测被动画、对话框遮挡误导 | qwerty | 探测前等动画结束；增加"最近启用者"成对删除 |
| 预期目标找不到被当成失败 | chartdb | 改判 `TEST_INVALID`，否则所有坏回放会共享同一签名 |
| Windows 长路径 | 本工作区 | git clone 和 PowerShell 5.1 写文件都失败过；真实仓库放到短路径。S1 在 DSH_HOME 上也遇到了 |

## 门槛结论

- **S1**（DSH 真实加载，独立会话完成）：**PASS**，见 `spikes/s1-dsh/REPORT.md`。插件、job、skill、写保护钩子都能在 0.2.1-rc.5 上跑通。需要处理的约束：插件加载失败时 DSH 静默降级；进程树要用 `ctx.subprocess` 清理；shell 写入拦不住，只能靠哈希兜底；`--profile` 是必填的；需要 PATH 上有 pnpm ≥10。
- **S2**：PASS（本机、3 个真实应用）。
- **S3**：判定这一关 **PASS**（3/3，无误报）。缩减**降级为辅助能力**：不标记时 3 个里只有 1 个缩对，标记关键步骤后 3 个都对。**人工录制还没做**，用的都是脚本会话。

## DSH 插件层（2026-11-01）：真实 DSH 0.2.1-rc.5 端到端 PASS

`src/dsh/` 包含 4 个工具、`buggps` skill，以及一个最终写保护钩子（`ctx.tools.guard`）。测试方法：`node test/e2e/dsh-e2e.mjs`。每次用全新的隔离 `DSH_HOME`，做一次真实的 `dsh plugin add`，再跑 `dsh --profile headless`。模型是**脚本化**的，其余全是真的。

| 检查 | 链接安装 | `npm pack` tarball |
|---|---|---|
| 安装、`--dump-config` 能看到这一层、无加载警告、退出码 0 | PASS | PASS（19 个文件，29 KB，pnpm 自动安装 playwright-core） |
| 4 个工具都提供给了模型；skill 出现在目录里，正文按需加载 | PASS | PASS |
| `buggps_status`：写保护已生效，msedge 156 可用 | PASS | PASS |
| `buggps_lock` → LOCKED（19→6 步，model_calls 0） | PASS | PASS |
| 什么都没改就 verify → NO_CODE_CHANGE | PASS | PASS |
| agent 用 `write` 写 `.buggps/cases/…` → 被写保护钩子拒绝；用例文件字节不变 | PASS | PASS |
| 错误修复 → STILL_FAILING；真修复 → **VERIFIED**（app.js 改了 4 行） | PASS | PASS |

一个回合约 56–61 秒。顺带发现一条 DSH 的规则：`edit` 之前必须先 `read`，否则直接报错。BugGPS 在这种情况下如实判为 `NO_CODE_CHANGE`，没有误判。

单元测试和集成测试 `npm test`：当时 46/46（2026-11-02 修正后为 59/59）。其中覆盖的路径规范化包括相对路径、Windows 反斜杠、大小写、`..`、真实 junction；也覆盖了在同一会话里同时改写用例和锁文件的检测，以及写保护未生效时拒绝判定。

## 2026-11-02：外部评审反例与修正

一份外部评审在原型上构造出 7 个"测试全绿、结论却不成立"的反例。逐个复现属实后，按下表修正，并把每个反例写成自动化测试（[test/counterexamples.test.js](../test/counterexamples.test.js) 等）。

| 反例 | 原来的结果 | 修正 | 现在的结果 |
|---|---|---|---|
| 仓库仍有 bug、只改说明文件；同一 URL 换成一份已修复的代码 | `VERIFIED` | 用例记录 `serve` 命令，锁定和验证时由 BugGPS 自己从工作区启动应用，前后各做一次树快照；没有 `serve` 时最多给 `PASSED_UNBOUND`；端口被占用时 `ENV_BLOCKED` | 外部 URL：`PASSED_UNBOUND`；托管：`STILL_FAILING` |
| 删掉按钮的处理逻辑，"不报错"就满足了 | `VERIFIED` | 只有"不报错"这类负向检查时，最多给 `NEEDS_REVIEW`（`negative-only`）；录制工具栏支持"不报错 + 正向预期"同时保留 | `NEEDS_REVIEW`；加正向预期后：`DIFFERENT_FAILURE`，真修复：`VERIFIED` |
| 把异常推迟 800 ms | 3 次通过 | 观察窗口：最后一步之后，所有检查都必须持续成立 `observeMs`（默认 1000 ms，写进用例、参与哈希） | `STILL_FAILING` |
| 两个仓库用同一个 case id | `CASE_TAMPERED`（误报） | 进程内记录按"真实路径 + case id"索引 | `NO_CODE_CHANGE` |
| 宿主目录与会话目录不同，经 junction 写入 | 未拒绝 | 守卫读取 DSH 会话目录（`workingDirectory.get(session)`），并检查所有用过的项目目录 | 拒绝 |
| 录制时输入密码 | 明文进入步骤 | 密码、验证码、卡号字段只存 `{secret: NAME}`；重放读环境变量 `BUGGPS_SECRET_NAME`，缺少时 `ENV_BLOCKED`；敏感字段不能设为预期 | 录制中无明文 |
| `npm ci` | 失败 | `@deepseek-ai/dsh-tools` 作为精确版本 devDependency 写进锁文件 | 干净目录 `npm ci` 退出码 0 |

另外两处证据质量问题：

- 真实应用基准把脚本录制标成 `human recording`。现在来源取自录制文件本身，旧结果的更正见 [results/PROVENANCE.md](results/PROVENANCE.md)。
- E2E 原来在整个回合结束后才读取用例哈希。现在模拟模型在每次请求到达时记录用例哈希，检查锁定后、写入尝试后、最后一次请求时和回合结束后四个时间点完全一致。

借这次修正新加了两项能力，评审没有直接要求，但属于同一类问题：

- **检查点**（`steps[i].check`）："此刻页面应为 …"。修复前后都必须成立，否则判为 `PRECONDITION_FAILED`，验证结果是 `DIFFERENT_FAILURE`。带检查点的步骤在缩减时一律保留。
- **定位漂移**：某个步骤的元素在锁定时能精确匹配，验证时只能靠模糊名称匹配找到，就判为 `NEEDS_REVIEW`（`locator-drift`）。例子：真修复的同时把按钮改了名。

### 修正后的真实应用复测（2026-11-02，托管启动）

这次复测由 BugGPS 自己从工作区启动各应用的 Vite，锁定和验证都绑定到工作区快照；用的是上游真实修复。输入是脚本录制，其中 qwerty 和 chartdb 是人工补标了关键步骤的版本（`*.pinned.json`），都不是真人录制。

| 案例 | 复现 | 缩减 | 锁定前验证 | 上游真实修复 | 缩减版一致 |
|---|---|---|---|---|---|
| drawdb-943 | 3/3 | 12 → 9 | `NO_CODE_CHANGE` | **`VERIFIED`** 3/3 | 是 |
| qwerty-842 | 3/3 | 9 → 3 | `NO_CODE_CHANGE` | `NEEDS_REVIEW`（`disabled-control`：上游修法就是让已选项不可再点） | 是 |
| chartdb-896 | 3/3 | 16 → 10 | `NO_CODE_CHANGE` | **`VERIFIED`** 3/3 | 是 |

没有出现误判为 `VERIFIED` 的情况。复测中暴露并修复了 4 个稳定性问题，修复前的失败结果原样保留，说明见 [results/PROVENANCE.md](results/PROVENANCE.md)：

1. **冷启动**：刚启动的 Vite 会在第一次重放时才编译懒加载的模块，导致步骤超时。改为每次托管启动后先完整重放一次做预热，宽松超时，结果丢弃。
2. **超时偏短**：本机负载高（同时开着其他桌面应用）时，重型应用加载一个视图要好几秒，超过了原来的步骤超时。调整如下：
   - 复现和验证的步骤超时从 5 s 提高到 10 s，只在目标确实缺失时才会多等；
   - 导航超时提高到 45 s；
   - 页面加载超时改判 `ENV_BLOCKED`，不再算 `TEST_INVALID`；
   - 缩减用的自适应超时下限提高到 2 s。
3. **定位漂移误报**：菜单或弹层动画期间，精确名称短暂匹配不到，被模糊匹配抢先命中，结果误报 `locator-drift`。现在精确候选持续失败 1.5 s 后才允许模糊匹配。
4. **待机打断**：其中一次 drawdb 验证途中电脑进入了新型待机（系统日志 12:50:36–13:00:44），结果是 `BUDGET_EXHAUSTED`。这个结果是安全的：没有给出判定，更没有误判通过。

耗时：每个案例 2–6 分钟，主要花在缩减上。`buggps_lock` 里的缩减预算为 90 s，到时间就返回已确认的最好结果。

评审建议里没有采纳或暂缓的：

- **由插件自己起一个修复子 agent（预算、轮次、受限工具）**：暂缓。DSH agent 本身就是修复者，判定和证据绑定已经由验证工具控制。在插件里再套一层模型调用，会引入未经实测的 DSH API 和第二套配置。等真实模型试用暴露出具体问题再做。
- **"禁用已选项是合法修法"由用户确认后自动通过**：暂不采纳。确认动作在对话里由 agent 转述，插件无法区分是用户确认还是模型自己确认的。保持 `NEEDS_REVIEW`，由用户看补丁决定。
- **验证时在独立 worktree 里再跑一遍基线（严格负向对照）**：暂缓，已在 README 的限制中写明。真实项目需要为第二份工作区安装依赖，代价高。RED 已经是在 BugGPS 启动的基线代码上得到的。

## 下一步（按风险排序）
1. **人工录制 3 条**（指南见 `bench/RECORDING-GUIDE.md`）：检验真人操作时的录制兼容性，以及关键步骤标记好不好用。
2. **真实模型试用一次**：用你自己的 DeepSeek 配置在 `dsh web` 里跑完整流程。目前模型只用过脚本化的版本。
3. 定位证据：source map、React 组件名、仓库检索；用三个案例的上游修复文件作为定位真值。
4. 报告卡（HTML），以及演示素材。
