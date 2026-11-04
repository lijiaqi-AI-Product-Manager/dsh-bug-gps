# 安装与移除 / Install and remove

registry 中尚无目标版本时，使用下面的固定 Git 源码；npm 命令只用于已经真实发布的版本。[发布清单](https://github.com/lijiaqi-AI-Product-Manager/dsh-bug-gps/issues/4)记录当前状态，[运行依据](verification/1.0.0/README.md)区分安装、工具执行与其他验收范围。

## 固定源码

先准备 DSH 0.2.1-rc.5、Git、PATH 中的 pnpm ≥10，以及系统 Edge 或 Chrome。独立 CLI 最低 Node 20.0.0 已实测，DSH 宿主验收环境使用 Node 24；不将前者当成所有宿主组合的保证。

下面以 `web` 为例；使用无界面实例时，将两处 Profile 名称改为该实例实际使用的 `headless`。桌面实例的 Profile 和内置版本应独立确认，当前记录不替代桌面验收。

```bash
dsh plugin --profile web add 'git+https://github.com/lijiaqi-AI-Product-Manager/dsh-bug-gps.git#9f256807809e4780d6f22ff6491c7a125ef5de82'
dsh --profile web --dump-config
```

确认输出包含 `dsh-bug-gps` 配置层，重启对应实例，在目标 Git 项目中调用 `buggps_status`。完整任务还需要应用开发服务和 `buggps.config.json` 的独立 `serve` 配置；配置层出现只表示配置写入，工具注册及任务执行分别确认。

本地 checkout 或当前 `npm pack` 得到的 `.tgz` 也可作为 `add` 的来源。正式 npm 发布后，再使用对应已存在版本的 npm 安装命令，不把待发布包名当作现在可下载的来源。

## 升级已有场景

当前采集协议为 `buggps.capture/v2`，检查器为 `buggps.oracle/v10`。升级后应重新录制旧的浏览器草稿；不通过补填版本号迁移。录制中的全部文本、输入值和可见性检查保存原始观察状态，锁定时必须逐次匹配，防止遗漏操作后绑定另一种失败。无法定位的动作、采集异常或写入确认失败会保留为录制问题，草稿不可锁定。

旧的已锁用例与运行记录继续保留，但不能直接作为新检查器下的当前修复依据。结构化编写的草稿仍可使用原有格式，验收条件由项目需求确定。完整流程应重新建立原代码失败、候选通过与新建原代码对照，不降低断言或跳过失败步骤。

## 已发布 npm 版本

先确认官方 registry 已存在 `dsh-bug-gps@1.0.0`，再执行以下命令；版本不存在时使用上面的固定 Git 来源。

```bash
dsh plugin --profile web add dsh-bug-gps@1.0.0
dsh --profile web --dump-config
```

npm 安装后同样需要重启对应实例并调用 `buggps_status`。发布后的 registry 冷安装记录与本地 tarball、Git 安装记录分别保存。

## 移除

对安装时使用的同一个 Profile 执行：

```bash
dsh plugin --profile web remove dsh-bug-gps
dsh --profile web --dump-config
```

确认依赖和配置层移除后，重启该实例。项目中的 `.buggps` 场景、补丁及运行产物继续保留；卸载插件不会替你删除这些项目资料。需要清理时，由项目所有者明确选择具体内容。

## English

Use the pinned Git source above when the requested version is absent from the registry. Run the npm command only after `dsh-bug-gps@1.0.0` actually exists. The release checklist records availability; Git, tarball and registry installation evidence have separate scopes. Use the Profile your running instance actually owns; restart it after adding or removing the plugin. Git, pnpm ≥10, a system Chrome/Edge and an application serve configuration are required.

The standalone CLI was checked at Node 20.0.0; the DSH host checks use Node 24. A configuration layer in `--dump-config` confirms configuration, while `buggps_status` and the complete task check tool registration and execution. Desktop acceptance remains separate.

Re-record older browser drafts after upgrading to capture protocol `buggps.capture/v2` and evaluator `buggps.oracle/v10`; adding a version field is not a migration. Recorded text, values and visibility must match their captured original states before locking. Missing action targets, capture errors and unconfirmed writes keep a draft incomplete. Preserve earlier cases and records as history, then establish fresh evidence with the current evaluator. Structured authored cases retain their existing format.

The commands use `web`; use `headless` instead for a headless instance. Remove the package from the same Profile with `dsh plugin --profile web remove dsh-bug-gps`. Verify that its dependency and configuration layer are gone, then restart. Existing project cases, patches and run artifacts remain in the project. The [historical evidence](verification/1.0.0/README.md) identifies its own source and distinguishes installation, execution and directory admission.
