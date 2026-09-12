# YD v0.3 Phase 3B · Single Source of Truth（2026-09-12）

Phase 3 的第二刀：把所有"这个人现在是什么状态"的消费者迁移到统一 StateEngine，
并删掉重复的人物状态判断。**Phase 3B 之后，"现在在做什么"只有一个答案。**

## 1. 最终链路

```text
Schedule  ─┐
Routine   ─┼→ StateEngine（src/state/engine.ts，纯函数）
Idle      ─┘        │
                    ▼
              CurrentState
                    │
        live.personStatus()  ← 只做投影：identity + current + next/today/学期
                    │
             Live Snapshot（1 人 1 条 / 2 人 2 条）
                    │
   ┌────────┬───────┼────────┬────────┬─────────┐
 Home     Orb     Mini     Tip     Tray   Companion
```

桌宠另有显示层叠加（提醒保持 / 刚结束的轻庆祝 / 即将开始 / 交互动画），
但叠加只发生在 `companion-display.ts`，永远不会反向写回人物状态。

## 2. 消费方

| 表面 | 消费方式 |
| --- | --- |
| Home 状态行 | `live.statusLabel(status)`（presentation.stateLabel）+ `detail()` |
| Home 焦点条 | `status.current`（kind / label / endAt），不再看 occurrence |
| Orb | aria-label = `statusLabel`；色点 = `presenceStateFor`（tone 来自 `stateTone(CurrentState)`） |
| Mini | `StatusRows`（同一份 statusLabel + detail）+ `display.nightly` |
| Tip（悬停） | 主进程 `hoverTip.text = 别名 · statusLabel` |
| Tray tooltip | 主进程 `别名 · statusLabel`（每秒重算） |
| Companion 状态条 | `companionRailLabel`（`stateShortLabel`） |
| 桌宠姿态 | `currentStateToPetDisplay(CurrentState)` —— 全项目唯一的 kind → 姿态映射 |
| Ta 页状态卡 | `statusLabel` + `status.current`（标题 / 起止时间） |

## 3. Display overlays（与人物状态严格分离）

```text
CurrentState（人物在做什么）
   ├─ 进行中的上课 / 教研 / 会议 / 活动 → busy_class / busy_work
   ├─ 作息时间姿态                      → night_sleep / wake_up / eating / nap（nightRest 只挡视觉）
   ├─ 另一位在忙                        → busy_work（既有"家里正忙"的表现）
   ├─ 刚结束 3 分钟                      → gentle（日程历史 + 当前状态得出的装饰）
   ├─ 即将开始                          → upcoming（日程阶段，不是人物状态）
   └─ 到点提醒保持窗口                   → reminder（最高优先，只影响桌宠）
```

- 提醒、点击、拖动、轻庆祝都不会进入 `CurrentState`；
- 反过来，提醒姿态也不会改变 Orb / Mini / Tip / Tray 的人物文案；
- `display.scheduled` 仍然如实记录"作息本来是午睡"这类分层事实（开会时照记不误），
  但它由 StateEngine 的作息候选给出，Companion 不再自己读 Routine。

## 4. 删除了哪些重复判断

| 旧代码 | 处理 |
| --- | --- |
| `companionBusinessState()` | **删除** —— 职责由 `currentStateToPetDisplay` + 显示层叠加承担 |
| `getScheduledPetState()` / `nextPetScheduleBoundary()` / `PetScheduleClock` | **删除** —— 状态每秒直接由引擎计算，缓存没有性能意义（见 §5） |
| `PersonStatus.research` | **删除** —— 教研由 `current.kind === 'research'` 表达 |
| `PersonStatus.currentCourse / currentEvent` | **删除** —— 由 `current`（kind / label / meta / startAt / endAt）承担 |
| `partnerHeadline()`（`ui/app.ts`） | **删除** —— 统一到 `statusLabel` |
| `presenceMeta`（六态文案表） | **删除** —— Orb 无障碍文案改用 `statusLabel`；presence 只作为 CSS 词汇 |
| `statusLabel()` / `companionRailLabel()` | 保留，但改为 presentation 层的取用函数，不再自己判断状态 |
| `PersonStatus.code`（StatusCode） | 保留为**日程阶段投影**：`BUSY_*` 由 `current.source` 派生；其余（今天无课 / 学期结束 / 尚未录入…）只在 `current.kind === 'idle'` 时补充说明 |

## 5. 为什么删除 PetScheduleClock

Phase 2B 的 `PetScheduleClock` 只缓存"作息 → 桌宠时间姿态"的边界计算。Phase 3B 之后
每次投影都要给出 `CurrentState`（引擎本来就在算 schedule candidates 与作息候选），
缓存不再降低任何真实开销，却引入"运行中改作息要等缓存失效"这一整类风险。
因此整条缓存链路被删除：**任何时刻的状态都由纯函数即时计算**，
`tests/companion.test.ts` 用"时钟回拨仍然正确"的用例锁定这一点。

## 6. Presentation

新增 `src/state/presentation.ts`（唯一文案/颜色层）：

```ts
stateLabel(current)       // 「上课中 / 吃饭中 / 睡觉中 / 通勤中 / 专注中 / 空闲…」
stateShortLabel(current)  // 「上课 / 吃饭 / 睡着 / 通勤…」状态条与紧凑标签
stateTone(current)        // busy / focus / calm / alert（复用 companion-colors 的六色，不新增调色板）
```

领域只描述事实（`kind = meal`、`label = 午饭`），用户看到的词由这里决定。
`commute / focus / custom` 是真实人物状态，只是没有专属桌宠素材 —— 文案照常显示，
姿态交给其它层级，不为"有个画面"伪造语义。

## 7. 数据库

Phase 3B 不新增任何持久字段：`DOMAIN_VERSION` 保持 **4**，没有 migration，
没有备份格式变化（`Event.person` / `Routine` 等仍是 Phase 1–2 的形态）。

## 8. 验收

```text
npm test                                              200/200（+4 条跨消费方一致性用例）
npm run typecheck                                     PASS
npx electron runtime-audit.cjs                        64/64
npx electron runtime-audit-solo.cjs                   33/33
npx electron verify-v0220.cjs                         63/63
npx electron verify-v030-identity-migration.cjs       18/18
npx electron verify-v030-routine-pet.cjs              17/17
npx electron verify-v030-routine-settings.cjs         36/36
npx electron verify-v030-current-state.cjs            44/44（新增：跨表面上限运行时验收）
node verify-v0220-packaged.cjs                        27/27（重新打包后）
```

`verify-v030-current-state.cjs` 用真实 Electron + 受控时钟验证：

```text
09:30 idle（空闲）        11:00 class（上课中）    11:35 class（作息已进入午饭，课程压过作息）
11:45 meal（吃饭中）      12:30 meal（吃饭中）      13:00 idle（今日课程已结束）
提醒到点 → 桌宠 reminder，Orb / Mini / Tip / Tray 仍是「上课中」
```

## 9. 全项目搜索结论

> 除 `src/state/engine.ts` 外，是否还有模块能独立决定"这个人现在在做什么"？

**0。** 剩余基于 `now` 的判断只有三类，都不回答这个问题：

1. **日程阶段投影**（`live.personStatus` 的 `code` / `nextChange` / `next`）——课表层面的事实；
2. **表现层装饰**（`companion-display.lastFinishedEnd` 的轻庆祝窗口）——只改姿态；
3. **DOM 行内标记**（`ui/app.ts` 的 `partnerRow` / `occurrenceCard` 给课表行标"已结束 / 上课中"）——列表渲染。

## 10. Phase 3C 的最小数据模型（只记录，不实现）

```ts
// settings 里 +1 个可选字段即可，不需要新表（DOMAIN_VERSION 5 时随迁移补齐）
interface State { settings: { ..., manual?: Record<PersonId, ManualState> } }

interface ManualState {
  kind: PersonStateKind;      // 复用 Phase 3A 的领域 kind（不含 idle）
  label?: string;             // 缺省用 stateLabel(kind)
  until: number;              // 必填：手动覆盖的结束时刻（毫秒时间戳，北京时间）
  createdAt: number;
  sourceId?: string;          // 未来的"从待办/会议开始专注"入口
}
```

StateEngine 只需在 `getCurrentState` 前插入一层：`manual?.until > now` → 以
`STATE_SOURCE_PRIORITY.manual`(100) 返回候选；过期条目由下一次写入清理（无需定时器）。
