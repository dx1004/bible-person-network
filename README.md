# 圣经人物关系网

以可审计、可重建的数据管线制作圣经人物关系网。项目包含版本化人物资料、JSON Schema、Neo4j 本地研究库，以及 Cytoscape.js 静态网页。

GitHub：<https://github.com/dx1004/bible-person-network>（仓库已改名）

网站：<https://bible-people.coudx.com>（域名初始化中；当前版本在审校完成前暂停部署）

## 收录范围

当前为“全圣经”扩展预研：收录新约点名的旧约人物与新约具名人物（共享同一人物 ID），并在审校完成后逐步补齐旧约 39 卷全量命名人物。
部族、地区、象征称号及未被明示命名的人物不纳入人物节点。旧约可见旧约入口、旧约线索与全书聚合视图。

网页将人物生活时代分为 `旧约背景`、`耶稣时期`、`使徒时期` 与 `时代待审`。其中“旧约背景”明确表示人物生活在旧约时期，但因被新约点名而进入本项目。关系自身的 `era` 仍表示证据所在的经文语境，不与人物生活时代混用。

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

`npm run generate:chinese-name-candidates` 在未显式设置 `--cuv-usfm-dir` / `CUV_USFM_DIR` 时，默认从 `.sources/cmn-cu89s-usfm` 读取。该目录由 `npm run fetch:sources` 按 `data/manifest.json` 锁定哈希下载并解压。

当前状态：`editorial_review_required`。当前可重复抽取的资料库为 NT 主体版本，包含 364 位人物、918 个名称变体、3056 处经文提及、355 条审计主张和 368 个身份选项。中文名清单有 360 条已接受、4 条待审；关系审校快照已重建并迁移旧决定，现有 222 条已接受、50 条拒绝、83 条待审。
旧约扩展完成了候选抽取与对照前置：已生成 2720 个旧约候选待审记录，暂无“发布级别”旧约关系边。
当前公开图谱继续以已接受关系为准；目前仍不发布 OT 关系。网页与正式发布在全部闸口完成前不得标记为 `ready`。

人物主数据已迁移为 `person-000001` 中性格式；旧 `nt-people-*` 保存在 `legacy_ids` 与重定向映射中，并由完整构建检查验证。

SBLGNT 希腊文词项覆盖审计共有 363 条记录：360 条接受、3 条排除、0 条待决；其中 28 条进入独立差异复核，复核结果为 25 条接受、3 条排除、0 条待决。自动部分仍是受 STEP 词形表辅助的保守扫描，并不声称完成与任何词表无关的全量 NER；独立审校记录、词形、位点与决定说明均保存在版本库中。网页呈现的是有出处、可追溯的研究数据，而不是对所有历史身份争议作最终裁决；有争议的同名或传统身份继续通过“全部保守／常见传统／逐项自定义”明确区分。

CI 会在 Ubuntu 与 Windows 上执行完整数据/网页检查，并在独立 Linux job 中启动 Neo4j、从空库连续导入两次，核对节点、关系、孤立项和两次快照一致性。

## 目录

- `data/`：六类版本化 JSONL（people、names、mentions、assertions、sources、identity-options）
- `schemas/`：每类数据的 JSON Schema
- `scripts/`：校验与重建脚本
- `neo4j/import/`：导入文件与 cypher
- `exports/`：构建产物（由 `validate:data` 生成）
- `docs/`：数据说明与来源说明
- `editorial/`：中文名候选（`chinese-name-candidates.jsonl`）及审校报告
- `editorial/chinese-name-review.jsonl`：中文名二轮人工审核清单（默认 `pending`）
- `editorial/relationship-review.jsonl`：关系主张二轮+终审清单（默认 `pending`）
- `DESIGN.md`：界面设计系统、视觉约束与运行时 token 映射
- `design-qa.md`：桌面/手机视觉、交互与无障碍验收记录
- `premium-ui.json` / `premium-audit.json`：前端严格审计配置与结果

常用命令：

- `npm run generate:chinese-name-candidates -- --cuv-usfm-dir <path>`：显式重生成中文名候选
- `npm run init:chinese-name-review`：生成中文名二轮审核清单（会失败并提示除非加 `--force`）
- `npm run validate:chinese-name-review`：只校验审核清单
- `npm run apply:chinese-name-review`：将 `final_decision=accepted` 且 round1/round2 一致的记录应用到 `data/people.jsonl`
- `npm run apply:chinese-name-review -- --check`：只校验审核清单（不写入）
- `npm run apply:chinese-name-review -- --dry-run`：预览应用结果（不写入）
- `npm run init:relationship-review`：生成关系主张审校清单（默认 `pending`，`--force` 可覆盖）
- `npm run validate:relationship-review`：只校验关系主张审校清单
- `npm run apply:relationship-review`：将 `final_decision=accepted` 的审校结果应用到 `data/assertions.jsonl`（仅在通过 round2 且 final 与 round2 完全一致时）
- `node scripts/apply-relationship-review.js --check`：只验流程一致性，不改数据
- `node scripts/apply-relationship-review.js --dry-run`：预览将生效变更数量，不改数据
- `chinese-name-review.jsonl` 记录每人前 3 个 `candidate_rank` 分组的候选，并带 round1/round2/final 的候选引用字段。

中文名候选默认不自动写入 `people.jsonl`。审校采用两轮机制：

1. 首轮只做提取与歧义标注：候选均保留 `status: pending`，不改 `canonical_chinese`。
2. 二轮人工确认后，将通过审校的候选写入 `people.jsonl` 并更新 `review_status`。

关系主张审校同样保持“默认保留、不自动发布”：

1. 先完整生成 `relationship-review.jsonl`，每条 `asrt-*` 都有默认 `pending` 决策与快照。
2. 两轮都需审阅后，才允许 `final_decision=accepted`。

## Neo4j

Neo4j 仅供本地研究与构建，不作为公开网站后端。复制 `neo4j/.env.example` 为未纳入 Git 的 `neo4j/.env`，设置本地密码后运行：

- macOS/Linux/WSL：`bash neo4j/import-cycle.sh`
- Windows PowerShell：`powershell -ExecutionPolicy Bypass -File neo4j/import-cycle.ps1`

两种脚本都会清空项目专用 Neo4j 容器中的数据库、连续导入两次，并比较人物、主张和提及计数。请勿指向存有其他资料的 Neo4j 实例。

若本机未运行 Docker，GitHub Actions 的 `neo4j-import-idempotence` job 会在独立 Ubuntu runner 中执行同一双重空库导入；发布验收以该 job 的完整日志为准。

## Cloudflare Pages

公开网页是纯静态 HTML、CSS、JavaScript 和 JSON，不连接 Neo4j，也不使用 Cloudflare Functions。Neo4j 仅用于本地研究、导入复核与构建验收；Cloudflare Pages 免费静态托管即可运行当前版本。

默认界面采用人物索引、焦点人物一度关系图和出处面板三栏结构；手机端切换“人物／图谱／详情”。图谱只绘制当前焦点网络，完整关系仍可通过可访问的文字列表读取。

- 预览发布：`npm run pages:preview`
- 正式发布：`npm run pages:production`
- 自定义域名：<https://bible-people.coudx.com>（旧地址暂时保留）

## 许可

- 代码：MIT，见 `LICENSE`
- 原创数据：CC BY 4.0，见 `DATA_LICENSE.md`
- 第三方资料：见 `docs/provenance.md`
