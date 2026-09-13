# YD UI Convergence Plan · Phase 0 Baseline（2026-09-13）

本文档冻结下一轮「产品化升级」的**视觉与工程基线**，只记录事实、约定与阶段边界，
不在本阶段做任何页面重构、颜色替换、版本变更或打包。Phase 0 只新增这一个文件。

## 1. Git / 版本基线

| 项目 | 值 |
| --- | --- |
| Branch | `v0.3-productization` |
| Phase 0 initial HEAD | `9a9dbc9`（chore: clarify current release verification gates） |
| Application Version | `0.2.20`（`package.json`；本轮**保持原版本**，不改号） |
| DOMAIN_VERSION | `6`（Avatar Selection，见 `src/migration.ts`） |
| Working tree（Phase 0 开始时） | clean，无未提交修改、无未跟踪文件 |
| Excluded tags | `v0.2.20-demo-stable`、`v0.3-avatar-stable` |

Phase 0 开始时的 `git status` 为 clean，**没有发现用户已有未提交修改**，
因此本阶段没有需要保留或绕开的用户改动。

## 2. 冻结的视觉基线

本轮的正式视觉基础是**当前主窗口界面（Mist visual system）**，不再回退到此前的金黄色版本。
实现落点是 `src/ui/style.css` 中 `body.main-body { … }`（约 2177–2398 行）覆盖层，
由 `src/ui/app.ts` 在挂载时给 `document.body` 添加 `main-body` 类生效。

核心气质：quiet · restrained · modern · desktop-native · local-first · calm intelligence。

冻结的视觉体系：

1. 雾白 / 冷暖中性浅底
2. muted sage / deep teal 品牌色
3. graphite 主文本
4. soft blue-grey 次级层级
5. 极轻边框和阴影
6. 统一线性导航 icon（lucide-react，`strokeWidth: 1.75`）
7. 当前 YD monogram 为正式品牌 Logo 方向

明确废弃（不再 polish、不再作为新页面参考）：

- 大面积暗金色
- 明黄色 primary button
- 金黄色悬浮球
- 深色侧栏
- 重玻璃拟态
- 高饱和渐变
- dashboard / SaaS 感
- 旧式「事务助手」品牌语言

品牌资产以 `brand/exports/` 与 `src/ui/assets/gen/` 为准；`src/ui/brand.ts` 的 `YD_COLORS`
已是新的灰绿值（历史字段名 `gold/goldDeep` 仍保留，值与语义已改为 sage/teal）。

## 3. 设计 Token 审计（只列出，不在 Phase 0 替换）

### 3.1 颜色 token 来源

| 来源 | 位置 | 说明 |
| --- | --- | --- |
| `:root` 基础层 | `src/ui/style.css` 6–48 行 | 当前仍为**黄铜金 legacy 值**（见 3.3），实际由 `body.main-body` 覆盖 |
| Mist 主题层 | `src/ui/style.css` 2177–2204 行 | 主窗口正在使用的 sage / teal 体系，冻结为基线 |
| Companion 表面 | `src/ui/presence-orb.css` | 悬浮球独立 token（`--orb-edge`、`--status`、`--status-rgb`），不继承主窗口 |
| Tone 色 | `src/companion-colors.ts` | 桌宠语义色唯一来源：calm `#8CBE9E` / upcoming `#D6AE6A` / busy `#DE9A63` / focus `#8FAED2` / alert `#C2726A` / neutral `#A3ACB0` |
| 课程色 | `src/selectors.ts`（`courseTones`） | `sea/blue/violet/rose/amber`，按课程 id 哈希，跨视图稳定 |

当前主窗口（`body.main-body`）冻结值：

```
--yd-ink: #24323B          graphite 主文本
--yd-ink-2: #35464F
--yd-muted: #687782        soft blue-grey 次级
--yd-faint: #87959D
--yd-canvas: #F3F6F7       雾白底
--yd-surface: #FFFFFF
--yd-surface-2: #F7FAFA
--yd-line: #DDE5E7         极轻边框
--yd-line-2: #C9D5D7
--yd-brand: #466C6A        muted sage / deep teal
--yd-brand-deep: #365653
--yd-brand-soft: #E4EEEE
--yd-brand-line: #C9DAD9
--yd-sage: #466C6A
--yd-accent: #B48FA5       低饱和玫瑰灰（Ta / 状态点缀）
--yd-accent-soft: #F4EDF1
--yd-sidebar: rgba(247,250,250,.88)
--yd-sidebar-2: rgba(240,245,245,.94)
--yd-sidebar-ink: #53636C
--yd-sidebar-strong: #24323B
--yd-sidebar-hover: rgba(70,108,106,.07)
--yd-sidebar-active: #E4EEEE
```

### 3.2 spacing / radius / shadow / 字号：**目前没有 token**

审计结论：项目**没有** `--yd-space-*`、`--yd-radius-*`、`--yd-shadow-*` 变量。
这些维度全部是字面量：

- `border-radius` 字面量约 145 处，取值 2–26px 及 999px 共 21 种；
- `box-shadow` 字面量约 96 处、82 种不同值；
- spacing（gap/padding/margin）字面量覆盖 1–60px 多档，无收敛序列。

主窗口覆盖层已从 `14–16px` 圆角、极轻阴影起步，但没有系统化 token；
这是后续 Phase 收敛「视觉一致性」的候选工作，本阶段只登记。

### 3.3 legacy 金色 / 旧变量清单

`:root` 基础层仍保留旧暖金 family（当前只在 companion legacy 表面兜底，主窗口已被覆盖）：

```
--yd-brand: #B08E4A          （黄铜金）
--yd-brand-deep: #7A6230
--yd-brand-soft: #F6EFDC     （浅香槟底）
--yd-brand-line: #E3D4B0
--yd-gold: #E4C87C
--yd-sage: #B08E4A           （历史变量名，现指品牌金）
--yd-amber: #9A7A45
--yd-amber-soft: #F6F1E7
--yd-sidebar-hover/active: rgba(200,144,16,…)   （暖金叠加）
```

散落的 inline gold / amber / ochre hex（`src/ui/style.css`）：

```
412  .course-block.amber   #f3ead5 / #eadfbe
1147 border var(--yd-brand-line,#E3D4B0) 兜底
1170 .pet-menu-mark color var(--yd-brand,#B08E4A) 兜底
1174 .pet-menu-sep var(--yd-brand-line,#E3D4B0) 兜底
1604 .warning              #7A5E33 + var(--yd-amber-soft)
1748 .course-block.amber   #F0EADB / #E6DFC9
1808 .partner-row.tone-amber        #947A45
1856 .day-rail-seg.tone-amber       #947A45
2081 .course-block.amber   #F1EBDD / #E7DFCB
```

其余 legacy 残留：

| 位置 | 现状 | 说明 |
| --- | --- | --- |
| `src/ui/style.css` 60–79 行基础 `button` / `.primary` / `.secondary` | 走 `--green`→`--yd-brand` 与暖灰字面量（`#fbfaf7`、`#30352f`、`.eyebrow #747b72`） | 被 `body.main-body` 覆盖，但仍是 companion / 旧表面兜底 |
| `src/ui/style.css` ~95–110 行 `.sidebar` | `#222823` 深色侧栏（legacy） | 主窗口已覆盖为浅底；仅登记 |
| `src/ui/style.css` 课程色 5 套重复定义（408–412 / 1744–1748 / 2077–2081） | 三份 `course-block.*` 渐变并存 | 视觉一致性债，Phase 内收敛 |
| `src/selectors.ts:17`、`src/ui/app.ts` | 注释与文案中的「Ta 的日程」 | 与产品问题 A 同源 |

### 3.4 状态色映射（权威来源）

- 领域状态：`src/state/engine.ts`（`STATE_SOURCE_PRIORITY`、`getCurrentState`）
- 表现文案与 tone：`src/state/presentation.ts`（`stateLabel` / `stateShortLabel` / `stateTone` / `stateSourceLabel`）
- 桌宠语义色：`src/companion-colors.ts`
- 课程色：`src/selectors.ts` 的 `courseTone`

tone → 含义：calm（空闲）/ upcoming（即将）/ busy（上课·活动·忙碌）/ focus（教研·专注）/
alert（冲突，真警示）/ neutral（未知）。

## 4. CurrentState 保护规则（不得违反）

`CurrentState`（`src/state/engine.ts`）永远是**人物当前状态的唯一权威来源**。

固定优先级：`manual (100) > schedule (80) > routine (40) > idle (10)`。

- `DailyException` 只修饰 schedule candidate（体现在 `occurrences()` 的输出里），不参与这个排序，
  也不构成竞争对手。
- `reminding / click / drag / celebration / upcoming` 属于 Companion Display，永远不进入 `CurrentState`。
- 任何后续 UI 改版**不得**在 React 层重新推导人物状态；
  UI / 桌宠只能投影或装饰 `CurrentState`，取词与取色一律经 `presentation.ts`。
- 人物是谁由 `Profile` 决定：`src/people.ts` 的 `role`（self / companion）与兼容别名解析是唯一入口，
  不得假设固定两个人，也不得从数组位置推断身份。

## 5. 本轮必须解决的产品问题（本阶段只登记，不实现）

| 编号 | 问题 | 下一阶段目标 |
| --- | --- | --- |
| A | 「Ta 的课表」与「我的安排」信息层级不一致 | 统一为「我的安排 / TA 的安排」；TA 只是默认 UI label，companion 有自定义 `name` 时优先展示用户 label，领域层不假设固定两人 |
| B | 「我的今日日程」与「TA 的日程」同类信息两套视觉 | 建立统一 Daily Summary / Daily Timeline 组件 |
| C | TA 大窗口空状态布局失衡 | 重排空状态（复用 `EmptyState` 的稳定结构） |
| D | 课表管理只有编辑态 | 增加一屏只读完整周课表 Overview |
| E | 未处理提醒 / 通知收件箱大窗口密度过低 | 提升大窗口信息密度 |
| F | 设置页信息架构过长，「桌面陪伴 / 桌宠陪伴」语义层级不清 | 重组信息架构与分组 |
| G | 角色系统 UI 保持 self / companion 易理解结构，底层不能硬编码两人 | 保持 `role` 抽象，UI 只做展示投影 |
| H | 旧暗金色仍有视觉残留 | 收敛 3.3 清单（本阶段仅登记） |
| I | 黄色玻璃球正式定义为 legacy UI | 停止对其 polish，替换为新的 Dual Status Dock |

## 6. 阶段划分与预计 commit 边界

本阶段（Phase 0）只提交本文件。后续阶段各自独立，一个阶段一个可验证 commit：

| 阶段 | 目标 | 预计 commit |
| --- | --- | --- |
| Phase 0 | 视觉 / Git / 工程基线冻结（本文档） | `docs: define YD UI convergence baseline` |
| Phase 1 | 标签与信息架构统一（问题 A、G） | `ui: unify schedule labeling around self and companion` |
| Phase 2 | 统一 Daily Summary / Daily Timeline（问题 B） | `ui: introduce unified daily summary and timeline` |
| Phase 3 | TA 大窗口空状态（问题 C） | `ui: rebalance companion empty state` |
| Phase 4 | 课表只读 Overview（问题 D） | `feat: add read-only weekly schedule overview` |
| Phase 5 | 提醒 / 收件箱大窗口密度（问题 E） | `ui: raise wide-window density for inbox and reminders` |
| Phase 6 | 设置页信息架构（问题 F） | `ui: restructure settings information architecture` |
| Phase 7 | legacy 金色清理与 token 收敛（问题 H） | `refactor: retire legacy gold palette from main surfaces` |
| Phase 8 | Dual Status Dock 替换黄色玻璃球（问题 I） | `feat: replace legacy orb with dual status dock` |

每个阶段的 commit 边界以「可独立验证、不夹带无关改动」为准；实际拆分可细化，但不得合并跨阶段范围。
Phase 8 之前不动 `presence-orb.css` 的 legacy 球体外观（仅保持现状运行），避免与主窗口收敛互相干扰。

## 7. 验证与回滚

- Phase 0 仅新增文档：检查 `git diff` / `git status` 即可，**不运行打包**。
- 后续阶段若改动代码，按根 `AGENTS.md` 执行 `npm test`、`npm run typecheck` 与相关
  `verify-*.cjs` / 视觉脚本（主窗口视觉回归用 `npx electron scripts/visual-mist.cjs`）。
- 阶段验收门禁以 `docs/verification-v030.md` 为准；本计划不新增门禁。
- 回滚：Phase 0 只有一个文档提交，revert 该 commit 即可；不动应用版本与安装包。
