# DBML 导入索引类型案例

此夹具用于复核 ChartDB 历史版本中，DBML 声明的 GIN 索引被显示为默认 B-tree 的问题。固定条件包括索引名称 `body_search`、类型 `GIN`，以及导入前粘贴内容的完整一致性。

[账户流程记录](../../results/account-project-chartdb-dbml-index-2026-11-03.json) 使用 DSH CLI 0.2.1-rc.5。应用副本的 759 个已跟踪文件及文件模式与原始 Git 树一致，未复制参考修复历史；输入的可执行字段保持不变，移除了来源元数据。首次验证为 `NO_CODE_CHANGE`，修复后为 `VERIFIED`，新启动的原代码控制再次匹配失败。12 个既有 DBML 导入测试文件共 99 项，修复前后均通过。

这次 DSH 会话耗时 206.5 秒，包含锁定、读取、修改及验证；环境准备和应用回归另计。39 次工具调用中有一次文件搜索报错，金额成本未返回。原始会话、配置路径和账户凭据不公开。该案例属于已用于改进实现的扩展回归集，不能估算真实用户成功率。

## 复核补丁

在 BugGPS 源码目录中准备这个历史应用的锁定依赖：

```bash
node bench/setup-holdout.mjs chartdb-1089
node bench/replay-repair.mjs --check-only
node bench/replay-repair.mjs
```

需要 Git、Node、原项目所需包管理器和系统 Edge/Chrome。已有准备状态可通过 `BUGGPS_HOLDOUT_STATE` 指定。首次准备需要下载原项目与依赖。复核命令会创建任务拥有的临时工作区，校验输入与补丁指纹，检查原代码、无关改动、补丁和新启动的原代码控制，不调用模型；运行记录默认保存在未提交的 `.buggps/repair-replay/` 中。该命令复核固定补丁，不复现会话耗时或产生新的修复。

[首次命令复核记录](../../results/repair-replay-chartdb-dbml-index-2026-11-03.json)来自提交 `0970455`：原代码失败 3/3、无关改动失败 3/3、补丁通过 3/3、新启动的原代码再次匹配失败 3/3，受保护输入保持不变。运行耗时 158,746 ms，使用已安装依赖；环境首次准备耗时未包含在内。该记录与上面的实际会话记录分别保留。

## 文件与许可

- `input.json`：固定的脚本输入及验收条件。
- `repair.patch`：实际通过验收的补丁，只修改 DBML 导入器，保留并规范化受支持的索引类型。
- `fixture.json`：原始代码、输入、补丁及启动入口的指纹。
- `LICENSE`：ChartDB 原仓库的 GNU Affero General Public License version 3 原文；补丁及其源上下文按此许可提供。BugGPS 软件包的许可见根目录 `LICENSE`。

来源：[ChartDB 原始版本](https://github.com/chartdb/chartdb/tree/0b73295922f87b3b59bc8ef98b27a7328b6d66c0)，[对应许可证](https://github.com/chartdb/chartdb/blob/0b73295922f87b3b59bc8ef98b27a7328b6d66c0/LICENSE)。夹具目录不包含在 npm 软件包的 `files` 范围内。
