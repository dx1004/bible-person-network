# 数据来源与授权说明

## 底本与校验源

- `source:0001`（SBLGNT 1.2）：用于新约位点核验，并通过受 STEP 词形表驱动的保守 token 扫描生成核对清单；人物候选主流程仍来自 STEP Proper Names。
  - 许可：CC BY 4.0
  - 提交：`c4d241a9c1c479a55b989ba35a4976c1d0b8052c`
- `source:0002`（STEPBible Proper Names）：用于完整性核对与补漏识别，不在公开页面重发完整经文文本。
  - 许可：CC BY 4.0
  - 代码库提交：`efe428a0047bf7b9c3ce2624f60c252c6e435945`
  - TIPNR 文件 SHA-256：`403c6c74b4e133d9814d73099921937e3a4140d2bdae7e990ac8cf25359f5f91`
- `SBL` 人名覆盖阶段先使用 STEP TIPNR 希腊词形与锁定 SBLGNT 逐经文 token 的保守扫描，再以 `independent_reviewer_merge_sbl_surface_match` 合并两位审校员的表面词形、经文位置与人物端点判断。当前 363 条审计记录中，360 条接受、3 条排除、0 条待决；完整决定见 `data/sblgnt-name-audit.jsonl` 与 `editorial/sblgnt-name-review.jsonl`。此流程可核查覆盖差异，但不声称是与词表无关的全量自动 NER。
- `source:0003`（CUV 简体中文）：用于中文名映射辅助检索（人工核验为主），不用于程序性抽取或改写中文主标签。
  - 地址：`https://ebible.org/cmn-cu89s`
  - USFM 压缩包：`https://ebible.org/Scriptures/cmn-cu89s_usfm.zip`
  - 许可：Public Domain
- CUV 简体 USFM（仅供中文映射辅助）：SHA-256 `68df122e9195e071dc286f19ef53e530fcaadb3a16a7dc34b8430b7062f70598`（见 `data/manifest.json` 的 `supplemental_source.cuv_zip_sha256`）
- `source:0004`（Josephus, *Jewish Antiquities* 18.116–119）：仅用作希律安提帕与施洗约翰司法行为的古代原始史料定位。版本为 Perseus Digital Library 收录的 William Whiston 英译，标记为 Public Domain；公共网页只发布定位与编辑摘要，不转载全文。
  - 地址：`https://www.perseus.tufts.edu/hopper/text?doc=Perseus%3Atext%3A1999.01.0146%3Abook%3D18%3Awhiston+chapter%3D5%3Awhiston+section%3D2`

## 版本管理

本目录中的 `data/*.jsonl`、`schemas/*.jsonl`、`scripts/*`、`neo4j/*` 全部为 Git 版本对象。`npm run fetch:sources` 会取得清单中锁定的两个 Git 提交；随后 `npm run ingest:locked` 可重新抽取候选资料。Neo4j、CSV、JSON 与网页可由版本化数据从空库重建。
`data/manifest.json` 中保留了来源快照与许可证版本号，便于复核与溯源。`npm run fetch:sources` 会按该哈希下载并校验 `CUV` 压缩包，解压到 `.sources/cmn-cu89s-usfm`。

## 扩展与待审状态补充

旧约扩展与完整圣经发布目前处于前置阶段，新增来源仅登记为待审链路，不进入正式发布：

- `source:0005` STEPBible TAHOT/TOTHT：旧约姓名覆盖与对齐已按 TIPNR 计划登记，但暂不作为公开图谱输入。
- `source:0006` Josephus 已锁定 Project Gutenberg eBook 2848 的 Whiston 译本。RDF 明示美国公版并确认译者；锁定全文记录 SHA-256 且位于 `.sources/`，不进入 Git。会动态变化的 RDF 只作为许可核验地址，不作为语料快照。全书人物与关系的系统审校仍未开始，因此来源状态继续为 pending。
- `source:0007` Philo 已锁定 Bohn 1854–55 年四卷 Yonge 译本。Internet Archive 元数据标记 `NOT_IN_COPYRIGHT`；四卷 OCR 的 MD5 与上游一致并另存 SHA-256。OCR 只用于发现候选，接受定位前必须回查页图。系统审校仍未开始，因此来源状态继续为 pending。
- `source:0008` Lexham Bible Dictionary（Lexham Press，2016）受版权限制。登录后的 Scribd 只返回用户上传的零散词条与摘要，未发现合格完整版本；Logos 官方产品 36564 确认精确版本、`$0.00` 标价及当前账户的临时访问。尚未完成购买或全书系统审校。Git 只允许保存条目定位与原创证据判断。
- `source:0009` Anchor Yale Bible Dictionary（1992，六卷）受版权限制。登录后的 Scribd 只发现用户上传的 11 页文件与 Yale 系列宣传目录，不是完整六卷本，未下载也未采用。开始系统审校前仍需图书馆馆藏、出版社授权电子版或实体六卷本。Git 只允许保存卷页／条目定位与原创证据判断。

当前可公开关系数据仍为 NT 主体状态，旧约仅保留 2720 条候选及待审决策；`source` 与 `manifest` 中的 pending 状态即为门控原因。
 Logos 试用未开启，本阶段不基于 Logos 截图或受限订阅材料补全正式关系。四套资料的访问、许可、文件锁定及系统审校状态见 `editorial/source-access-review.jsonl`；`npm run validate:source-access-review` 校验版本化契约，`npm run verify:historical-sources` 额外核对本地公版文件。

- `source:0005`（STEPBible TAHOT/TOTHT）: 已完成 8 个源文件哈希/行数/命中摘要的独立覆盖审计（`editorial/tahot-totht-coverage-audit-report.json`），并保持审计与发布分离。
