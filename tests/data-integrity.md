# Data Integrity Checks (Manual/Scripted)

- 所有 ID 格式符合 schema 要求（`nt-people-XXXX`、`name-XXXX`、`asrt-XXXX` 等）。
- `people/names/assertions/mentions/sources/identity-options` 的引用关系必须闭合。
- `assertions` 关系方向与 `relation_type` 不冲突；暂不支持自指关系。
- `status=active` 的关系与 `status=inactive` 关系在图谱展示前必须由前端策略再过滤。
- `validate:data` 每次必须产生稳定的 `exports` 与 `neo4j/import` 文件名和数量，支持幂等重建。
