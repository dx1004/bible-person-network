# Bible Person Network Data Pipeline

本目录为全圣经人物关系网数据子系统（非 web 层），覆盖新教旧约 39 卷与新约 27 卷。六类版本化数据必须能够重复构建，并支持空库重建与审计输出。

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
- `npm run generate:inference-relationship-review`：根据当前 `assertions.jsonl` 生成“关系推断复核”草稿（含明确关系复审 + 共享父缘兄弟关系候选），默认不改写发布边。
- `npm run validate:inference-relationship-review`：校验推断复核快照并要求 `--check` 对比 hash，保证生成结果与既有断言快照一致。
- `npm run apply:inference-relationship-review`：只应用已经生成、独立复核且哈希未漂移的推论快照；发布命令不得重生成或改写审核决定。
- `node scripts/generate-composite-kinship-inference-review.mjs --apply`：从仍待文本定案的直接关系候选中，筛出恰由两条 active `kinship:parent`／`kinship:child` 断言构成且代际差为二的祖父母候选。每条记录保存两个前提 assertion、人物方向、经文定位、身份／年代／代际／经文／重复关系反证检查，以及 Editorial、Critic、Boardroom 三轮裁决；输出只进入独立审核账本，不直接改写 assertions。
- `node scripts/generate-composite-kinship-inference-review.mjs --check`：复算并校验复合亲属推论快照。已被直接关系总账标为 `covered_composite_inference` 的候选仍须参与复算，避免两个账本形成删除式循环依赖。
- `npm run resolve:old-testament-relationship-pending`：复核并关闭旧约关系待决项。接受必须具有 STEP `source:0002` 的正面结构化关系 token、两个已接受人物端点、有效经文定位及无结构冲突；单向 token 使用较低确定度。该流程禁止引用 Anchor Yale。

推论关系与明示关系分层发布。每条推论至少包含两条已接受前提、可复现规则、身份／年代／代际／经文反证检查、两轮角色复核与 Boardroom 裁决。当前仅允许“同一直接父母的两个子女推导为手足”；共现、同名、沉默、共同祖先、同工、婚姻、联盟和敌对均不得自动推导。网页将其标为“推论关系”，允许单独筛选或关闭。

## 证据与发布边界

公共页面不发布经文原文。`mentions` 与 `assertions` 的 `passage` 字段仅保留章节位置信息（例如 `MAT 4:18-20`），由前端回溯到可读页面/脚注。

## 人物关系审核规则

- `assertion_id` 兼容既有四位格式，并允许新记录使用五至六位数字（`asrt-0001` 至 `asrt-999999`）；既有 ID 不重编号，避免破坏审核前提、路径、Neo4j 导入和公开数据引用。
- 谱系明确陈述“甲是乙的儿子／女儿”时，建立乙 → 甲的直接 `kinship:parent` 边；若谱系省略中间世代或只支持远祖／后裔关系，则不建立跨代直接边，只通过可追溯的多跳路径显示。
- 明确的父系、母系、婚姻与姻亲关系均收录，并在 `relation_subtype` 或编辑说明中标明具体类别；不得用笼统亲属标签掩盖已知类别。
- 亲属细分类固定为 `parent`、`child`、`sibling`、`spouse`（兼容既有 `partner`）、`concubine_partner`、`grandparent`、`grandchild`、`uncle_aunt`、`nephew_niece`、`cousin`、`parent_in_law`、`child_in_law`、`sibling_in_law`、`step_parent`、`step_child` 和 `other_specified`。`concubine_partner` 专门表示经文明确称为妾／妃的伴侣关系，不自动等同普通配偶。有方向的关系按关系来源者／年长辈指向后辈；手足、配偶、堂表亲等对称关系使用无向边。
- 每处 mention 必须独立审定 `mention_sense`：`person`、`people_group`、`tribe`、`nation`、`place` 或 `ambiguous`。只有最终为 `person` 的 mention 可以参与人物关系候选、遗漏关系发现和 2／3／4 跳路径；其余类别保留原始定位和审校记录，但不得生成 Person-to-Person 边。
- 低歧义人物名可由可重复规则完成双轮审校：STEP Proper Names 必须把该词项标为 `PERSON`，目标人物实体必须已接受，锁定和合本该节必须出现其已接受中文名，并且该标签不得属于可兼指支派、民族、国家、地域、后裔或集体的多义名单。犹大、雅各、利未、以法莲、玛拿西、以实玛利、赫、亚衲等多义标签不得使用此批量规则，必须逐节走严格语境审校。
- 新约中和合本未直译姓名但锁定 SBLGNT 确有专名词形时，可使用 `sblgnt-name-audit` 的已接受记录补充判定；必须同时满足人物拉丁转写与经文位置唯一对应，且仍须排除上述多义标签。仅被 STEP 归到某人物、但 SBLGNT 该节没有匹配专名词形的记录，不能据此算作明确名字提及。
- 旧约低歧义人物可用 TAHOT 与 TOTHT 的双重原文标记补充核验：同一经文位置必须在两套锁定文件中都出现该人物“自身名称”段的希伯来文 Strong 编码。人物说明中父母、配偶、子女等关系对象的编码不得参与匹配；多义支派／国家／地域标签仍不得自动接受。
- 经文本身未明确出现该人物之名时，不因后来的新约引用、预言应验或神学解释而把该节算作直接名字提及；这类关联只能作为带出处与确定度的预言／互文／解释路径。例如赛 7:14 与 8:8 不作“耶稣”的直接具名 mention；赛 8:1 的牌上题名保留为 `ambiguous`，赛 8:3 的实际命名才作 `person`。
- 同一人物对可以同时保存多种经文真实关系，不以较低优先关系覆盖较高优先关系。网页图形默认每个人物对只绘制一条最高优先边（亲属优先，其后按证据层级和确定度），详情面板保留并可展开该人物对的全部关系及各自证据。
- `succession` 统一采用“前任 → 继任者”的方向。
- `commission` 只收正式差派、任命、托付或职责，不收普通临时吩咐；宽泛命令词只能生成候选，不能自动成为断言。
- 同一人物对可以并列保存多种有独立证据的关系。排序与默认展示优先级为亲属关系优先，其余关系再按证据层级与确定度排序。
- 攻击某人的国家、城市、民族或军队，不自动推导为两位人物之间的 `hostile`。只有经文明示双方为对手，或直接陈述一方攻击、威胁、逼迫、控告、背叛另一方时，才建立人物敌对边。
- 推论关系必须保留推论标识与可复现前提；合理且无反证并不使推论变成经文明示关系。

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

当前统一人物审校已完成：旧约人物候选 2,720 条（2,685 接受、35 排除、0 待审），跨约身份 108 条（100 接受、8 排除、0 待审），中文主标签与已发布关系断言均无待决记录。SBLGNT 差异审计为 25 条接受、3 条排除、0 条待决。来源 `source:0005` 至 `source:0008` 已完成系统审校；`source:0009` Anchor Yale 已完成词头层与现有 2,912 条断言的自动关系覆盖审计，但完整来源条目覆盖仍受搜索结果上限限制。因此构建报告继续保持 `editorial_review_required`，正式发布闸口不得提前放开。

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

## 多跳关系审计（图路径导航）

- `npm run generate:multihop-relationship-audit`：基于 `data/assertions.jsonl` 的 active 关系构建人物连接最短路径索引（长度 2/3/4）。普通 `connection` 查找时允许从关系两端进入，每一步仍保留原 assertion 方向和实际遍历方向；每个有序人物对只保留一条按人物 ID、assertion ID 稳定决胜的 canonical shortest path。输出 `editorial/multihop-relationship-audit-report.json`；规模合理时同时写出 `editorial/multihop-relationship-audit.jsonl`。
- 已审核通过的 `grandparent`、`grandchild`、`uncle_aunt`、`nephew_niece`、`cousin` 及姻亲直接边，可以同时拥有 `path_purpose: kinship_explanation` 的构成路径。该路径必须排除自己所解释的 assertion，只能由 `parent`、`child`、`sibling`、`spouse`／`partner`／`concubine_partner` 基础亲属边复原，并以 `explains_assertion_id` 指向被解释的直接关系。其他已有直接关系的人物对仍不得重复生成路径。
- 推论生成的复合亲属边不参与普通 2／3／4 跳路径的基础邻接计算，避免祖父母、叔侄、堂表亲或姻亲关系再次形成循环捷径。它们作为直接关系保留，并且只由独立 `kinship_explanation` 路径说明构成。
- `npm run validate:multihop-relationship-audit`：复算并校验快照、输入哈希与路径约束（长度 2/3/4）；复查前提 `assertion` 的 review 汇总；如有多步纯 kinship 路径，仅在无歧义时给出 `kinship_level`。
- 多跳路径仅用于可视化导航：不会改写 `data/assertions.jsonl`，不会生成新直接关系边，也不会入库为发布关系。


## 直接关系候选发现（按文本触发）

- `npm run generate:direct-relationship-discovery`：在已锁定 `source:0003` CUV 全圣经人名标注 + 当前 `data/assertions.jsonl` 基础上，生成直接关系候选稿，输出 `editorial/direct-relationship-discovery.jsonl`，不发布断言。经文中的提示词只用于高召回触发，不等于关系类型结论。
- `npm run validate:direct-relationship-discovery`：复算并校验候选稿快照；不改写已有 assertions，不把路径（A→B→C）当作直接关系入库，路径仅用于审阅查看。
- `node scripts/init-direct-relationship-review.mjs`：为全部直接关系候选生成 Editorial、Critic 与 Boardroom 三阶段账本 `editorial/direct-relationship-review.jsonl`。已有 active 关系、已废止关系、弱词触发、族群语境、明确语法关系和仍需逐节判断的候选分别记录，不能以提示词或共现自动发布关系。
- `node scripts/init-direct-relationship-review.mjs --check`：验证候选覆盖率、三阶段记录、输入快照与稳定输出。明确语法提案仍须经过反证与身份检查后才可写入 `data/assertions.jsonl`。
- 直接关系与多跳路径是两套独立资料：直接关系可经审核写入 assertion；2／3／4 跳路径只解释人物如何连接，绝不反推或生成直接关系。复合亲属直接边与其构成路径可以并存，但路径不写回 assertion。直接关系的确认状态以蓝灰／琥珀线表示，路径长度另用 2／3／4 跳配色表示，关系类型只使用标签色。
- 对 covenant、alliance、prophetic confrontation 等无法安全依赖宽泛词语自动判定的关系，使用固定候选 ID、人物端点和经文定位的受控提案；同节群体、代词不明、同名冲突或仅共现者继续保持待审。

2026-08-30 来源发布决议：ISBE 1915

经批准，公版 *International Standard Bible Encyclopedia*（James Orr 等编，1915，五卷，`source:0010`）取代 Anchor Yale，作为第五项必需的系统来源审校。其范围是完整人物与定位覆盖审计：2,720 个旧约候选全部有记录；不从该来源新增或修改公开关系断言。2026-08-30 后续决定明确不再使用 Anchor Yale（`source:0009`）参与人物、关系或发布门禁；既有文件仅作为历史审计记录保留。ISBE 全文仅保留在本地研究缓存，公开产物只保留定位与原创审校理由。
