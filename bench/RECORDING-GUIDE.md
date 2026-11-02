# 真实案例录制指南（S3 真实应用关）

三个历史 bug 都来自公开仓库，每个都有作者合并的修复提交。这些修复是**评测真值**：BugGPS 在有 bug 的版本上锁定复现，然后只应用真实修复，必须得到 `VERIFIED`；不修就不能得到。

| 案例 | 项目 | Bug | 真实修复 |
|---|---|---|---|
| `drawdb-943` | [drawdb](https://github.com/drawdb-io/drawdb)（40k★） | 设置里修改表格宽度后点「取消」，宽度仍被改掉 | [PR #943](https://github.com/drawdb-io/drawdb/pull/943)，改了 2 个文件 |
| `qwerty-842` | [qwerty-learner](https://github.com/RealKai42/qwerty-learner)（23.6k★） | 再点一次已选中的「章节选择」，章节列表消失 | [PR #842](https://github.com/RealKai42/qwerty-learner/pull/842)，改了 1 个文件 |
| `chartdb-896` | [chartdb](https://github.com/chartdb/chartdb)（23k★） | 修改字段类型后，旧默认值仍然保留 | [PR #896](https://github.com/chartdb/chartdb/pull/896)，改了 1 个文件、2 行 |

## 为什么要你亲手录

脚本会话的操作路径太"干净"。缩减到底有没有价值，取决于真人操作时的绕路、试探和多余点击。请按自己的习惯操作：多点点、走点弯路都没关系，**不要刻意走最短路径**。

## 步骤（每个案例约 3–5 分钟）

1. **准备**：只需一次。这一步会克隆仓库，并安装第三方依赖，安装时不运行 install 脚本。
   ```
   node bench/real.mjs setup drawdb-943
   ```
2. **启动有 bug 的版本**（保持这个终端开着）：
   ```
   node bench/real.mjs serve drawdb-943
   ```
3. **另开一个终端录制**，会弹出 Edge 窗口，右下角有 BugGPS 工具栏：
   ```
   node bin/buggps.js record --url http://127.0.0.1:5191/ --start /editor --out bench/real-recordings/drawdb-943.json
   ```
   - 随意操作，期间按 `real-cases.json` 里的 `recordHint` 让 bug 出现。
   - 用工具栏设定**正确的预期**：
     - 「预期文本」或「预期输入值」：点元素，在弹窗里填**正确值**，不是现在显示的错误值。
     - 「应可见」：在元素消失之前就点选它。
   - **刚做完触发 bug 的那一步时，点「⚑ 上一步是关键」**（例如 chartdb 里改类型那一步）。缩减时永远保留这一步。脚本实测中，不标记的话 3 个案例里有 2 个会被缩错。
   - 点「■ 结束」。
4. **评测**（自动完成）：先复现 3 次，再缩减；锁定后只应用真实修复并验证，最后恢复成有 bug 的代码。
   ```
   node bench/real.mjs check drawdb-943 bench/real-recordings/drawdb-943.json
   ```
   结果写在 `bench/results/real-<案例>-<时间>.json`。

另外两个案例把 `drawdb-943` 换成 `qwerty-842`（端口 5192，`--start /`）或 `chartdb-896`（端口 5193，`--start /`）即可。

## 判定标准（事先固定，不看结果再调）

- 复现：3 次都以同一失败签名失败，才算 `REPRODUCED`。
- 应用真实修复后：drawdb 和 chartdb 必须是 `VERIFIED`；qwerty 必须是 `NEEDS_REVIEW`，因为上游修法是禁用按钮，这种修法需要人确认。不修时必须是 `NO_CODE_CHANGE`。
- 判定以你的原始录制为准，缩减版只作参考（`agreesWithRecording`）。
- 缩减：如实记录 N→M；没缩短也照实写。
- 录制失败、找不到元素、环境问题都分别记录。这些就是首版要修的兼容性问题，不算失败的案例。

## 已知限制

- 记录的操作：点击、输入、选择、勾选、回车、Escape，以及"确实打开了菜单"的悬停。**不记录拖拽**（例如 drawdb 画布上的拖拽），也**不记录全局键盘输入**（例如 qwerty-learner 里练习打字）。这些操作对这三个 bug 没有影响。
- 仓库要放在短路径下（默认 `%LOCALAPPDATA%\Temp\bgr`）。原因是长路径会触发 Windows 的 MAX_PATH 限制：在很深的目录下，`git clone` 会因此失败。
