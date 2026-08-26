## New Testament people graph contract (public/data/graph.json)

该文件定义 `web/public/data/graph.json` 的输入规范。只要后端管线输出遵循此结构，前端可直接消费。

### 顶层

`meta`
- `version`: 数据版本号
- `generatedAt`: ISO 时间戳
- `edition`: `demo` 或实际发布版本标识
- `notes`: 可选说明（如 `demo`）

`people`: 人物条目列表
`relationships`: 关系条目列表
`sources`: 史料与参考来源列表
`topicPresets`: 前端默认专题预设（可覆盖）

### people 字段

- `id`: 全局唯一 ID
- `nameZh`: 中文名（列表显示主名）
- `nameLat`: 希腊文/拉丁转写
- `aliases`: 别名数组（含中文别名）
- `era`: 所属时代标签（如 `初代教会`）
- `books`: 出现/相关书卷数组（如 `马太福音`）
- `identityOptions`: 可选项数组。每项：
  - `id`: 全局唯一身份 ID
  - `label`: 人类可读身份
  - `status`: `独立` / `传统同一` / `待判`
- `selectedPresetDefault`: `conservative` / `traditional`
- `notes`: 可选说明

### relationships 字段

- `id`: 全局唯一 ID
- `fromPerson`: 关系主语人物 ID
- `toPerson`: 关系宾语人物 ID
- `type`: 关系类型（关系网络允许的枚举之一）
- `direction`: `outgoing` / `incoming` / `undirected` / `bidirectional`
- `description`: 关系说明
- `evidenceLevel`: `nt_text` / `ancient` / `modern`
- `certainty`: `high` / `medium` / `low`
- `sources`: 关联史料 ID 数组
- `passages`: 经文定位字符串数组（如 `太6:9-13`）
- `book`: 关系首次涉及书卷标签
- `era`: 关系年代/语境
- `identityGuards`: 可选，若人物别身份，列出该边在每个身份上的生效规则
  - `personId`
  - `allowedIdentityOptions`: 字符串数组
- `editingNotes`: 可选审校备注

### sources 字段

- `id`: 全局唯一 ID
- `label`: 来源展示名
- `kind`: `nt_text` / `ancient` / `modern`
- `url`: 可公开链接（如授权范围允许）

### topicPresets 字段

用于专题视图的快捷筛选：
- `id`: `all` / `discipleship` / `family` / `paulTeam` / `acts`
- `name`: 显示名
- `relationTypes`: 筛选类型列表（可为空）
- `bookIncludes`: 书卷包含条件（可为空）
- `eraIncludes`: 时代包含条件（可为空）

字段缺失时均有降级策略，保证前端可正常渲染。
