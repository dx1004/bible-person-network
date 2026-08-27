---
version: alpha
name: "新约人物关系网"
description: "一套以透明晶体光路呈现人物关系、同时保持出处可核查与中文易读性的静态研究界面"
colors:
  background: "#071625"
  surface: "#10293A"
  surfaceElevated: "#17394B"
  text: "#F4FBFF"
  textMuted: "#AFC6D3"
  primary: "#69E6FF"
  secondary: "#9DA9FF"
  selection: "#FFE89A"
  evidenceNt: "#65D9FF"
  evidenceAncient: "#7DE3B2"
  evidenceModern: "#C5A7FF"
  warning: "#FFD27A"
  danger: "#FF8EA1"
  border: "#5EC9E2"
typography:
  sans:
    fontFamily: "Inter, PingFang SC, Noto Sans CJK SC, Microsoft YaHei, system-ui, sans-serif"
  serif:
    fontFamily: "Noto Serif SC, Songti SC, STSong, SimSun, serif"
  mono:
    fontFamily: "IBM Plex Mono, SFMono-Regular, Consolas, monospace"
rounded:
  DEFAULT: "0.75rem"
  sm: "0.5rem"
  md: "0.75rem"
  lg: "1rem"
  crystal: "999px"
spacing:
  control-height: "2.75rem"
  panel-gap: "0.75rem"
  page-gutter: "1rem"
  page-max: "100vw"
components:
  button:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.background}"
    rounded: "{rounded.md}"
    height: "{spacing.control-height}"
  icon-button:
    backgroundColor: "{colors.surfaceElevated}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    size: "{spacing.control-height}"
  field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    height: "{spacing.control-height}"
  select:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
  people-list:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.textMuted}"
    rounded: "{rounded.lg}"
  people-list-selected:
    backgroundColor: "{colors.selection}"
    textColor: "{colors.background}"
  graph-canvas:
    backgroundColor: "{colors.background}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
  graph-node-secondary:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.background}"
  inspector:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
  evidence-toggle-nt:
    backgroundColor: "{colors.evidenceNt}"
    textColor: "{colors.background}"
  evidence-toggle-ancient:
    backgroundColor: "{colors.evidenceAncient}"
    textColor: "{colors.background}"
  evidence-toggle-modern:
    backgroundColor: "{colors.evidenceModern}"
    textColor: "{colors.background}"
  relation-row:
    backgroundColor: "{colors.surfaceElevated}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
  status-badge-warning:
    backgroundColor: "{colors.warning}"
    textColor: "{colors.background}"
    rounded: "{rounded.crystal}"
  status-badge-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.background}"
    rounded: "{rounded.crystal}"
  panel-divider:
    backgroundColor: "{colors.border}"
    height: "1px"
  drawer:
    backgroundColor: "{colors.surfaceElevated}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
---

# 新约人物关系网 Design System

## Overview

### Creative North Star

《最终幻想 XIII》Crystarium 的空间轻盈感与发光节点是视觉参照，但界面不复制游戏素材、图标或布局。人物像半透明晶体悬浮在研究画布上，关系像细光路连接；文字、证据和出处仍采用严谨的资料工具结构。

### Product context and register

- **Audience and primary job:** 中文圣经读者、神学生与研究者；快速找到人物，查看一度关系，并回溯经文或史料出处。
- **Target market(s) and evidence:** 第一版面向简体中文读者；项目既定范围要求中文主标签和简体界面。
- **Locale(s) and language policy:** `zh-Hans` 为默认界面语言；希腊文、拉丁转写及别名保持原文。界面用语不把现代工具书关系误称为经文事实。
- **Usage scene:** 桌面研究为主，手机查询为辅。桌面需要高信息密度，手机一次只呈现搜索、焦点图或详情中的一个主要任务。
- **Register:** 研究工具；避免娱乐化任务奖励、升级进度或游戏化措辞。
- **Memorable signature:** 选中人物节点出现晶体光晕，相关边形成由中心向外的清晰光路；证据层用三种固定颜色编码。
- **Restraint:** 搜索、筛选、人物列表、关系说明和出处链接使用熟悉的原生交互与高对比排版。
- **Anti-references:** 不做霓虹赛博朋克仪表盘，不显示不可读的全量节点云，不堆叠卡片，不复制 Final Fantasy 品牌资产。
- **Token ownership/runtime mapping:** 本文件定义设计意图；运行时权威值位于 `web/src/style.css` 的 CSS 自定义属性。严格审计需检查两者一致。

## Colors

底色使用深蓝黑 `background`，而非纯黑。面板为带透明度的 `surface` 与 `surfaceElevated`，通过细边框、模糊和轻阴影建立玻璃层次。`primary` 表示主要交互与选中光路，`secondary` 用于身份状态。三类证据分别固定为 `evidenceNt`、`evidenceAncient`、`evidenceModern`，并始终配文字标签或线型，不只依赖颜色。正文与次要文字分别使用 `text`、`textMuted`。键盘焦点使用 `selection` 的双层轮廓。

## Typography

界面和数据列表使用 `sans`，标题可使用 `serif` 营造文献感。数字、版本和经文定位可使用 `mono`。中文正文最小 14px，关键控制 15–16px；图节点标签在默认缩放下不低于 12px。混合中文、希腊文和拉丁文时允许自然换行，不使用全大写作为层级。

## Layout

桌面为左侧人物索引、中央关系画布、右侧人物详情三栏。顶部工具带横跨全宽，核心搜索保持最显眼。中央默认只显示选中人物的一度关系；没有选中时显示引导态和推荐入口，不绘制全量节点。900px 以下切换为“人物／图谱／详情”单面板模式，图画布保持至少 55vh。重要控制高度为 44px，面板间距为 12px。

## Elevation & Depth

层次来自半透明表面、背景模糊、细发光边与有限阴影。只允许选中节点、选中关系和键盘焦点出现强光。列表行和常规控制不使用持续发光。不得用多个嵌套玻璃卡片制造噪声。

## Shapes

人物节点为圆形晶体；控制与面板使用 8–16px 圆角。关系和证据标签使用小圆角，不把所有静态元数据做成胶囊。分隔线为 1px 半透明线，选中节点边框可增至 3px。

## Components

### Foundational visual states

所有可交互元素提供默认、悬停、`focus-visible`、按下、选中与禁用状态。数据载入时显示带文字的稳定加载区；失败时显示原位错误和重试按钮。空搜索与无关系状态说明原因并提供清除筛选操作。所有动画尊重 `prefers-reduced-motion`。

### Buttons and actions

主要操作使用实心或高亮玻璃按钮；次要操作使用透明描边。图控制为 44px 图标按钮并有可见文本提示或 `aria-label`。按钮在忙碌时保持尺寸，不重复触发。

### Navigation and data display

人物索引是原生按钮列表，可用 Tab、Enter 和方向键浏览。专题与身份使用原生 `select`，证据层使用复选框。关系行显示对象、类型、方向、证据层、确定度与全部出处。点击关系行会高亮对应边，但列表本身始终可独立阅读。

### Forms and overlays

搜索使用原生 `search` 输入，支持中文输入法组合事件并在 300ms 后过滤；清空立即生效。桌面详情固定在右栏，窄屏用非模态抽屉并保留关闭按钮和焦点返回。任何警告都不得横向裁切。

### Iconography

使用 Phosphor Icons 的统一线性图标，默认 18–20px。图标只做辅助，搜索、筛选、缩放、复位、详情与关闭均保留文本标签或准确的无障碍名称。

### Motion

节点选择与光路强调使用 160–260ms 的淡入和轻微缩放。布局变化采用无动画或短过渡，禁止每次键入都重新运行长时间图布局。减少动态模式关闭脉冲、位移和连续光效。

### Content and data visualization

产品语气简洁、审慎、可核查。计数明确区分“人物”“已发布关系”和“当前显示”。默认图是焦点人物的一度网络；完整数据通过人物索引、专题筛选和详情列表访问。边颜色表示证据层，线型/箭头表示方向和确定度；必须同时提供文字图例和关系列表。

## Do's and Don'ts

- **Do:** 让“搜索 → 选人 → 看一度关系 → 核对出处”在首屏完成。
- **Do:** 把晶体发光用于选择与证据层反馈，并保持中文标签清晰。
- **Don't:** 默认渲染 363 个节点形成不可读的点阵。
- **Don't:** 为追求游戏感而牺牲出处、对比度、键盘操作或手机可读性。
