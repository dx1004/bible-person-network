---
version: alpha
name: 圣经人物关系网
description: >-
  轻色研究图谱界面规范：以可读性优先呈现人物关系，强调关系可核查与证据分层。
  遵循 WCAG 2.2 AA 与现有运行参数。
owner:
  modelRuntime: Model B
  runtimeSource: web/src/style-reference.css
colors:
  primary: '#3478d4'
  secondary: '#2f7f49'
  error: '#df6159'
  surface: '#ffffff'
  surface-soft: '#f7f8fa'
  canvas: '#fbfaf6'
  on-surface: '#172033'
  muted: '#667085'
  neutral: '#dce1e8'
  info: '#74a8ef'
typography:
  headline-display:
    fontFamily: Inter, Noto Sans SC, PingFang SC, Helvetica Neue, Hiragino Sans GB, Microsoft YaHei, sans-serif
    fontSize: 34px
    fontWeight: 600
    lineHeight: 1.25
  headline-lg:
    fontFamily: Inter, Noto Sans SC, PingFang SC, Helvetica Neue, Hiragino Sans GB, Microsoft YaHei, sans-serif
    fontSize: 30px
    fontWeight: 600
    lineHeight: 1.25
  headline-md:
    fontFamily: Inter, Noto Sans SC, PingFang SC, Helvetica Neue, Hiragino Sans GB, Microsoft YaHei, sans-serif
    fontSize: 24px
    fontWeight: 600
    lineHeight: 1.3
  body-lg:
    fontFamily: Inter, Noto Sans SC, PingFang SC, Helvetica Neue, Hiragino Sans GB, Microsoft YaHei, sans-serif
    fontSize: 18px
    fontWeight: 400
    lineHeight: 1.45
  body-md:
    fontFamily: Inter, Noto Sans SC, PingFang SC, Helvetica Neue, Hiragino Sans GB, Microsoft YaHei, sans-serif
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.5
  body-sm:
    fontFamily: Inter, Noto Sans SC, PingFang SC, Helvetica Neue, Hiragino Sans GB, Microsoft YaHei, sans-serif
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
  caption:
    fontFamily: IBM Plex Mono, Source Code Pro, Menlo, Monaco, Consolas, monospace
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.4
  micro:
    fontFamily: Inter, Noto Sans SC, PingFang SC, Helvetica Neue, Hiragino Sans GB, Microsoft YaHei, sans-serif
    fontSize: 11px
    fontWeight: 400
    lineHeight: 1.4
rounded:
  none: 0
  sm: 6px
  md: 10px
  lg: 14px
  glass: 16px
  full: 999px
spacing:
  base: 4px
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 20px
  xxl: 24px
  xxxl: 28px
  section-max: 32px
  control-sm: 38px
  control-md: 42px
  control-lg: 48px
  touch-min: 44px
  page-gutter: 16px
  panel-gap: 12px
  section-gap: 18px
  chip-gap: 6px
  search-height: 44px
  search-clear: 32px
  action-width: 52px
  action-height: 44px
components:
  app-root:
    backgroundColor: '{colors.canvas}'
  app-surface:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.on-surface}'
  search:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.on-surface}'
    rounded: '{rounded.md}'
    size: '{spacing.search-height}'
    height: '{spacing.search-height}'
  search-clear-btn:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.muted}'
    rounded: '{rounded.md}'
    size: '{spacing.search-clear}'
    width: '{spacing.search-clear}'
    height: '{spacing.search-clear}'
  top-select:
    backgroundColor: '{colors.surface-soft}'
    textColor: '{colors.on-surface}'
    rounded: '{rounded.sm}'
    height: '{spacing.control-sm}'
  action-btn:
    backgroundColor: '{colors.primary}'
    rounded: '{rounded.sm}'
    width: '{spacing.action-width}'
    height: '{spacing.action-height}'
  control-base:
    height: '{spacing.control-md}'
  control-lg:
    height: '{spacing.control-lg}'
  person-row:
    textColor: '{colors.on-surface}'
    backgroundColor: '{colors.surface-soft}'
  relation-line-base:
    backgroundColor: '{colors.neutral}'
  relation-line-strong:
    backgroundColor: '{colors.primary}'
  graph-label:
    textColor: '{colors.on-surface}'
    backgroundColor: '{colors.surface}'
  identity-help:
    backgroundColor: '{colors.surface-soft}'
    textColor: '{colors.on-surface}'
  evidence-nt:
    backgroundColor: '{colors.primary}'
  evidence-ancient:
    backgroundColor: '{colors.secondary}'
  evidence-modern:
    backgroundColor: '{colors.error}'
  focus-ring:
    backgroundColor: '{colors.info}'
---

## Overview

- 该规范覆盖 `/Users/dx/nt-people/web` 的视觉与交互约束。
- 视觉来源：`gztchan/awesome-design` 为资源索引，不直接复刻其品牌风格；`voltagent/awesome-design-md` 为文档结构参考。
- 运行归属：`Model B`，参数映射到 `web/src/style-reference.css`。
- 风格目标是浅色、研究型、低噪点：关系图可读性优先，关系清单始终可独立核验。

## Colors

- 以 `primary`（蓝）驱动核心交互，`surface` 为白色卡片基础，`canvas` 形成浅色底层。
- `secondary`、`error`、`surface-soft`、`muted`、`info` 提供状态与语义色。
- 所有视觉对比按 AA 要求落地。

## Typography

- `headline-*` 族用于标题与章节层级，`body-*` 用于内容与列表。
- `caption` 与 `micro` 用于提示与元信息；中文正文不小于 `body-sm`。
- 标签与操作文字默认用 `body-sm`（14px）或以上。

## Layout

- 采用 4px 基准间距体系。
- 关键控制尺寸：search 44、clear 32、select 38、base 42、large 48、action `52x44`。
- 列表行高应不低于 `46px` 以保证中文可读。
- 移动端优先显示完整筛选能力，右栏为非模态抽屉。
- 聚焦人物、专题和筛选后的关系图统一采用层级金字塔布局：指向焦点的关系在上，焦点居中，焦点发出或无方向的关系在下；不使用放射式星型排列。
- 家族专题按焦点人物动态排序：年长辈在上，焦点居中，手足在下，子女／后代再下移一层；“家谱／亲属”显示焦点人物的直接家族关系，以及这些直系成员之间已审定的父母、婚姻、手足关系，避免将无关家系混入同一图中。父母／祖先实线、手足紫色点线、婚姻虚线必须同时保留并可辨。父母关系标签按主体性别显示为“父亲”或“母亲”；性别未知或不适用时显示“父母／祖先”。其他关系依照关系方向形成可阅读的层级，并保持关系标签水平排版。
- 图谱切换后自动按可见节点留白适配，并限制初始放大，避免小型关系网被过度放大；用户仍可使用缩放控件与“视图”按钮自行调整。

## Elevation & Depth

- 使用较低阴影与边界色层级表达层次。
- 动效避免持续闪烁；仅入场 160–260ms 淡入/轻微缩放。

## Shapes

- 圆角主用 `sm/md/lg`（6/10/14px），避免过度不一致。
- 与关系图并行保留半透明文字底，提升标签识别。

## Components

- 搜索输入使用 `search-height` 与 `search-clear` 尺寸；清除行为即时响应。
- 顶部选择与按钮尺寸固定于 `control-sm`/`action`。
- 关系类型、方向、证据层在图形与关系清单中同步显示。
- 证据层色按蓝/绿/红编码，不与线条本身抢注意力。
- reduced-motion 必须可切换。

## Do's and Don'ts

### Do

- 保持浅色主题；关系图优先是阅读工具，不是装饰。
- 图例、清单与详情三者保持一致语义。
- 无结果和错误状态提供明确中文提示与恢复操作。

### Don't

- 不使用深色“crystal”风格。
- 不声明当前未见的关系线宽常量作为规范主张。
- 不更改现有功能行为；不发布受限经文原文。
