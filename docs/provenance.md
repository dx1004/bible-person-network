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

旧约人物、已接受关系和跨约身份已经迁入统一数据集；完整来源版本仍受 Anchor Yale 系统审校门槛约束：

- `source:0005` STEPBible TAHOT/TOTHT：已完成旧约 39 卷覆盖审计；2,720 个候选全部覆盖，27 个覆盖例外均有显式审校决定。该来源已经用于统一旧约人物资料的覆盖复核。
- `source:0006` Josephus 已锁定 Project Gutenberg eBook 2848 的 Whiston 译本。2,720 个候选全部扫描，1,019 个正命中均完成两轮独立审校和 Boardroom 终审；357 接受、220 排除、442 个属于已审但无法唯一化身份的 inconclusive，后者不发布。全文仍只在 `.sources/`，Git 仅保存定位、原创摘要和判断。
- `source:0007` Philo 已锁定 Bohn 1854–55 年四卷 Yonge 译本。2,720 个候选全部扫描，253 个正命中均完成两轮独立审校和 Boardroom 终审；92 接受、4 排除、157 个 reviewed-inconclusive。OCR 定位继续保留 `page_scan_confirmation_required`，未确认页图的材料不得发布。
- `source:0008` Lexham Bible Dictionary（Lexham Press，2016）受版权限制。Logos 官方产品 36564 与本机 `LLS:LBD` 确认精确版本。1,510 个唯一拉丁名覆盖全部 2,720 候选：600 个直接词条命中、910 个无直接词条、0 个环境错误；Logos `HistoryManager` 词条定位元数据完成独立一致性复核。694 个直接命中候选均完成两轮 headword-only 审校与 Boardroom 终审，结果为 564 接受、56 排除、74 reviewed-inconclusive，并保留 117 条标题明确支持的亲属证据。Git 只保存词条标题、定位和原创判断，不保存正文或截图。
- `source:0009` The Anchor Bible Dictionary（Doubleday，1992，六卷；后称 Anchor Yale Bible Dictionary）受版权限制。Bloomsbury 免费访问已完成官方 1,923 个 Person 词头、六卷全部页码 locator 与 2,720 个候选人的目录级复核。亲属词检索按六卷分区后完整枚举 29,259 个命中、2,726 个唯一章节，绕过原先的 2,000 条结果上限；自动上下文匹配覆盖全部 2,912 条关系断言，保留 2,049 条派生匹配、涉及 1,452 条断言，待审与例外均为 0，人工 locator 查找需求为 0。审计只保存标题、locator、计数和原创判断，不保存正文、snippet、截图或受限 PDF。Internet Archive Search Inside 的 `inside-hocr.py` 后端错误不再阻碍定位自动化，但 Bloomsbury 完整词条正文仍要求订阅，因此系统审校继续保持 `in_progress`，完整版本发布门禁仍关闭。

当前统一数据已包含已接受的旧约人物和关系；人物候选及跨约身份均无待审项。`source:0009` 是唯一剩余来源门槛，正式完整版本必须继续被发布检查阻塞。
 Logos 试用未开启，本阶段不基于 Logos 截图或受限订阅材料补全正式关系。四套资料的访问、许可、文件锁定及系统审校状态见 `editorial/source-access-review.jsonl`；`npm run validate:source-access-review` 校验版本化契约，`npm run verify:historical-sources` 额外核对本地公版文件。

- `source:0005`（STEPBible TAHOT/TOTHT）: 已完成 8 个源文件哈希/行数/命中摘要的独立覆盖审计（`editorial/tahot-totht-coverage-audit-report.json`）及 27/27 例外审校，并保持审计与发布分离。


## 2026-08-30 来源发布决议：ISBE 1915

经批准，公版 *International Standard Bible Encyclopedia*（James Orr 等编，1915，五卷，`source:0010`）取代 Anchor Yale，作为第五项必需的系统来源审校。其范围是完整人物与定位覆盖审计：2,720 个旧约候选全部有记录；不从该来源新增或修改公开关系断言。Anchor Yale（`source:0009`）保留为可选补充来源；其受限全文审校状态不再阻塞发布。ISBE 全文仅保留在本地研究缓存，公开产物只保留定位与原创审校理由。
