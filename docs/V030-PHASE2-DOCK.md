# YD v0.3 Phase 2 · Dual Status Dock（2026-09-13）

Phase 2 的目标：**彻底退出单球体设计框架**，用 YD Dual Status Dock 取代右下角的 legacy
黄色玻璃悬浮球。本阶段不动课表、设置页与其他模块，也不改应用版本（保持 `0.2.20`）。

## 1. 废弃对象与处置

legacy「双状态球」的视觉与结构全部退役：

| 项目 | 处置 |
| --- | --- |
| `.presence-orb` / `.presence-surface` / `.identity-mark` | **删除**（组件与 CSS 一起移除） |
| 深金玻璃渐变（`rgba(224,178,52) → rgba(126,92,12)`） | **删除**，`src/ui/style.css` 的配色覆盖块一并移除 |
| D / Y 字母身份标记 | **删除**，改为读取档案显示名 |
| 96–102px 正方形窗口 + 圆形 `setShape` | **删除**，改为圆角矩形窗口 |
| 旧悬浮球文案（设置 / 菜单 / README） | 更新为「状态浮标（Dual Status Dock）」 |

保留的部分：窗口位置持久化（`settings.orb`）、拖动锚点与主进程移动循环、点击穿透策略、
托盘与全局快捷键、`settings.pet.mode` 的历史值 `'orb'`（语义已经是 Dock，不做数据迁移）。

## 2. 新组件

```
┌──────────────────────┐
│ ● Alex   上课中 至16:50 │
│ ● Sam    午睡中        │
└──────────────────────┘
```

- **人物 label 来自档案**（`Profile.name`），不硬编码 Y / D；「我 / TA / 丹 / 喻老师」都由数据决定。
- **状态来自 `CurrentState`**：文案经 `live.statusLabel()`，与首页 / Mini / Tip / 托盘同源；
  进程内没有任何第二套状态算法。
- 进行中且有可信结束时刻时才补「至 HH:MM」；没有可靠数据就不显示。
- **Solo 自动折成一行**：不保留空的同行者行，窗口尺寸不变（拖动热区稳定）。
- 行顺序按 `profiles` 的显示顺序（本人优先），身份语义来自 `role`，不靠数组位置猜人。

## 3. 视觉

| 项目 | 取值 |
| --- | --- |
| 表面 | `rgba(255,255,255,.94)` mist 白，无渐变、无发光 |
| 边框 | 1px `rgba(36,50,59,.10)` |
| 阴影 | `0 6px 18px rgba(36,50,59,.06), 0 1px 2px rgba(36,50,59,.04)` |
| 圆角 | 12px（CSS `border-radius` 与窗口 `setShape` 用同一组数字） |
| 窗口 | small 150×56 / medium 166×62 / large 182×70；可见表面按 4px 内缩 |
| 字体 | label 11.5px / 560；状态 11px / 450；`tabular-nums` |
| 状态色 | 复用 `companion-colors` 六色语义（空闲绿 / 即将琥珀 / 忙碌橙 / 专注蓝 / 冲突红 / 未知灰） |

没有厚重的 glassmorphism、没有大面积 `backdrop-filter`，也不使用游戏化 HUD 元素。

## 4. 交互

- **Hover**：轻量状态提示（既有的 tip 窗口），不做巨大 tooltip。
- **Click**：展开既有 Mini 面板（当前状态 / 来源 / 下一项 / 预计结束），不新建第二套详情面板。
- **拖动**：开始拖动立即清理 hover / tooltip；拖动中不产生 tooltip、不形变、不残留
  `is-dragging`；结束后保存位置并按需重算。
- **右键**：既有自绘菜单（打开 / 详情 / 设置状态 / 样式切换 / 气泡 / 隐藏 / 退出）。

## 5. 本阶段修复的既有缺陷

启动位置回收使用了占位尺寸（300×128）而不是即将创建的真实画布尺寸，
会把一个本来合法的保存位置挤到屏幕另一侧。现在 `clampPosition` 接受目标尺寸，
首次启动的默认位置也按当前模式的真实画布留 24px 边距。该缺陷由
`verify-v030-dock.cjs` 的 restart 步骤锁定。

## 6. 验证

| 命令 | 覆盖 |
| --- | --- |
| `npm test` / `npm run typecheck` | 240 项单测（含 Dock 布局常量与 legacy 残留守卫） |
| `npx electron verify-v030-dock.cjs` | Together：结构 / label / hover / click / drag / 快速拖动 / drag→leave / drag→click / 位置落盘 + 重启恢复 |
| `npx electron runtime-audit.cjs` | Together 端到端（含 Dock 两行、窗口形状、状态映射、拖动与 tooltip 规则） |
| `npx electron runtime-audit-solo.cjs` | Solo：Dock 单行退化、无幽灵同行者行 |
| `npx electron verify-v0220.cjs` | 桌宠画布 / 菜单 / 样式切换 / 隐藏显示 |
| `npx electron scripts/visual-mist.cjs` | 主窗口视觉回归 |

Solo 工作区无法在本脚本里播种（应用没有 solo 种子命令），因此 Dock 的 Solo 行为由
`runtime-audit-solo.cjs` 使用它自带的 Solo fixture 覆盖。

---

# 2026-09-14 收口 · 按 Asset 04 / 单人参照图复刻

本轮把状态牌与详情面板的视觉**按参考稿量取后 1:1 复刻**，不再由实现自由发挥。
量取方法：直接读参考图的像素（边框 / 墨高 / 圆角 / 间距），换算成 CSS 取值。

## 1. 状态牌（默认 / Hover）

| 项目 | 参考稿量取 | 实现取值 |
| --- | --- | --- |
| 形状 | 两端完整半圆（pill） | `border-radius:999px` |
| 首字母 | 墨高 ≈ 牌面高度的 35%（衬线） | `24px Georgia 衬线`（牌面 50px） |
| 状态点 | 直径 ≈ 高度 20%，实心 | 10px 实心（无外环、无发光） |
| 状态文字 | 墨高 ≈ 高度 20% | `14px / 580` |
| 次级信息 | hover 出现，与状态文字左对齐 | `.dock-extra` 10.5px 灰 |

**Hover 机制**：点击穿透窗口（`WS_EX_TRANSPARENT`）里 **CSS `:hover` 不会生效**，
因此整块状态牌一起显露第二行由渲染层的真实指针状态驱动（`onPointerEnter` →
`.dock-surface.is-expanded`）。这条约束已写进 `verify-v030-dock.cjs` 的断言。

**Hover 生长**：参考稿里 hover 的牌面比默认高约 1.4×（Solo 约 1.24×）。实现方式是把
这份差量**预留在固定画布内**：窗口高度 = 默认牌面 + 生长量 + 8px 阴影画布
（Together 中档 276×78、Solo 中档 164×70），可见牌面底边固定、向上生长
（`transition: height 150ms`）。窗口本身永不改变尺寸或位置，拖动锚点因此不受影响；
命中 / 拖动区域（`.pet-handle`）只覆盖当前可见牌面，画布上方多出来的部分保持点击穿透。

## 2. 详情面板

| 形态 | 参考稿 | 实现 |
| --- | --- | --- |
| Together | 卡片 520×350 | 卡片 560×350（宽 40px 用于容纳真实中英混排标题），窗口 584×391 |
| Solo | 卡片 632×341 | 卡片 620×340，窗口 644×383 |
| 尾部 | 底部正中三角，指向状态牌 | `.mini-tail` 54×27，卡片与窗口底边之间 |
| 窗口 | — | 卡片 + 四周 12px 阴影画布 + 底部 27px 三角区 |

- Together：`我们 · 此刻` + 说明 + 右侧品牌块（YD 字标 / YD / canonical tagline）；
  两块等权 person 区域、贯通分隔线、「下一个」带语义图标与箭头（有下一项时整行可点，打开 YD）。
- Solo：`我的 · 此刻` + 右上 YD / 设置；两块圆角块（当前状态、下一项安排 + 打开 YD 按钮）+ 页脚。
- 面板内容全部来自 CurrentState / 日程投影 / Profile；参考稿里的示例文案不写死。
- 原生窗口阴影已关闭（`hasShadow:false`），阴影只由 CSS 在窗口画布内绘制并收敛，
  避免"Windows 原生阴影 + CSS 阴影"叠成黑框。

## 3. 语义色（唯一来源 `src/companion-colors.ts`）

| 语义 | 取值 | 使用场景 |
| --- | --- | --- |
| 空闲 / 休息 | `#C18A9C` dusty rose | 空闲、休息、睡眠 |
| 即将开始 | `#D7AD59` amber | 即将上课 / 即将有安排（**不再是红色**） |
| 进行中 | `#55A995` sage teal | 上课、活动、忙碌 |
| 专注 | `#60998F` sage teal（深一档） | 教研、专注 |
| 已完成 | `#9AA79F` sage gray | 今日结束 / 学期结束 |
| 冲突 | `#C2726A` | 只有真正的安排冲突才用红 |

## 4. 本轮验证

| 命令 | 覆盖 |
| --- | --- |
| `npm test` / `npm run typecheck` / `npm run build` / `npm run assets:check` | 单测 241 项、类型、构建、品牌资源契约 |
| `npx electron verify-v030-dock.cjs` | Together：结构 / pill 圆角 / hover（合成 + 真实指针）/ click / drag×20 / 位置落盘 + 重启 |
| `npx electron verify-v030-dock-layering.cjs` | Win32 层级：topmost / 覆盖窗口 / 真实 Edge / 桌面切换 / 阴影 alpha |
| `npx electron runtime-audit.cjs` | Together 端到端（含详情面板尺寸与内容完整性） |
| `npx electron runtime-audit-solo.cjs` | Solo：单行状态牌 / Solo 详情面板 / 无幽灵第二列 |
