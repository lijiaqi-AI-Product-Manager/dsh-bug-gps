# 插件目录与市场分发

BugGPS 的目标发布版本为 1.0.0；当前仍在准备，尚未发布 npm。检索、收录、安装和推荐分别核对，不将一种状态当作另一种。规则核对日期：2026-11-04。

仓库已设置双语功能说明及 `dsh-plugin`、`dsh`、`deepseek-harness` 等相关 topic。包声明 `dsh.bundle.patch`、真实 JavaScript 入口、MIT 许可、准确的仓库映射和精确 DSH 兼容范围，安装不依赖构建脚本。市场元数据声明 `headless` / `web`；需要重启，并配置目标项目、Git、已有浏览器和开发服务。桌面路径尚未完成独立验收，不提前声明。

[`screenshots.json`](../screenshots.json) 控制两张已有界面截图的顺序，中文在前、英文在后。截图展示植入问题示例的录制和预期设置，不表示截图本身完成了修复验证。市场图标为 [180 像素 PNG](../assets/buggps-icon.png)，另保留 [SVG 源文件](../assets/buggps-icon.svg)。

## 共享目录与原生发现

| 入口 | 数据来源与需要完成的事 | 当前状态 |
| --- | --- | --- |
| [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md) / [官网](https://awesome-dsh-plugin.com) | 单独 YAML；真实 bundle、公开源码、仓库满一天、topic、事实性双语描述。icon 用 GitHub 托管位图，截图由插件仓库声明。 | [条目与导出命令](../distribution/README.md)已准备，待最终默认分支后提交。 |
| [dsh-market](https://github.com/dsh-market/dsh-market#submit-your-plugin) / [dshmarket.com](https://dshmarket.com/zh/) | 使用上述目录；按其上游收录，避免重复投稿市场程序仓库。 | 等待上游收录，不宣称已上架。 |
| [DSH 原生自定义市场](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md) | rc.5 的 `@deepseek-ai/dsh-plugin-market-index` 使用 format 1；目录生成器提供索引，无需在 BugGPS 内加入市场服务。awesome 的生成器会跳过没有 npm 包、版本或发布时间的条目；独立 Git 索引也可使用完整提交。 | npm 正式发布后核对目录索引与实际安装来源。 |
| [dsh-find-plugin](https://github.com/awesome-dsh-plugin/dsh-find-plugin) | 搜索 GitHub topic，并可补充 awesome 目录描述。 | topic 已设置，等待实际索引结果。 |
| [PetCT 市场](https://github.com/PetCT/dsh-plugin-marketplace)及其他声明使用 awesome 数据的客户端 | 共享 `plugins.json`，通常不需要为插件增加运行时适配层。 | 上游收录后分别查询，不能把共享源数当成独立安装数。 |
| [DeepSeekDSH](https://deepseekdsh.com/zh/plugins/explore) | 官网明确使用 awesome 的发现数据及 YELEBAI 的独立安装结构记录；两者更新分开。该站不重新分发第三方安装命令。 | 通过共享上游接入，另查详情和对应版本的记录。 |
| [1024 Store](https://github.com/imsai-sh/awesome-deepseek-harness-plugins/blob/main/CONTRIBUTING.md) / [deepseek1024.com](https://deepseek1024.com/) | 一个分类 JSON；核对默认分支 manifest 与补丁。最新贡献规则和安装端将无 npm 条目作为浏览用途，不能把网页收录当成一键可装。 | 条目已准备；npm 发布与安装入口待核对。 |
| [dshworks](https://github.com/dshworks/awesome-dsh-plugins/blob/main/CONTRIBUTING.md) / [dsh.works](https://dsh.works/awesome-dsh-plugins/) | 结构化 JSON 与生成 README；自动发现只是候选队列，需要维护者接纳。原生索引仅纳入已确认 npm 身份和 bundle 的条目。 | 条目以 `unverified` 准备；编辑精选需单独认可。 |

## 自动发现与组合来源

以下入口已有公开的发现规则或源码说明。topic 已完成只是接入条件，是否已采集需要在对方实际搜索结果中确认。

| 入口 | 依据与适配 |
| --- | --- |
| [DSH Plugins Marketplace](https://github.com/bradeGithub/DSH-Plugins-Marketplace/blob/main/STANDARD.md) | topic 与插件声明；真实入口、版本、仓库映射、宿主 peer、无安装脚本。无需加入其内部验证标签。 |
| [DSH Plugins Store](https://github.com/ZASENJC/dsh-plugins-store) / [dshmk.com](https://dshmk.com/) | 同时要求 `dsh-plugin` 与 `deepseek-harness`；两者均已设置。 |
| [dshfind](https://github.com/hikariming/dshfind) / [dshfind.com](https://dshfind.com/) | 每日 topic 同步；编辑说明与 Featured 是另一层状态。 |
| [DSH Index](https://dshindex.dev/) / [Marketplace](https://github.com/lijma/dsh-plugin-marketplace) | topic 候选、观察到的趋势与社区反馈分开；明确不认证或推荐插件。无“推荐资格”可自行申请。 |
| [DSH Hub](https://dshhub.dev/submit) | topic、安装命令、许可证；支持 Issue 或 PR 补充。首页 Star / 周增长展示不等于通过了运行验收。 |
| [DSH Market](https://github.com/2BingLing/dsh-market/blob/master/CONTRIBUTING.md) / [dsh.market](https://dsh.market/) | topic 自动发现，或提交插件 Issue；可提供作者简介、安装命令与数据更正。评分标签按对方规则产生。 |
| [DSH Plugin](https://dsh-plugin.org/zh/submit) / [客户端](https://github.com/dshplugin/dsh-plugin-hub) | topic、根清单、`apply` 入口、安装与权限说明；网站可收录源码，客户端安装入口要求 npm。 |
| [DSH 中文社区导航](https://plugin.dshx.dev/about/) | 公开 manifest 或可执行安装路径；人工精选与静态“检测到 manifest”标记分开。 |
| [DSH Plugin Store](https://dsh.wink.run/) | topic 及社区目录；Featured 区域的 Star 排序不构成编辑认可。 |
| [岚叔插件目录](https://github.com/cclank/dsh-plugin-hub) | 社区清单、topic 与根 manifest；“岚叔严选”绑定维护者审阅的具体提交。 |
| [dsh-hub.cc](https://github.com/sliverp/dsh-hub-plugin) | topic 或发布页面；确认仓库默认分支和安装方式。 |
| [统一市场](https://github.com/jing-hy/dsh-unified-market) | 合并 awesome、GitHub topic 与 npm；通过公共元数据接入，不重复建立运行时协议。 |
| [deepseek404 插件商店](https://dsh.deepseek404.com/) | 声明聚合 GitHub 插件，并链接 `dsh-plugin` topic。页面显示自身快照日期；未确认独立投稿入口和更新周期，不能将 topic 设置当作已经收录。 |
| [DeepseekPlugin](https://deepseekplugin.org/en/docs/submit-plugin) | 公开仓库 URL；以 topic、bundle 或明确的 DSH 说明识别，读取公开 README、许可与元数据。页面声明识别后发布，但需实际查询项目页确认，不把识别当作运行验收。 |
| [DSH Directory](https://dsh.directory/about) | topic 或仓库投稿，按默认分支包路径检测静态 bundle，信号不合成为质量认证。本次首页和提交页未能完成实时读取，投稿可用性保留待核实。 |
| [DSH Plugin Radar](https://github.com/AdamPlatin123/dsh-plugin-radar) | 当前源码说明由组织管线生产快照，本仓承载镜像与社区登记。topic 自动发现或 `PLUGINS.md` PR；镜像、兼容记录和推荐分别核对，不照搬搜索缓存中的旧身份。 |

## 独立申请与精选

| 入口 | 真实流程与推荐边界 |
| --- | --- |
| [DSH Open Market](https://github.com/polang233/dsh-plugin-index/blob/main/.github/CONTRIBUTING.md) / [dshopen.org](https://dshopen.org/zh/) | 插件申请 Issue；公开 npm 或经确认的固定 Git 来源、许可、bundle、截图与实测信息。首页轮换、增长与编辑判断各有规则，不用反复发版刷标签。 |
| [DSH Plugin Hub](https://dshpluginhub.dev/zh/submit) | 预检公开元数据；登录后进入候选雷达，候选与正式市场隔离。提交成功不等于搜索中已上架。 |
| [dsh.pub](https://dsh.pub/en/submit/) | 默认分支固定到完整提交，校验根 bundle、入口、README 和许可后走公开 PR。网站有验证码；按正常提交路径完成，不绕过。 |
| [dsh.plus](https://www.dsh.plus/en/submit/) | 人工审核表单：名称、仓库、分类、说明、联系邮箱；编辑精选单独判断。 |
| [DSH-Store](https://github.com/AI-Scarlett/DSH-Store) | Plugin Submission Issue，读取公开仓库并按其 Catalog 规则审核；客户端和官网的索引状态分开核对。 |
| [DSH Hub](https://dsh-hub.org/) | 页面存在 Featured 标记，尚未确认公开的通用申请规则；保持跟踪，不编造提交 API。 |
| [cordis.run](https://cordis.run/en) | 登录提交 npm 包及仓库，校验 bundle 后人工审核；安装命令以当前官方 rc.5 实测为准，不照抄旧宿主命令。 |
| [DSH Market](https://dshmarket.ai/plugins/) | 编辑精选、包版本和兼容说明分别展示；公开通用推荐申请流程尚未确认。 |
| [DSH Plugin Leaderboard](https://github.com/sandbaseai/dsh-plugin-store) | 独立 Catalog 与客户端；依据实际公开接口和条目规则核对，不自报评分或下载安装量。 |
| [TYEclipse 清单](https://github.com/TYEclipse/dsh-plugins-hub) | Plugin Submission Issue，附 release、许可和安装命令；对方有独立的安装及工具调用流程。 |
| [DSHX Hub](https://dshx.io/en/plugins) / [精选](https://dshx.io/en/featured) | 提交公开 GitHub 仓库，目录补充包、兼容范围和来源。Featured 是运营者人工挑选，强调兼容和持续维护，不是自动 Star 排名；未确认单独的公开精选申请表。收录不要求把 BugGPS 改写为 DSHX 项目。 |
| [DSH Plugin Registry](https://dshplugin.app/submit) | 公开仓库 URL 必填，邮箱和备注可选，无需账户；提交页有安全验证。`Indexed` 与版本绑定的 `Runtime Verified` 分开，提供实际 rc.5 记录供对方判断，不自行申请为已验收状态。 |
| [dsh-TUI 生态目录](https://dshtui.com/plugins/) / [贡献说明](https://github.com/dsh-tui-ecosystem/dsh-tui-site/blob/main/CONTRIBUTING.md) | `public/plugins/plugins.json` 的 PR 或在线表单。官网额外要求 README 回链、真实扩展关系和仓库身份；先核对 rc.5 环境中工具与技能可用性，再提供准确的适用范围。不得复制仅适合 TUI 皮肤的兼容说明，也不自行设置编辑推荐。 |
| [DSH Plugin Store](https://dshpluginstore.com/submit) | 人工收录表单：仓库、英文优先简介、分类；兼容说明与邮箱可选。要求真实 bundle、topic 与可用安装说明。 |
| [dshplugin.dev](https://dshplugin.dev/submit) | 仓库、可选联系与说明，并同意公开仓库评阅政策。通过初审仍是私有候选，之后才进入校验与发布队列；实际收录后才使用其徽章。 |
| [HackSing 目录](https://github.com/HackSing/dsh-plugins/blob/main/CONTRIBUTING.md) | 新插件只接受指定 Submission Issue，不接受新增条目的 PR。表单要求安装与卸载、实际宿主范围和未验证部分；推荐或展示走 Discussions。目录编辑内容采用 CC BY 4.0，不改变所链接源码的许可。 |
| [DSHToolkit](https://dsh.thyfwq.com/submit/) | 网站指向 `dshtoolkit/directory` 的申请 Issue，提供仓库、英文简介、分类并要求近期维护；该仓库本次通过 GitHub API 返回 404。先确认有效投稿渠道，不向其他仓库替代投稿。 |
| [DSH Plugins Marketplace](https://dsh-plugins-mp.com/) | 搜索结果能看到项目详情，但本次官网实时读取超时，独立投稿路径尚未确认。其展示的 HackSing 等仓库是被索引的项目，不能据此认定这些仓库就是市场数据上游。 |
| [Mayfly 社区目录](https://github.com/Ephemeral-AI-Lab/dsh-plugins/blob/main/registry/community/README.md) | 独立 manifest PR、固定 Git 或 npm 来源、真实能力与 surface 声明，还要求作者在自己的仓库公开链接申请以确认授权。其前端与宿主组合尚未验收，只记录为有条件入口，不增加兼容层或声明支持。 |

## 评测目录与其他精选清单

[dsh.so](https://www.dsh.so/)、[dshbase](https://dshbase.com/zh/plugins/directory/)、[dpharness](https://dpharness.com/plugins) 的安装或运行标记必须对应实际宿主与插件版本。部分现有基线早于 rc.5；遇到旧版本不兼容应提供 rc.5 证据并申请复测，不扩大 `engines.dsh` 来获取标记。

[深鲸插件港](https://dshplugins.org/)会聚合 topic、npm 和多个精选来源；静态快照不能保证即时收录。[DSH 手册](https://dshtool.cn/plugins/)以精选条目和 npm 下载展示为主；其条目数与下载量均不等于 DSH 活跃安装。

其他已核查的公开清单包括 [libukai](https://github.com/libukai/awesome-deepseek-harness)、[0xsline](https://github.com/0xsline/awesome-deepseek-harness)、[vvlife](https://github.com/vvlife/awesome-deepseek-harness-plugins)、[walkinglabs](https://github.com/walkinglabs/awesome-deepseek-harness-plugins)、[kejixiaoliang](https://github.com/kejixiaoliang/awesome-dsh-plugins)、[bruc3van](https://github.com/bruc3van/awesome-dsh-plugin)、[web-casa](https://github.com/web-casa/Awesome-DeepSeek-Harness-Plugins)、[cccakeee](https://github.com/cccakeee/awesome-dsh-plugins)、[GordenSun](https://github.com/GordenSun/awesome-dsh-plugins)、[white0dew](https://github.com/white0dew/awesome-dsh-plugins)与 [diegosouzapw](https://github.com/diegosouzapw/awesome-omni-dsh-plugins)。逐个遵循其贡献文件，不向不相关的金融、主题、桌宠或纯技能目录投稿。

这些清单的具体入口不同，名称带 awesome 不表示都接受修改 README 的 PR：

| 清单 | 已核实的贡献路径与限制 |
| --- | --- |
| [bruc3van](https://github.com/bruc3van/awesome-dsh-plugin/blob/main/CONTRIBUTING.md) | 作者自荐只改 `SHOWCASE.md` 的中英列表，一次一个仓库；要求真实 Star **超过 10**，完整列表最多 30 条，首页预览最近 10 条。自荐与编辑精选分开。BugGPS 核查时为 1 Star，当前不满足自荐门槛，不提前申请或自设推荐。 |
| [web-casa](https://github.com/web-casa/Awesome-DeepSeek-Harness-Plugins/blob/main/CONTRIBUTING.md) | 清单是生成结果；新插件走 `cordis.run/submit`，不修改生成 README 或 `data/plugins.json`。与 cordis.run 按共享来源归并。 |
| [vvlife](https://github.com/vvlife/awesome-deepseek-harness-plugins/blob/main/CONTRIBUTING.md) | topic 进入每日生成的 `PLUGINS.md`；人工分类 README 是单独 PR 路线，不能将自动发现称为精选。 |
| [0xsline](https://github.com/0xsline/awesome-deepseek-harness/blob/main/contributing.md) | 手选条目要求属于其组织生态或成员项目；公开 topic 另可进入全量目录。其指南说明 `dsh-external` 组织已转私有，本次 hub API 返回 404；不把私有上游当作可公开投稿的入口。 |
| [walkinglabs](https://github.com/walkinglabs/awesome-deepseek-harness-plugins/blob/main/CONTRIBUTING.md) | 按源码层面的 DSH 规则提供中性描述和兼容范围，在所属章节按字母排序。 |
| [kejixiaoliang](https://github.com/kejixiaoliang/awesome-dsh-plugins/blob/main/CONTRIBUTING.md) | 在 `plugins/<分类>.md` 增加条目，不照搬其他目录的生成文件或旧 manifest 示例。 |
| [white0dew](https://github.com/white0dew/awesome-dsh-plugins/blob/main/CONTRIBUTING.md) | 更新 `data/sources/` 来源快照并生成内容，不手改生成的 TypeScript；Featured 由编辑判断，不自行授予。 |
| [cccakeee](https://github.com/cccakeee/awesome-dsh-plugins/blob/main/docs/CONTRIBUTING.zh-CN.md) | 主目录数据为 `data/verified-plugins.csv`，全量发现与主目录分开；提交精确安装方法、原生证据、许可与风险。其 README 指向的同构网站本次读取超时，不能据此认定网站不存在。 |
| [Omni DSH](https://github.com/diegosouzapw/awesome-omni-dsh-plugins/blob/main/CONTRIBUTING.md) | 每个分支和 PR 仅一个作者命名空间 YAML；绑定原仓库节点 ID、完整提交、原生入口、真实仓库 Star 和许可。第四份条目已按原始 Schema 准备，使用固定 Git 来源，保持 `eligible`，由维护者执行来源门控。 |

## 已发生的申请

[HackSing 收录申请 #351](https://github.com/HackSing/dsh-plugins/issues/351)已由维护者账号提交，使用经过验证的完整 Git 提交，公开 npm 未发布、已验收范围及其余未验收部分。目前待审核，未确认收录或推荐。其他结构化目录条目仍为准备状态。

## 发布与跟踪

1. 读取默认分支的市场应等待最终入口、补丁、截图、图标及说明生效；明确接受完整 Git 提交的入口可按其规则提交已经验证的固定版本。
2. 以实际 1.0.0 包验证独立安装和 rc.5 工具闭环，核对 npm 的版本、仓库、发布时间与完整性。
3. 先提交上游目录，再对需要独立申请的入口提交事实性材料。只填写自己的条目，不改其他项目，不重复催促。
4. 精选申请附实际案例、失败分类、已知范围和可运行命令；不宣称原始录制都能缩减，也不把植入示例当外部案例。
5. 分别记录“可检索 / 已收录 / 可安装 / 可加载 / 完成任务 / 推荐状态”、来源、具体版本和复查日期；只在状态已生效时添加相应徽章。

独立申请的字段、可直接复用的简介及推荐依据见[申请材料](../distribution/submissions.md)。[入口状态清单](../distribution/targets.json)记录已核实的主要数据来源、共享关系、申请门槛及尚未发生的外部动作。

入口按核查日期维护。新增入口优先复用公共 bundle、npm 和截图声明；公开协议确实不同时，再增加对应适配并记录实测结果。目录覆盖不意味着支持新的 DSH 宿主或版本；不同市场的标签、评论和其他项目介绍也不进入 BugGPS 自身的功能或质量声明。

当前版本的 [运行依据](verification/1.0.0/README.md)区分完整检查、历史案例、真实提供方流程、安装和移除。当前案例组没有证实可宣传的缩减收益，申请材料主张固定预期下可复核的结果，不填入虚构的 N→M、耗时或用户成功率。
