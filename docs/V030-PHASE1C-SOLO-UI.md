# YD v0.3 Phase 1C · Solo UI / Pet Compatibility（2026-09-12）

Phase 1C 是 Phase 1 的收尾：让现有所有窗口第一次能安全渲染 1 人 / 2 人两种合法 State，
并解除桌宠"必须存在同行者"的运行时假设。**没有做视觉重设计，也没有加入任何
"个人模式 / 双人模式" 创建入口（Onboarding 属于后续阶段）。**

## 1. 人员派生的界面外壳

新增 `src/ui/shell.ts`（纯派生，可单测）：

| 函数 | 作用 |
| --- | --- |
| `shellTabs(state)` | 导航项：本人页永远存在；**同行者页只在同行者存在时出现**（Solo 不再保留空白的 Ta 页） |
| `tabShortcuts(tabs)` | 数字键沿用"第 N 个标签页"的位置语义 |
| `personOptions(state)` | 「所属课表」下拉由实际 profiles 生成 |
| `courseTableLabel / profileLabelFor` | 本人 →「我的课表」，同行者 →「<档案名称>的课表」 |

`src/ui/app.ts` 的标签页从"固定 key"改为"档案派生的 tab 列表 + kind"：
页面宽度策略仍然按 kind（`page-person` / `width-partner`），因此 Together 视觉零变化；
Solo 少一页，其余页面宽度与内容不变。选中档案在 Solo / 自定义 id 下自动回退到本人，
不再出现 `undefined.startDate` 之类的崩溃。

## 2. 桌宠主体（Pet subject）

`src/people.ts` 新增：

```ts
resolvePetSubject(state) = getCompanionProfile(state) ?? requireSelfProfile(state)
```

- Together：仍然代表同行者（当前产品行为 100% 不变）。
- Solo：代表本人（自己的课程 / 会议 / 教研驱动姿态）。

`companionBusinessState(people, now, subjectId)` 与 `CompanionDisplayInput.subjectId` 现在必须显式传入主体，
`companion-display.ts` 不再直接查找 `'partner'`，也不使用 `people[1] ?? people[0]` 这类位置语义。

## 3. 悬浮球 / 提示 / 小面板

| 表面 | Solo 行为 |
| --- | --- |
| Floating ball | 只渲染 1 个状态区域（新增 `.presence-surface.solo` 一条 CSS，尺寸/配色不变），无幽灵第二栏 |
| Presence tip | 位置按"这个人在投影里的位置"计算（单人居中），不再按 me/partner 硬编码左右 |
| Mini panel | 1 条状态行；标题从「此刻，我们」自动变为「此刻」 |
| Menu / Tray | 菜单无人员项；托盘 tooltip 只列实际档案，无 phantom / undefined |
| Panel | 导航 6 项、课表归属下拉 1 项、设置只列本人作息、逐页无空白 |

## 4. 身份 hardcode 终审（A / B / C）

**A. 合法 legacy compatibility（保留）**

- `src/people.ts`：`LEGACY_SELF_ID='me'` / `LEGACY_COMPANION_ID='partner'`（唯一的兼容解析处）。
- `src/core.ts:17`：`initial()` 的默认双人档案（当前默认产品体验）。
- `src/migration.ts`：`LEGACY_V2_RULES`（旧称呼 / 旧暂定学期 / 旧教研课名），只在版本化迁移里使用。
- 注释：`core.ts` / `live.ts` / `companion-display.ts` / `types.ts` / `migration.ts`。

**B. 合法 UI 文案**

- 「我的安排」「我的课表」（本人语义）。
- 「<同行者显示名称>的课表 / 的日程」（由 `Profile.name` 生成，默认就是产品里的 Ta）。
- 「此刻，我们」仅在 2 人时出现，Solo 显示「此刻」。

**C. 不应该剩余的业务身份 hardcode：0 处。**
`src/` 已无 `profiles[0]` / `profiles[1]` 的业务依赖，也没有固定 `Ta` 的可见文案。

## 5. 验收证据

| 检查 | 结果 |
| --- | --- |
| `npm test` | 148 / 148（Phase 1B 为 141；新增 7 条 Solo UI / Pet / 导航 / 归属用例） |
| `npm run typecheck` | 通过 |
| `npx electron runtime-audit.cjs`（Together） | 64 / 64 |
| `npx electron verify-v0220.cjs`（桌宠 / 提醒 / 菜单） | 63 / 63 |
| `npx electron verify-v030-identity-migration.cjs`（v1 → v3 迁移链） | 15 / 15 |
| `npx electron runtime-audit-solo.cjs`（新，Solo） | 33 / 33 |
| 打包 | `npm run dist` 在 github.com 不可达时按 README 的镜像方式重建 `release/win-unpacked` + `YD-Setup-0.2.20.exe`，随后 `verify-v0220-packaged.cjs` **27 / 27** |

## 6. Phase 2 前置：RoutineProfile / RoutineRule 的最小边界

见本次交付说明的最后一节（记录在聊天交付里，不在本文件重复）。
