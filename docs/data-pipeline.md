# New Testament Person Network v1 Data Pipeline

本目录为人物关系网数据子系统（非 web 层），目标是把六类版本化数据形成可重复构建链路，并支持空库重建与审计输出。

## 数据文件

- `data/people.jsonl`
- `data/names.jsonl`
- `data/mentions.jsonl`
- `data/assertions.jsonl`
- `data/sources.jsonl`
- `data/identity-options.jsonl`

每类文件必须对应 `schemas/*.schema.json`。执行器使用 Ajv 2020-12 完整执行 JSON Schema，并额外检查跨文件引用、重复 ID、孤立名称、无出处关系与计数一致性。

## 命令

- `npm run validate:data`：校验 JSONL 与交叉引用、生成 `exports/*` 与 `neo4j/import/*`。
- `npm run reconcile`：若放置 `data/sblgnt.persons.json` 与 `data/stepbible.persons.json`，输出差异报告。
- `npm run report`：输出当前构建报告摘要。
- `npm run check`：按顺序执行数据校验、来源核对、报告、网页类型检查与生产构建。

- `npm run init:old-testament-person-review`：根据旧约候选生成双轮独立 AI 审校快照，默认 `pending`。
- `npm run validate:old-testament-person-review`：校验审校快照，要求 `final` 与 `round1/2` 一致，且必须满足 multi-agent 协议记录。
- `npm run generate:historical-source-person-hits`：核对已登记哈希后，以 2,720 个旧约候选的拉丁名称扫描 Josephus Whiston 与 Philo Yonge 的本地公版缓存；只生成逐候选、逐来源的 `pending` 命中索引与稳定行号定位，不保存原文或摘录。
- `npm run validate:historical-source-person-hits`：仅用已提交的候选、命中索引和报告检查 5,440 行覆盖、排序、校验和与全量 `pending` 状态；不要求本机存在 `.sources`。
- `npm run generate:old-testament-chinese-name-candidates`：基于旧约人物候选与和合本 CUV 人名标记，生成旧约中文名候选（pending）。
- `npm run validate:old-testament-chinese-name-candidates`：校验 `editorial/old-testament-chinese-name-candidates.jsonl` 与其 report。
- `npm run generate:cross-testament-identity-review`：生成旧约候选与 `identity-options` 的跨约身份候选快照（不入库），自动填充 `multi_agent_ai_review` 元信息（方法、版本、角色模型）。
- `npm run validate:cross-testament-identity-review`：校验跨约身份快照（含 `review_method`、`protocol_version`、角色与证据审计元信息）。

## 证据与发布边界

公共页面不发布经文原文。`mentions` 与 `assertions` 的 `passage` 字段仅保留章节位置信息（例如 `MAT 4:18-20`），由前端回溯到可读页面/脚注。

## 证据等级与关系状态

- 关系 `active`：可在默认图谱中展示。
- 关系 `inactive`：保留证据但默认不展示。
- 关系 `superseded`：被新主张替代。

`assertions.status` 与 `identity-options` 用于支持“保守/传统”双预设。

`identity-options.jsonl` 支持三类身份预设：
- `default`：默认独立身份；
- `conservative`：保守预设；
- `common_tradition`：传统候选预设。

可选字段：
- `merge_group_id`：传统候选分组 ID；
- `merge_target_person_id`：该分组的目标 `person_id`；
- `display_label`：展示用标签。

`common_tradition` 下 `status=disputed` 的选项应至少成组出现，并在 `validate:data` 中校验目标一致。

## 编辑与发布闸口

自动抽取结果默认是候选语料，不会自行成为已审定的人物关系数据库。只要中文主标签、关系断言或 SBLGNT 独立人名审校仍有待决记录，报告必须保持 `editorial_review_required`，网页也必须显示相应提示。

当前工作树尚未通过两项编辑闸口：中文主标签仍有 4 条待审；关系审校快照已完成重建、迁移与验证，保留 222 条接受、50 条拒绝和 83 条待审。SBLGNT 差异审计为 25 条接受、3 条排除、0 条待决，该项已无待决记录。因此构建报告必须保持 `editorial_review_required`，不得因数据校验或网页类型检查通过而改称 `ready`。

当前扩展阶段为 “NT-first 发布 + OT 待审扩展”：
- 全局范围计划为 66 卷（NT 27 + OT 39），`data/manifest.json` 中已登记 `pipeline_gate.ot_candidate_count = 2720`；
- 公开图谱当前仅包含 NT 已发布关系与人物快照，尚未对外发布 OT 关系边；
- 旧约候选与关系仍在审校闸口内（身份、关系主张、来源许可和方法一致性）；
- 人物主数据已迁移为 `person-000001` 中性格式，旧 `nt-people-*` 保留在兼容映射中；
- Logos 试用未启动，不作为本阶段完成条件。

### 人物时代与关系语境

- `people[].era` 是人物生活时代：`旧约背景`、`耶稣时期`、`使徒时期`、`时代待审`。
- `旧约背景`人物只因被新约明确点名而收录；它不是旧约全人物扩展范围。
- `relationships[].era` 是证据所在经文的时代/语境。前端人物清单按人物自身的 `people[].era` 筛选；关系图则保留至少一个端点属于所选人物时代的边。两者都不使用 `relationships[].era` 冒充人物生活时代。

## 独立覆盖审计（只做一致性与可复现性检查）

- 新增命令：`npm run generate:tahot-totht-coverage-audit` 与 `npm run validate:tahot-totht-coverage-audit`。
- 审计针对 `source:0005` 的 TAHOT/TOTHT 文件，输出：`editorial/tahot-totht-coverage-audit.jsonl` 与 `editorial/tahot-totht-coverage-audit-report.json`。
- 审计结果为独立校验产物，不会改写人物关系发布决策。
