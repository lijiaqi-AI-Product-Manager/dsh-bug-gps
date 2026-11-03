# 目录收录材料

当前是提交准备材料，不表示已经收录、获得推荐或发布 npm。

四份结构化目录条目尚未送审；[HackSing #351](https://github.com/HackSing/dsh-plugins/issues/351) 与 [DSH Open #224](https://github.com/polang233/dsh-plugin-index/issues/224) 的独立申请已提交，均待审核。

```bash
npm run check:distribution
node scripts/prepare-distribution.mjs --out .buggps/catalog-submission
```

导出目录必须是 `.buggps/` 的一个新子目录；已有目录和文件不会被覆盖。生成文件使用 [`entries.json`](entries.json) 的事实性描述和当前包声明。更新条目前重新阅读目标目录的贡献规则。

| 目录 | 具体提交方式 |
| --- | --- |
| [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md) | 只新增生成的 YAML 到 `data/plugins/`，不改生成的 README。当前分类为 `browser`；`npm:` 和自行增加的推荐字段不被接受。 |
| [1024 Store 目录](https://github.com/imsai-sh/awesome-deepseek-harness-plugins/blob/main/CONTRIBUTING.md) | 只新增生成的 JSON 到 `catalog/plugins/`，不改生成文件。当前分类为 `dev`。条目元数据的贡献约定为 CC0-1.0；不改变 BugGPS 源码的 MIT 许可。 |
| [dshworks](https://github.com/dshworks/awesome-dsh-plugins/blob/main/CONTRIBUTING.md) | 把生成的 entry 追加到 `data/plugins.json` 的 `plugins`，运行对方的校验与 README 生成，再按规则提交两者。保持 `unverified`，由维护者复核；不自行设为 `featured` 或 `official`。 |
| [Omni DSH](https://github.com/diegosouzapw/awesome-omni-dsh-plugins/blob/main/CONTRIBUTING.md) | 一个作者命名空间的 `.yaml`，仅提交到 `catalog/plugins/`。导出采用 YAML 1.2 支持的 JSON 语法，字段与原始 Schema 一致。固定完整源码、原仓库节点 ID 和真实 Star，保持 `eligible`，不自行宣称维护者已收录或运行验收。 |

提交前，默认分支必须已有最终代码、入口、补丁、图标与截图。现在 icon 指向未来合并后的默认分支路径，不能在资源尚未生效时将草案直接送审。`added` 与 `lastVerified` 是准备材料的日期，正式提交前按真实状态核对。

上述默认分支要求适用于从默认分支读取资源的条目；Omni 使用独立固定提交及同提交的媒体链接。其 Star 与检查日期是观测快照，正式投稿前重新读取，并由维护者核对来源。一次仅送审该市场需要的单个条目，不将四个目录的产物一起提交。

发布 npm 后，补充 dshworks 的真实包名，并核对 registry 中的 `repository` 映射。awesome-dsh-plugin 的 npm 映射由其采集器读取，条目中不添加 `npm` 键。GitHub Release 备用包使用固定 tag URL；若使用 `latest/download/`，资产文件名须保持不含版本，防止下次发版链接失效。

其他已核查入口、推荐机制与待办见 [多市场分发](../docs/distribution.md)。独立表单、Issue 和精选申请的可复用字段见 [申请材料](submissions.md)，主要入口的来源、前置条件与真实提交状态见 [状态清单](targets.json)。清单中的准备状态不表示已被收录或推荐。
