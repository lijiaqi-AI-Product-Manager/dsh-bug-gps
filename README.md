# BugGPS · dsh-bug-gps

**录下问题，按原预期复核修复。**
**Record the bug. Verify the fix against the original expectation.**

DeepSeek Harness（DSH）插件。你在浏览器里把 bug 操作一遍，标出“正确应该是什么”；BugGPS 把它锁成一个会失败的检查，修复后由 BugGPS 自己启动应用、按原条件重放，只有全部检查都通过才给出 `VERIFIED`。

![BugGPS 演示：录制 bug → 锁定 → 错误修复被驳回 → 真修复通过](https://raw.githubusercontent.com/lijiaqi-AI-Product-Manager/dsh-bug-gps/main/docs/media/buggps-demo.gif)

<sub>演示用的是仓库自带的示例应用，里面有故意植入的 bug。浏览器画面和工具输出都来自真实运行，光标和字幕是后期叠加的。重新生成：`npm run demo:gif`（需要 ffmpeg）。也有 [MP4 版本](https://github.com/lijiaqi-AI-Product-Manager/dsh-bug-gps/blob/main/docs/media/buggps-demo.mp4)。</sub>

> 状态：预发布，**还没发布到 npm**。下面的命令已在 DSH 0.2.1-rc.5 / Windows 11 上实测，使用本地 checkout 或 `npm pack` 打出的包。

## 一分钟试用（内置示例）

```bash
node bin/buggps.js demo ../buggps-demo
```

它会生成一个带植入 bug 的小商店（独立 git 仓库，已配置 `buggps.config.json`），并打印下一步：启动 `npm run dev`，然后在 DSH 里让 agent 用 BugGPS 修 bug。

```bash
node bin/buggps.js doctor --repo ../buggps-demo
```

检查 Node、git、系统 Edge/Chrome、pnpm、dsh、serve 配置和端口。

## 流程

1. **录制**（`buggps_record`）：浏览器打开，你操作一遍，在工具栏上标出：
   - **预期**：文本 / 输入值 / 应可见 / 应消失 / 不应报错。先标“不应报错”再标一个正向预期时，两个都会保留。
   - **检查点**（可选）：“此刻页面应为 …”。修复前后都必须成立，防止修复绕过你录下的情境；缩减步骤时也不会删掉它。
   - **关键步骤**（可选）：缩减时永远保留。
   - 密码、验证码、卡号等字段**不会写入录制**，只存一个引用；重放时从环境变量 `BUGGPS_SECRET_<名字>` 读取。
2. **锁定**（`buggps_lock`）：BugGPS 用 `serve` 命令**自己启动应用**，在当前代码上重放 3 次，3 次都以同一种方式失败才锁定。锁定的用例有内容哈希，并且写保护。同时尝试缩短步骤，只靠重放，不调用模型。
3. **修复**：DSH 的 agent 用常规工具改代码。
4. **验证**（`buggps_verify`）：BugGPS 再次从工作区启动应用，重放你的**完整录制** 3 次。每次都要在最后一步之后持续满足所有检查（默认观察 1000 ms）。

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

## 判定

| 判定 | 含义 |
|---|---|
| `VERIFIED` | BugGPS 从当前工作区启动应用，你的完整录制 3 次都满足全部检查；补丁正好是锁定基线到这份代码的差异 |
| `PASSED_UNBOUND` | 检查通过了，但服务器不是 BugGPS 启动的，证明不了它运行的是这份补丁。没有 `serve` 时最多只能得到这个 |
| `NEEDS_REVIEW` | 检查通过了，但证据弱于“修好了”，需要人判断。原因见 `review_reasons`，有三种：<br>`disabled-control`：录制的操作打到了被禁用的控件<br>`negative-only`：只检查了“不报错”，删掉这个功能也会通过<br>`locator-drift`：元素只能靠模糊名称匹配找到 |
| `STILL_FAILING` | 还是原来那个失败 |
| `DIFFERENT_FAILURE` | 症状变了但预期仍未满足，或者录制的检查点不再成立 |
| `NO_CODE_CHANGE` | 锁定之后代码没有变化 |
| `CASE_TAMPERED` | 锁定的用例被改动过，不给判定 |
| `STALE` | 验证过程中文件发生了变化 |
| `TEST_INVALID` | 录制无法重放 |
| `ENV_BLOCKED` | 环境问题，不是代码问题：浏览器、端口、dev server 或未提供的 secret |
| `FLAKY` | 多次重放结果不一致 |

**`VERIFIED` 只覆盖录制的那个场景。** 它不证明其它 bug 不存在。

## 环境要求

- DeepSeek Harness `>=0.2.1-0 <0.3.0`，实测版本：0.2.1-rc.5
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

## 保护机制与已知限制

- **用例写保护**：`write`、`edit`、`str_replace_editor` 写 `.buggps/` 会被拒绝。拦截前会先规范化路径，包括大小写、`..`、junction，以及会话工作目录与进程目录不同的情况。
- **shell 写保护只能尽力**：shell 命令挡不住所有写法，真正的防线是内容哈希。同一会话里锁定过的用例，即使用例和锁文件被一起改写也能识别出来。
- **快照范围**：基于 git，包含未跟踪文件，不包含被 `.gitignore` 忽略的文件（如 `node_modules`、`.env`）。依赖或本地配置的变化不算在补丁里，也不会被检测到。
- **预热**：BugGPS 每次启动应用后，会先把录制完整重放一次再开始计数。这一次用宽松超时，结果丢弃，作用是让 Vite 这类按需编译的服务器把用到的模块先编译好。所以录制里的操作不能改动服务端数据；目前只支持状态都在浏览器里、每次都能重置的应用。
- **负向对照**：锁定时的失败（RED）是在 BugGPS 启动的基线代码上得到的。验证时不会再把基线单独跑一遍。
- **禁用控件**：“把触发按钮禁用”这类修法永远需要人工确认，不会自动通过。
- **录制范围**：会记录点击、输入、选择、勾选、回车、Escape，以及确实打开了菜单的悬停。不记录拖拽和全局键盘输入。
- **缩短步骤**：结果是“已验证过的较短路径”，不保证最短，也不代表因果链。判定始终以完整录制为准。
- **实测范围**：React + Vite、Chromium 系浏览器、可重置的前端状态、DOM 断言。其他环境没有经过验收。

## 证据

- `npm test`：单元测试和集成测试。其中 [test/counterexamples.test.js](test/counterexamples.test.js) 覆盖了“检查通过但问题仍未修复”的回归场景：
  - 换一台服务器
  - 删掉功能来消除报错
  - 把报错推迟 800 ms
  - 修复绕过检查点
  - 改名导致模糊匹配
  - 两个仓库用同一个 case id
- `node test/e2e/dsh-e2e.mjs`：在真实 DSH 上做端到端测试。模型是脚本化的，DSH 本身是真的。加 `BUGGPS_E2E_TARBALL=1` 则安装 `npm pack` 打出的包。
- [bench/spike-s2-s3.md](bench/spike-s2-s3.md)：植入 bug 的示例，以及 3 个开源项目（drawdb、qwerty-learner、chartdb）的历史 bug，用上游的真实修复做验证。录制来源都如实标注：目前都是脚本录制，还没有真人录制。
- [spikes/s1-dsh/REPORT.md](spikes/s1-dsh/REPORT.md)：DSH 插件 API 实测。

## 开发

```bash
npm ci
```

```bash
npm test
```

`@deepseek-ai/dsh-tools` 是可选的宿主 peer，开发测试使用固定版本。独立 CLI 安装不会自动安装宿主工具依赖树；插件运行时由 DSH 提供该模块。依赖审计应同时检查开发仓库和全新消费项目安装的压缩包，不能从其中一个结果推断另一个。

## License

MIT
