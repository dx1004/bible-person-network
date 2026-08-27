# 关系审校清单（assertion-level）

本文件定义关系审校清单的用途与规则，避免将 STEP 自动抽取关系作为定稿直接发布。

## 目标

对 `data/assertions.jsonl` 的每条主张生成一条待审记录，并保留：

- 断言级快照：`assertion_snapshot` 与 `assertion_signature`
- 主体/客体与方向/关系类型
- 每条证据的来源、位点、层级、说明、确定度
- `nt_passage_alignment`（端点在位点共现情况）
- `round1`、`round2`、`final_decision` 三轮决策

## 对齐口径

- `both_endpoints_mentioned`：至少一条 NT 位点同时命中主体与客体。
- `one_endpoint_mentioned`：至少一条 NT 位点命中任一端点，且另一端点未命中。
- `neither_endpoint_mentioned`：NT 位点均未命中任一端点（位点仍是 NT）。
- `non_nt_locator`：所有位点均不在新约书卷（非 NT 书卷或位点无法解析）。

## 决策要求

- 新建文件默认 `pending`。
- `final_decision=accepted` 时必须同时满足：
  - `round1.status=accepted` 且 `round2.status=accepted`
  - `decision_relation_type`、`decision_direction` 为允许值
  - 至少 1 条 `decision_evidence_refs`
  - `reviewer`、`decision_note`、`reviewed_at` 均有值
  - `round2` 是可追溯的“先行决策”；`final_decision` 如果为 `accepted`，其关系类型、关系方向、关系细分及证据列表必须与 `round2` 完全一致（不可绕过二审）
- `decision_evidence_refs` 的 `accepted` 规则：
  - `evidence_level=nt_text` 时，必须使用 `source:0001`，`passage` 为标准化 NT 位点（如 `MAT 1:5`，禁止 `STEP:` 前缀），并包含 `certainty`
  - 非 `nt_text` 的证据只需来源存在
- `rejected` 允许不写替代关系，但应写明 reviewer/时间/说明，且不保留证据替代项。
- `apply` 阶段会先执行 `npm run validate:relationship-review`（`init-relationship-review --validate-only`）做快照与签名校验，任何 `snapshot drift` 直接失败。
- 默认在 `build-stepbible-corpus.js` 会加载 `editorial/relationship-seeds.jsonl`，将其作为 `status: inactive`/`editorial_status: pending` 的待审关系追加到 `assertions.jsonl`，并纳入 review 审校生成。
- 这些显式种子仅用于审校入口，不代表最终定稿；仍必须通过关系审校流程。

## 一致性约束

- 行数必须与断言文件完全一致（以当前断言文件中的 `assertion_id` 数量为准）。
- `assertion_id`、`person_id`、证据 `source_id` 均需有交叉引用校验。
- 审核条目数按当前 `assertion_id` 列表动态生成，不写死固定行数。
- `assertion_snapshot` 与 `assertion_signature` 使用当前 `data/assertions.jsonl` 快照计算；数据变化后 `--validate-only` 会失败提示“snapshot drift”。
- 只在 `--validate-only` 时进行校验，不会改写任何主张文件。

## 命令

```bash
npm run init:relationship-review
npm run validate:relationship-review
npm run apply:relationship-review -- --check
node scripts/apply-relationship-review.js --check
node scripts/apply-relationship-review.js --dry-run
npm run apply:relationship-review
npm run init:relationship-review -- --force      # 有必要时覆盖现有审校文件
npm run validate:relationship-review -- --validate-only
```

默认会在 `editorial/relationship-review.jsonl` 按断言文件计数生成同样数量的审校行，ID 从 `rrr-0001` 起。
