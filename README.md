# New Testament Person Network

以可审计、可重建的数据管线制作新约具名人物关系网。项目包含版本化人物资料、JSON Schema、Neo4j 本地研究库，以及 Cytoscape.js 静态网页。

GitHub：<https://github.com/dx1004/new-testament-person-network>

## 运行方式

```bash
cd /Users/dx/nt-people
npm install
npm --prefix web install
npm run check
```

若要从锁定的原始资料重新抽取候选数据：

```bash
npm run fetch:sources
npm run ingest:locked
npm run generate:chinese-name-candidates
npm run check
```

当前状态：`editorial_review_required`（中文标签、关系断言审校与 SBL 人名独立抽取尚未完成，报表已显式标注）。

这意味着当前网页是研究候选数据的浏览界面，不是已经定稿的人物学结论。STEPBible 自动抽取的亲属边默认作为待审候选显示。

## 目录

- `data/`：六类版本化 JSONL（people、names、mentions、assertions、sources、identity-options）
- `schemas/`：每类数据的 JSON Schema
- `scripts/`：校验与重建脚本
- `neo4j/import/`：导入文件与 cypher
- `exports/`：构建产物（由 `validate:data` 生成）
- `docs/`：数据说明与来源说明
- `editorial/`：中文名候选（`chinese-name-candidates.jsonl`）及审校报告
- `editorial/chinese-name-review.jsonl`：中文名二轮人工审核清单（默认 `pending`）

常用命令：

- `npm run generate:chinese-name-candidates -- --cuv-usfm-dir <path>`：显式重生成中文名候选
- `npm run init:chinese-name-review`：生成中文名二轮审核清单（会失败并提示除非加 `--force`）
- `npm run validate:chinese-name-review`：只校验审核清单
- `chinese-name-review.jsonl` 记录每人前 3 个 `candidate_rank` 分组的候选，并带 round1/round2/final 的候选引用字段。

中文名候选默认不自动写入 `people.jsonl`。审校采用两轮机制：

1. 首轮只做提取与歧义标注：候选均保留 `status: pending`，不改 `canonical_chinese`。
2. 二轮人工确认后，将通过审校的候选写入 `people.jsonl` 并更新 `review_status`。

## Neo4j

Neo4j 仅供本地研究与构建，不作为公开网站后端。复制 `neo4j/.env.example` 为未纳入 Git 的 `neo4j/.env`，设置本地密码后运行：

- macOS/Linux/WSL：`bash neo4j/import-cycle.sh`
- Windows PowerShell：`powershell -ExecutionPolicy Bypass -File neo4j/import-cycle.ps1`

两种脚本都会清空项目专用 Neo4j 容器中的数据库、连续导入两次，并比较人物、主张和提及计数。请勿指向存有其他资料的 Neo4j 实例。

## 许可

- 代码：MIT，见 `LICENSE`
- 原创数据：CC BY 4.0，见 `DATA_LICENSE.md`
- 第三方资料：见 `docs/provenance.md`
