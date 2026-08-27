# 数据来源与授权说明

## 底本与校验源

- `source:0001`（SBLGNT 1.2）：用于新约位点核验，并通过受 STEP 词形表驱动的保守 token 扫描生成有限核对清单；人物候选主流程仍来自 STEP Proper Names。
  - 许可：CC BY 4.0
  - 提交：`c4d241a9c1c479a55b989ba35a4976c1d0b8052c`
- `source:0002`（STEPBible Proper Names）：用于完整性核对与补漏识别，不在公开页面重发完整经文文本。
  - 许可：CC BY 4.0
  - 代码库提交：`efe428a0047bf7b9c3ce2624f60c252c6e435945`
  - TIPNR 文件 SHA-256：`403c6c74b4e133d9814d73099921937e3a4140d2bdae7e990ac8cf25359f5f91`
- `SBL` 人名覆盖阶段：使用方法 `step_lexicon_sbl_token_scan`（基于 STEP TIPNR 人名希腊词形与 SBLGNT 逐经文 token 匹配的保守扫描）；该方法不构成人名自动 NER，仅保留可核验与待决差异。
- `source:0003`（CUV 简体中文）：用于中文名映射辅助检索（人工核验为主），不用于程序性抽取或改写中文主标签。
  - 地址：`https://ebible.org/cmn-cu89s`
  - USFM 压缩包：`https://ebible.org/Scriptures/cmn-cu89s_usfm.zip`
  - 许可：Public Domain
- CUV 简体 USFM（仅供中文映射辅助）：SHA-256 `68df122e9195e071dc286f19ef53e530fcaadb3a16a7dc34b8430b7062f70598`（见 `data/manifest.json` 的 `supplemental_source.cuv_zip_sha256`）

## 版本管理

本目录中的 `data/*.jsonl`、`schemas/*.jsonl`、`scripts/*`、`neo4j/*` 全部为 Git 版本对象。`npm run fetch:sources` 会取得清单中锁定的两个 Git 提交；随后 `npm run ingest:locked` 可重新抽取候选资料。Neo4j、CSV、JSON 与网页可由版本化数据从空库重建。
`data/manifest.json` 中保留了来源快照与许可证版本号，便于复核与溯源。`npm run fetch:sources` 会按该哈希下载并校验 `CUV` 压缩包，解压到 `.sources/cmn-cu89s-usfm`。
