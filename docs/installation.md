# 安装与移除 / Install and remove

registry 中尚无目标版本时，使用下面的固定 Git 源码；npm 命令只用于已经真实发布的版本。[发布清单](https://github.com/lijiaqi-AI-Product-Manager/dsh-bug-gps/issues/4)记录当前状态，[运行依据](verification/1.0.0/README.md)区分安装、工具执行与其他验收范围。

## 固定源码

先准备 DSH 0.2.1-rc.5、Git、PATH 中的 pnpm ≥10，以及系统 Edge 或 Chrome。独立 CLI 最低 Node 20.0.0 已实测，DSH 宿主验收环境使用 Node 24；不将前者当成所有宿主组合的保证。

下面以 `headless` 为例；使用 Web 实例时，将两处 Profile 名称改为该实例实际使用的 `web`。桌面实例的 Profile 和内置版本应独立确认，当前记录不替代桌面验收。

```bash
dsh plugin --profile headless add 'git+https://github.com/lijiaqi-AI-Product-Manager/dsh-bug-gps.git#0a2148647119ad81795b0ed3d9cfa512bf3b928c'
dsh --profile headless --dump-config
```

确认输出包含 `dsh-bug-gps` 配置层，重启对应实例，在目标 Git 项目中调用 `buggps_status`。完整任务还需要应用开发服务和 `buggps.config.json` 的独立 `serve` 配置；配置层出现只表示配置写入，工具注册及任务执行分别确认。

本地 checkout 或当前 `npm pack` 得到的 `.tgz` 也可作为 `add` 的来源。正式 npm 发布后，再使用对应已存在版本的 npm 安装命令，不把待发布包名当作现在可下载的来源。

## 已发布 npm 版本

先确认官方 registry 已存在 `dsh-bug-gps@1.0.0`，再执行以下命令；版本不存在时使用上面的固定 Git 来源。

```bash
dsh plugin --profile headless add dsh-bug-gps@1.0.0
dsh --profile headless --dump-config
```

npm 安装后同样需要重启对应实例并调用 `buggps_status`。发布后的 registry 冷安装记录与本地 tarball、Git 安装记录分别保存。

## 移除

对安装时使用的同一个 Profile 执行：

```bash
dsh plugin --profile headless remove dsh-bug-gps
dsh --profile headless --dump-config
```

确认依赖和配置层移除后，重启该实例。项目中的 `.buggps` 场景、补丁及运行产物继续保留；卸载插件不会替你删除这些项目资料。需要清理时，由项目所有者明确选择具体内容。

## English

Use the pinned Git source above when the requested version is absent from the registry. Run the npm command only after `dsh-bug-gps@1.0.0` actually exists. The release checklist records availability; Git, tarball and registry installation evidence have separate scopes. Use the Profile your running instance actually owns; restart it after adding or removing the plugin. Git, pnpm ≥10, a system Chrome/Edge and an application serve configuration are required.

The standalone CLI was checked at Node 20.0.0; the DSH host checks use Node 24. A configuration layer in `--dump-config` confirms configuration, while `buggps_status` and the complete task check tool registration and execution. Desktop acceptance remains separate.

Remove the package from the same Profile with `dsh plugin --profile headless remove dsh-bug-gps`. Verify that its dependency and configuration layer are gone, then restart. Existing project cases, patches and run artifacts remain in the project. The [versioned evidence](verification/1.0.0/README.md) distinguishes installation, execution and directory admission.
