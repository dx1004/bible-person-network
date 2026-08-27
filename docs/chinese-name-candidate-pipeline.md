# 中文名候选生成流程（CUV \\pn）

## 输入

- `--cuv-usfm-dir` 或环境变量 `CUV_USFM_DIR`：CUV 简体 USFM 根目录。默认路径为 `.sources/cmn-cu89s-usfm`。
- `data/mentions.jsonl`：用于 `person_id + passage` 对齐。
- `data/people.jsonl`：输出时补齐 `person_id` 与 `latinized`。

## 输出（均写入 `editorial/`）

- `chinese-name-candidates.jsonl`
- `chinese-name-candidates-report.json`

`check` 流程不再默认再生成：

- `npm run check` 调用 `validate:chinese-name-candidates`，不依赖本机 CUV 路径。
- `npm run generate:chinese-name-candidates` 生成中文候选（默认读取 `.sources/cmn-cu89s-usfm`）。如需覆盖可用 `--cuv-usfm-dir` 或 `CUV_USFM_DIR`。
- `npm run validate:chinese-name-candidates` 执行提交文件校验。

## 字段说明

每条记录至少包含：

- `person_id`
- `latinized`
- `candidate_chinese`
- `supporting_passages`
- `support_count`
- `mention_count`
- `coverage`
- `precision`
- `jaccard`
- `score`
- `score_margin_to_next`
- `ambiguity`
- `candidate_rank`
- `status`（固定 `pending`）
- `source_id`（固定 `source:0003`）
- `method`

`score_margin_to_next`：
- 仅对 `candidate_rank === 1` 记录：`topScore - nextDistinctScore`
- 其他候选设为 `0`

`candidate_rank`：同一 `person_id` 内使用 dense rank（`1,1,2,...`），排序键为 `score` 降序、`candidate_chinese` 升序。

`high_confidence_candidate` 判断：
- `candidate_rank === 1`
- `support_count >= 2`
- `score >= 0.9`
- `precision >= 0.9`
- `coverage >= 0.9`
- `score_margin_to_next >= 0.15`
- 该人 `mention passage signature` 不与他人重复（见下）

## 歧义标注

- `ambiguity.level = shared_token`：该候选在同一节与多个角色共现。
- `ambiguity.level = multi_token`：该角色在同一节匹配到同一 `\\pn` 专名 token 多次。
- `ambiguity.level = shared_token_and_multi`：同时出现以上两类情况。
- `ambiguity.level = none`：无明显歧义迹象。

## 额外歧义规则：passage signature 复用

- 每人构建排序后的 `mention passage signature`（`passages` 按 `|` 拼接）。
- 若同一 `signature` 对应多个 `person_id`，则这些人物所有候选在 `ambiguity.reasons` 追加：
  - `identical_person_passage_signature`
- 命中该标记时禁止 `high_confidence_candidate`。

## 质量口径

- `coverage = overlap_passages / person_mention_passages`
- `precision = overlap_passages / token_passage_count`
- `jaccard = overlap / (token_passage_count + person_mention_passages - overlap)`
- `score = 0.5*coverage + 0.3*precision + 0.2*jaccard`

`status` 始终为 `pending`，并且不自动更新 `people` 的中文标签。
`candidate_rank` 按同一 `person_id` 下 `score` 降序、`candidate_chinese` 升序赋值。

## 审核门禁（两轮）

1. 第一轮（本候选）仅输出待审记录；`canonical_chinese` 不改写。
2. 第二轮人工确认后，再将确认项写入 `people.jsonl` 并关闭 `review_status.chinese_label_status`（若需）

## 报告字段

- `notes[*].high_confidence_count`：高置信候选条数
- `notes[*].people_with_high_confidence_count`：高置信人头数（等于高置信条数，且每人至多 1）

## CI 说明

- `npm run check` 仅验证已提交的候选产物（schema、计数、关联性校验）。
- 完整重生成仍需显式运行：`CUV_USFM_DIR=/... npm run generate:chinese-name-candidates`，以锁定 `source:0003` 的输入版本。

## 人名中文二轮审核清单（新增）

- `npm run init:chinese-name-review`：生成 `editorial/chinese-name-review.jsonl`，为每个 `data/people.jsonl` 中的角色写一行审核记录，包含每人 `candidate_rank` 前 3 个分组的 Top 选项（遇并列自动保留），并带 `created_at/updated_at` 固定为 `data/manifest.json` 的 `created_at`。
- `--force`：仅当确需重建人工可编辑的清单时才允许覆盖已有文件。
- `npm run validate:chinese-name-review`：只做严格 schema 与一致性校验（不会重建清单）。
- `npm run apply:chinese-name-review`：应用审核：仅当 `final_decision=accepted` 且 `round1`/`round2` 都为 `accepted` 且三者一致，才更新 `people`（`canonical_chinese`、`status`、`review_status.chinese_label_status`）。
- `npm run apply:chinese-name-review -- --check`：只复验审核清单，不写入。
- `npm run apply:chinese-name-review -- --dry-run`：预演可应用条目数量，不写入。

审核记录字段：

- `person_id`、`latinized`
- `top_candidate_refs[]`：当前 top 候选项，包含候选中文、分数和核心指标快照
- `round1` / `round2`：各轮独立审核对象
  - `status`: `pending|accepted|rejected`
  - `selected_candidate_id`: 审核员选中的候选 id（未定时为 `null`）
  - `proposed_chinese`: 对应中文值（未定时为 `null`）
- `final_decision`：最终决策对象
  - `status`: `pending|accepted|rejected`
  - `selected_candidate_id`: 最终采纳候选 id（未定时为 `null`）
  - `final_chinese`: 最终中文标签（未定时为 `null`）

`accepted` 必须选择候选并填写审核人、时间和说明；`rejected` 可以不选择候选（表示整组驳回），但仍必须填写审核人、时间和说明。

CI 的 `check` 增加 `validate:chinese-name-review`，仅校验文件完整性；清单本身默认仍不写回 `people.jsonl`。
