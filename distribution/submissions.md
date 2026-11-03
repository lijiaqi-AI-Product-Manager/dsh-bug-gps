# 独立目录申请材料

材料状态：准备中，未发送。对外提交前先核对默认分支、最终压缩包、版本和每个入口的最新规则。只引用公开材料，不上传本地执行日志、账户配置、业务截图或私有项目。

## 可复用字段

- 产品：BugGPS。
- 仓库：<https://github.com/lijiaqi-AI-Product-Manager/dsh-bug-gps>。
- 中文简介：录制浏览器问题、固定预期，并通过独立原代码对照复核修复。
- 英文简介：Records browser bugs, freezes expected results, and verifies fixes against a fresh original-code control.
- 许可：MIT。
- 宿主：DeepSeek Harness 0.2.1-rc.5；当前声明 headless / web，桌面入口待独立验收。
- 包名：`dsh-bug-gps`；当前尚未发布 npm，不将待发布包名填为已发布的安装来源。
- 图标与截图：仓库内 `assets/buggps-icon.png`、根 `screenshots.json`。默认分支资源实际存在后才提交绝对链接。
- 分类意图：浏览器调试、开发工具、问题复现与修复复核；按对方枚举映射。

## 入口差异

| 入口 | 提交内容 | 提交前置条件 |
| --- | --- | --- |
| [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md) | 导出的单个 YAML。 | 默认分支可运行、资源可访问；不加入 `npm` 或推荐字段，不修改生成的 README。 |
| [1024 Store](https://github.com/imsai-sh/awesome-deepseek-harness-plugins/blob/main/CONTRIBUTING.md) | 导出的分类 JSON。 | 无 npm 时只是浏览用途；验证发布的包与仓库映射后再主张可安装。 |
| [dshworks](https://github.com/dshworks/awesome-dsh-plugins/blob/main/CONTRIBUTING.md) | 导出的条目及其规则要求的生成文件。 | 保持 `unverified`；包名、版本、发布时间须来自实际 registry。 |
| [DSH Open Market](https://github.com/polang233/dsh-plugin-index/blob/main/.github/CONTRIBUTING.md) | 插件申请 Issue：仓库、许可、包或经确认的固定 Git 来源、版本及截图。 | 原生索引中检查实际兼容版本与安装来源；不把轮换曝光称为人工精选。 |
| [DSH Plugin Hub](https://dshpluginhub.dev/zh/submit) | 仓库公开元数据预检及登录后的候选申请。 | 候选队列与正式索引分开记录；不提交本地配置。 |
| [DSHX Hub](https://dshx.io/en/plugins) | 公开仓库、用途、安装路径与兼容证据。 | 普通收录与人工 Featured 分开；无需更换开发框架。 |
| [DSH Plugin Registry](https://dshplugin.app/submit) | 仓库 URL、可选公开说明；联系邮箱可不提供。 | 正常完成安全验证；`Indexed` 不能替代版本绑定的实际运行依据。 |
| [dsh.pub](https://dsh.pub/en/submit/) | 默认分支的仓库、bundle、入口、许可与 README。 | 资源就绪并正常完成验证码；对方固定完整提交后再跟踪公开 PR。 |
| [dsh.plus](https://www.dsh.plus/en/submit/) | 名称、仓库、分类、简介及联系邮箱。 | 准备最终材料及可公开使用的联系地址，按人工审核流程申请。 |
| [cordis.run](https://cordis.run/en) | 登录后填写已发布 npm 包和仓库。 | 先完成真实 npm 发布，安装命令使用已实测的官方 rc.5 语法。 |
| [dsh-TUI 生态目录](https://dshtui.com/plugins/) | 名称、显示名、简介、作者、仓库、可选 npm、标签、`kind: plugin`。 | 先确认实际适用范围、README 回链和身份规则；不自行设置 `featured`。 |
| [DSH-Store](https://github.com/AI-Scarlett/DSH-Store) / [TYEclipse](https://github.com/TYEclipse/dsh-plugins-hub) | 各自 Plugin Submission Issue 的必填字段。 | 逐项按当前表单填写，附实际版本和入口，不把一家市场的检查标签带到另一家。 |
| [DeepseekPlugin](https://deepseekplugin.org/en/docs/submit-plugin) | 单个公开仓库 URL，分类等从公开元数据提取。 | 默认分支、topic、README、许可和 patch 就绪；提交后另查实际详情和检索。 |
| [DSH Plugin Store](https://dshpluginstore.com/submit) | 仓库、英文简介、分类及可选兼容备注。 | 有真实 bundle 和可运行安装路径；邮箱可留空。 |
| [dshplugin.dev](https://dshplugin.dev/submit) | 仓库、可选备注与联系地址，同意公开仓库评阅政策。 | 不将初审或私有候选当作公开收录，收录后再添加真实条目徽章。 |
| [HackSing](https://github.com/HackSing/dsh-plugins/issues/new?template=submit-plugin.yml) | Primary value、Primary category、Installation and removal、Compatibility and verification 及表单勾选。 | 类别优先 `Tools & Capabilities / 工具与能力`；提供安装和卸载文档、rc.5 / Windows 的具体实测范围，其他组合注明未验收。推荐或案例展示按其贡献指南走 Discussions。 |
| [DSH Plugin Radar](https://github.com/AdamPlatin123/dsh-plugin-radar) | topic 或当前 `PLUGINS.md` 的登记 PR。 | 阅读当前模板，核对组织快照与镜像来源；兼容或推荐标签需要对方对应版本的依据。 |

DSH Directory、DSHToolkit 与 DSH Plugins Marketplace 的投稿页面或指定仓库尚需确认可用性，保持跟踪，不把访问失败判断成拒绝或不收录。Mayfly 社区目录另有 manifest、作者授权和前端能力协议；当前只记录入口，待其实际宿主与版本相容时再准备条目，不从示例复制不存在的工具、权限或已验证字段。

## 精选申请依据

提供一个完整可复核的外部案例：原问题、原预期、固定检查、补丁、候选验证及新建原代码对照。植入问题示例与外部案例分别标注，GIF 仅用于理解流程。若缩减没有收益，明确保留原路径。

同时提供安装要求、精确宿主范围、已知限制、失败分类、相关版本的检查链接及问题反馈入口。维护者可以判断其适用性，不能将材料准备或普通收录写成获得推荐。

有公开申请流程的按流程提交；没有单独精选入口的，通过其允许的普通投稿附一次事实性说明，不批量私信、不反复催促、不刷版本或交换 Star。获得标签后再引用对方实际页面和适用版本。

## 跟踪结果

每次外部动作记录入口、提交链接、日期、目标完整提交、实际包版本，以及检索、收录、安装、加载、任务和推荐的独立结果。自动发现入口只有查到具体项目页才记为已索引；共享上游入口也要分别检查缓存和可安装来源。
