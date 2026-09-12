# YD v0.3 Phase 3A · Unified Person State Engine（2026-09-12）

Phase 3 的第一刀：建立一个统一回答"**这个人现在实际上在做什么**"的纯领域模块。
它不认识桌宠、不认识 UI，也不落盘 —— 因此 Manual 覆盖、跨模块文案统一与
消费者迁移都留给后续阶段。

## 1. 两个概念从现在起严格分开

```text
Person State（本阶段新增）        Companion Display State（既有）
上课 / 教研 / 会议 / 吃饭 /         busy_class / busy_work / night_sleep /
午睡 / 睡觉 / 通勤 / 专注 / 空闲    eating / nap / wake_up / reminder /
                                  gentle / interaction animation
        ↑                                  ↑
Schedule > Routine > Idle      Person State + 提醒保持 + 交互动画 + 素材映射
```

- 提醒（reminding）、点击 / 拖动 / 轻庆祝、"刚下课"、upcoming 都**不是**人物状态；
  它们是叠加在人物状态之上的表现层，或独立的 next 信息。
- 领域里永远不出现 `busy_class` / `night_sleep` / `wake_up` 这类桌宠视觉命名，
  `tests/state-engine.test.ts` 用逐 5 分钟的扫描守住这一条。

## 2. 新增模块

```text
src/state/types.ts    CurrentState / PersonStateKind / PersonStateSource / meta
src/state/engine.ts   STATE_SOURCE_PRIORITY / getCurrentState / getWorkspaceCurrentStates
```

全部是纯函数：无 IO、无 Electron、无 Store、无 DOM。
本阶段没有任何正式入口 import 它（构建产物不变），消费者迁移留 Phase 3B。

## 3. CurrentState 与优先级

```ts
interface CurrentState {
  personId; kind; label;
  source: 'manual' | 'schedule' | 'routine' | 'idle';
  sourceId?;               // occurrence id 或 Routine 规则 id
  startAt; endAt?;
  priority;                // 来源层优先级
  tentative?; confidence?; // confidence 尚无数据来源，保留给导入链路
  meta?: { title?; place?; scheduleKind?; activity?; routineKind?; conflict? };
}
```

```text
Manual     100   ← Phase 3C 预留，当前没有任何写入路径
Schedule    80
Routine     40   ← 内部重叠仍由 RoutineRule.priority 在 routine.ts 内部裁决
Idle        10
```

## 4. 三种候选

| 来源 | 数据 | kind | label |
| --- | --- | --- | --- |
| Schedule | `occurrences()`（已含 DailyException 修饰） | course→`class`；`activity=research`→`research`；event→`meeting` | 事项标题 |
| Routine | `activeRoutine(profile.routine, now)` | 七个 kind 同名（1:1，不伪造映射） | 规则 label |
| Idle | 以上都没有 | `idle` | 「空闲」 |

- 同刻多条日程：课程优先于会议（与 `BUSY_CLASS > BUSY_EVENT` 一致），同类更晚开始者优先，
  再按 occurrence id；并存事实记录在 `meta.conflict`。
- Schedule 结束瞬间（左闭右开）立即回到 Routine / Idle；跨午夜的睡眠与跨午夜的会议同规则。
- Idle 的 `startAt` 锚在"最近一次结束"（日程或作息）上，没有则退回北京时间当天 00:00，
  因此它是稳定值，不随每次查询漂移；`endAt` 留空表示"暂时没有下一条安排"。
- 查询不存在的档案会明确抛错；`getWorkspaceCurrentStates()` 只投影真实存在的档案，
  顺序取 profiles 显示顺序，身份语义来自档案自身。

## 5. 与现有消费方的关系

本阶段 **不迁移任何消费者**：`live.personStatus()`、`companion-display.resolvePetState()`、
`PetScheduleClock`、`CompanionTimeline` 全部保持原样，运行时行为逐条不变。
测试只锁定一件安全绳：在 Schedule 场景里，引擎的 kind 与 personStatus 的 code 语义一致
（`BUSY_CLASS ↔ class`、`BUSY_EVENT ↔ meeting`、`currentCourse.title ↔ label`、
`conflict ↔ meta.conflict`、`tentative` 透出）。

## 6. 数据库

Phase 3A 不新增任何持久数据：`DOMAIN_VERSION` 保持 **4**，没有 migration，
没有备份格式变化。

## 7. 验收

```text
npm test                                            196/196（+17 条状态引擎用例）
npm run typecheck                                   PASS
npx electron runtime-audit.cjs                      64/64
npx electron runtime-audit-solo.cjs                 33/33
npx electron verify-v0220.cjs                       63/63
npx electron verify-v030-identity-migration.cjs     18/18
npx electron verify-v030-routine-pet.cjs            17/17
npx electron verify-v030-routine-settings.cjs       36/36
```

## 8. Phase 3B 迁移清单（本阶段结束时仍然直接使用旧状态逻辑的地方）

```text
live.personStatus()                       Home / 侧栏 / 托盘 tooltip / mini 面板
live.snapshot()                           people / display / subject 的唯一投影
companionBusinessState() + resolvePetState()   桌宠姿态与提醒保持窗口
getScheduledPetState() / PetScheduleClock      桌宠时间状态缓存
activeRoutine()                           桌宠与设置页（petRoutineSummary）
statusLabel / companionRailLabel / presenceMeta / ui companion detail / tray tooltip
bubbleEvents()                            开始 / 结束 / 提前 5 分钟气泡
```
