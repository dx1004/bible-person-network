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

### 人物时代与关系语境

- `people[].era` 是人物生活时代：`旧约背景`、`耶稣时期`、`使徒时期`、`时代待审`。
- `旧约背景`人物只因被新约明确点名而收录；它不是旧约全人物扩展范围。
- `relationships[].era` 是证据所在经文的时代/语境。前端人物清单按人物自身的 `people[].era` 筛选；关系图则保留至少一个端点属于所选人物时代的边。两者都不使用 `relationships[].era` 冒充人物生活时代。
