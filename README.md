# BugGPS · dsh-bug-gps

**录一次 Bug，改到真修好为止。**
**Record the bug once. BugGPS won't let the agent say "fixed" until it is.**

> 状态：预发布，**还没发布到 npm**。下面的安装命令已在 DSH 0.2.1-rc.5（Windows 11）上实测过，用的是本地 checkout 和 `npm pack` 打出的 tarball。

## 它做什么

1. **录制**：BugGPS 打开浏览器，你操作一遍 bug，在工具栏上标出"正确应该是什么"，再标出关键步骤。
2. **锁定**：在当前代码上回放 3 次。只有 3 次都以同一种方式失败，才把用例锁定下来。锁定后的用例有内容哈希，并且写保护。同时会尝试缩短步骤，这一步只靠回放，不调用模型。
3. **修复**：DSH 的 agent 用常规工具修改代码。
4. **验证**：只有 `buggps_verify` 能判定是否修好。判定看你的完整录制，3 次回放都要满足预期。

判定结果有这几种：

| 判定 | 含义 |
|---|---|
| `VERIFIED` | 录制的场景在每次回放中都满足了预期 |
| `STILL_FAILING` | 还是原来那个失败 |
| `DIFFERENT_FAILURE` | 症状变了，但预期仍未满足 |
| `NEEDS_REVIEW` | 预期满足了，但前提是某个控件被禁用了，需要人确认这是不是正确的修法 |
| `NO_CODE_CHANGE` | 锁定之后代码没有改过 |
| `CASE_TAMPERED` | 锁定的用例被改动过，不给判定 |
| `TEST_INVALID` / `ENV_BLOCKED` / `FLAKY` | 录制无法回放 / 环境问题（不是代码问题）/ 多次回放结果不一致 |

`VERIFIED` 只覆盖录制的那个场景，不代表其它 bug 也没了。

## 环境要求

- DeepSeek Harness `>=0.2.1-0 <0.3.0`
- PATH 上有 **pnpm ≥10**：`dsh plugin` 会调用 pnpm
- 已安装 **Microsoft Edge 或 Google Chrome**。BugGPS 不会下载浏览器；找不到时直接报 `ENV_BLOCKED`
- 应用的 dev server 正在运行，例如 `npm run dev`
- 项目是一个 git 仓库：BugGPS 用 git 树哈希给代码状态做快照，不会改动你的 index 或工作区

## 安装（本地 checkout，已实测）

```bash
dsh plugin --profile <你的 profile> add <path-to-dsh-bug-gps>
```

```bash
dsh --profile <你的 profile> --dump-config
```

输出里应该有一行 `# == dsh-bug-gps`。`--profile` 是必填参数。在 Windows 上，如果 `DSH_HOME` 路径太深，会报 `ENAMETOOLONG`。

## 在 DSH 里用

对 agent 说"用 BugGPS 修这个 bug，dev server 在 http://localhost:5173/"。agent 会按内置的 `buggps` skill 依次调用这些工具：

| 工具 | 作用 |
|---|---|
| `buggps_record` | 打开浏览器让你录制，录完后保存草稿 |
| `buggps_lock` | 复现 → 缩短步骤 → 锁定 |
| `buggps_verify` | 判定是否修好 |
| `buggps_status` | 列出已锁定的用例，检查写保护、dev server 和浏览器是否可用 |

## 保护机制与已知限制

- **文件写入**：agent 通过 `write`、`edit`、`str_replace_editor` 写 `.buggps/` 会被直接拒绝。路径会先规范化，包括大小写、`..` 和 junction。
- **shell 写入**：shell 命令只能尽力拦截，挡不住所有写法，真正的防线是内容哈希。如果用例和锁文件被同时改写，在同一个 DSH 会话里也能检测出来。
- **加载失败**：DSH 加载插件失败时只打一行警告、照常运行。所以 `buggps_verify` 每次判定前都会先确认写保护已经生效。
- **录制范围**：会记录点击、输入、选择、勾选、回车、Escape，以及确实打开了菜单的悬停。不记录拖拽和全局键盘输入。
- **缩短步骤**：缩短后的步骤只是参考。实测中，不标记关键步骤时 3 个真实案例里有 2 个被缩错，所以判定始终以完整录制为准。

## 证据

- `bench/spike-s2-s3.md`：植入 bug 的示例，以及 3 个开源项目（drawdb、qwerty-learner、chartdb）的历史 bug，用上游的真实修复做验证。
- `spikes/s1-dsh/REPORT.md`：DSH 插件 API 实测。
- `node test/e2e/dsh-e2e.mjs`：在真实 DSH 上的端到端测试。模型是脚本化的，DSH 本身是真的。加 `BUGGPS_E2E_TARBALL=1` 则安装 `npm pack` 打出的 tarball。
- `npm test`：单元测试和集成测试。

## License

MIT
