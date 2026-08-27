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

## 当前编辑闸口

当前自动抽取结果是候选语料，不是已经审定的人物关系数据库。只要中文主标签、关系断言或 SBLGNT 独立人名抽取仍未完成，报告必须保持 `editorial_review_required`，网页也必须显示相应提示。
