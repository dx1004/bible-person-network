## 圣经人物关系网 graph 合同（public/data/graph.json）

该文件定义 `web/public/data/graph.json` 的输入规范。只要后端管线输出满足本结构，前端可直接消费。

### 顶层

`meta`
- `version`: 数据版本号
- `generatedAt`: ISO 时间戳
- `edition`: `demo` 或实际发布版本标识
- `notes`: 可选说明

`people`: 人物条目列表
`relationships`: 关系条目列表
`sources`: 史料与参考来源列表
`topicPresets`: 前端默认专题预设（可覆盖）

### people 字段

- `id`: 全局唯一人物 ID（优先使用中性 ID，形如 `person-000001`）
- `legacyIds`: 可选，兼容旧地址的历史 ID 数组（如 `nt-people-*`）
- `nameZh`: 中文名（列表显示主名）
- `nameLat`: 希腊文/拉丁转写
- `aliases`: 别名数组
- `era`: 人物生活时代标签：`旧约背景` / `耶稣时期` / `使徒时期` / `时代待审`
- `books`: 出现/相关书卷数组（书卷码）
- `testaments`: 可选，人物出现约束集合（`nt` / `ot`）
- `testamentCounts`: 可选，`nt` 与 `ot` 出现计数字段
- `mentions`: 可公开的出现位置数组；每项含 `passage`、`location`、`sourceId`
- `identityOptions`: 身份候选项数组
  - `id`: 全局唯一身份 ID
  - `label`: 人类可读身份
  - `status`: `独立` / `传统同一` / `待判`
  - `mergeGroupId`: 传统身份分组 ID（如有）
  - `mergeTargetPersonId`: 合并目标 `person-*`（如有）
  - `displayLabel`: 传统合并展示名（如有）
- `selectedPresetDefault`: `conservative` / `traditional`
- `notes`: 可选说明

### relationships 字段

- `id`: 全局唯一 ID
- `fromPerson`: 关系主语人物 ID
- `toPerson`: 关系宾语人物 ID
- `type`: 关系类型
- `direction`: `outgoing` / `incoming` / `undirected` / `bidirectional`
- `description`: 关系说明
- `evidenceLevel`: `nt_text` / `ot_text` / `ancient` / `modern`
- `testaments`: 可选，关系出现约束集合（`nt` / `ot`）
- `certainty`: `high` / `medium` / `low`
- `sources`: 关联史料 ID 数组
- `passages`: 经文定位字符串数组
- `book`: 关系首次涉及书卷标签
- `books`: 关系全部出处涉及书卷标签
- `era`: 关系语境
- `identityGuards`: 可选，人物别名身份下边的生效规则
  - `personId`
  - `allowedIdentityOptions`: 字符串数组

### sources 字段

- `id`: 全局唯一 ID
- `label`: 来源展示名
- `kind`: `nt_text` / `ot_text` / `ancient` / `modern`
- `url`: 可公开链接（如授权范围允许）

### topicPresets 字段

- `id`: `all` / `herodFamily` / `discipleship` / `family` / `paulTeam` / `acts`
- `name`: 显示名
- `relationTypes`: 筛选类型列表（可为空）
- `bookIncludes`: 书卷包含条件（可为空）
- `eraIncludes`: 人物时代包含条件（可为空）
- `personIncludes`: 人物 ID 包含条件（可为空）
- `evidenceIncludes`: 证据层级筛选（可为空）
- `focusPersonId`: 可选，专题首次打开时的默认焦点人物
- `graphMode`: 可选，`focus` 或 `family_tree`；后者使用完整专题的代际布局
- `personLabels`: 可选，专题内用于区分同名人物的显示名映射；不替代人物权威中文名
- `personRanks`: 可选，家谱布局中的代际行号映射
- `personOrder`: 可选，同一代际中的从左到右人物顺序

字段缺失时前端有降级策略，保证可正常渲染。
