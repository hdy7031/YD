# YD v0.3 Phase 2B · Routine-driven Pet Schedule（2026-09-12）

Phase 2B 只做一件事：**桌宠的吃饭 / 午睡 / 起床 / 夜间睡眠四种时间状态改为读取
`Profile.routine`，并删掉运行时写死的生活作息时间表**。默认迁移用户（同行者持有
`legacy-default` 作息）的逐分钟视觉行为与 0.2.20 完全一致；本轮没有 Routine 设置 UI。

## 1. 数据流

```text
resolvePetSubject(state)          // 身份层：Together=同行者，Solo=本人
        ↓
subject.routine (RoutineProfile)  // v4 起每个档案都有
        ↓
src/routine.ts                    // activeRoutine / nextRoutineBoundary（纯领域）
        ↓
RoutineOccurrence
        ↓
companion-display.ts 的适配器     // routineKindToPetState / getScheduledPetState
        ↓
Pet（orb / bubble / mini / tip / tray 同一份投影）
```

Routine 领域模块不依赖桌宠：`src/routine.ts` 里没有素材、PNG、display key、Electron。

## 2. Routine → Pet 映射

| Routine kind | 桌宠状态 |
| --- | --- |
| `sleep` | `night_sleep` |
| `wake` | `wake_up` |
| `meal` | `eating` |
| `nap` | `nap` |
| `commute` / `focus` / `custom` | `null`（**不伪造语义**，交给 business / reminder / idle 决定姿态） |

## 3. 删除了什么

`src/companion-display.ts` 中删除：

```text
companionSchedule / PetScheduleSlot
localMinutes / scheduledStateAtMinutes
petStateChangeMinutes
nightRestWindow / nightRestText / withinNightRest
```

这些时间现在只存在于 `src/routine.ts` 的 `LEGACY_DEFAULT_ROUTINE_TIMES`（迁移默认值与
工厂）与 tests / docs 里，运行时的桌宠判断不再出现任何写死时间。

新的 API（都要求显式传入作息，不再偷偷读全局常量）：

```ts
routineKindToPetState(kind)                       // 唯一映射
getScheduledPetState(routine, now)                // 主体此刻的时间状态
nextPetScheduleBoundary(routine, now)             // 下一个会换姿态的边界；没有则 Infinity
new PetScheduleClock().read(routine, now, opts)   // 缓存；缓存键 = updatedAt + 规则内容
petRoutineSummary(routine)                        // 设置页文案（睡觉时段 / 其它时段）
```

`live.snapshot()` 仍然是唯一投影：缺省 `scheduled` 时按主体 Routine 现算；主进程把
`PetScheduleClock` 的结果传进去，只是同一纯函数的缓存。

## 4. 优先级（保持不变）

```text
交互反馈（点击 / 拖动）
  > 业务状态（上课 / 教研 / 会议 / 活动 / 刚结束的轻庆祝）
  > 待处理提醒保持窗口
  > Routine 时间状态（sleep / wake / meal / nap）
  > upcoming / idle
```

例：Routine 11:30–12:00 吃饭、课表 11:40–12:30 上课 → 11:45 显示 `busy_class`，
`display.scheduled` 仍照实记录 `eating`（Phase 3 的 StateEngine 复用同一份数据）。

## 5. nightRest 兼容策略

- `settings.pet.nightRest` 仍是**视觉设置**：`false` 只阻止 `night_sleep` 影响桌宠姿态，
  不修改任何 Routine 数据，也不影响别的 kind。
- 「夜间」的判定不再是写死的 23:30–07:30，而是主体 Routine 里的 `sleep` 规则：
  用户改了睡觉时段，开关作用的时间段随之改变；没有 `sleep` 规则时该开关自然无效果。
- 设置页文案由 `petRoutineSummary(subject.routine)` 生成：默认迁移用户看到的仍然是
  `23:30–07:30 / 07:30–07:50 / 11:30–12:00 / 12:30–14:00`，自定义作息用户看到自己的时间。

## 6. 运行中修改作息

不需要重启：`PetScheduleClock` 的缓存键包含 `updatedAt` 与规则内容；主进程在
`store.update` 之后调用 `changed()` → `companion.reset()`，下一秒的 pulse 也会重算。

## 7. 测试与验收

| 类别 | 覆盖 |
| --- | --- |
| 默认回归 | legacy 默认作息走完整适配链路后与 0.2.x 时间表**逐分钟（1440 分钟）一致** |
| 自定义 | `sleep 01:00–09:00` / `meal 13:00–13:30`：08:30 睡觉、11:45 普通、13:15 吃饭、23:45 普通 |
| 停用 | 停用 nap → 13:15 不进 nap；停用规则不产生边界；重新启用立即恢复 |
| 空作息 | `rules=[]` 与 `undefined`：无状态、无边界、不空转；业务状态照常（`busy_class`） |
| 主体 | Together 用同行者作息（改本人作息不影响桌宠）；Solo 用本人作息 |
| 优先级 | 上课 / 会议与 meal 重叠 → `busy_class` / `busy_work`，`scheduled` 照实记录 |
| 无视觉 kind | focus / commute / custom → `null`，且不产生边界 |
| 文案 | 默认 / 自定义 / 空作息三种摘要 |

命令：`npm test`、`npm run typecheck`、`npx electron runtime-audit.cjs`、
`npx electron runtime-audit-solo.cjs`、`npx electron verify-v0220.cjs`、
`npx electron verify-v030-routine-pet.cjs`（自定义作息的隔离运行时验收）。

## 8. 剩余边界

- 时区：Routine 统一按北京时间（UTC+8）判定，旧实现按机器本地时间。国内机器逐分钟一致；
  机器时区不在 UTC+8 时，时间状态的绝对时刻会随北京时间（与课程 / 提醒一致）。
- 设置页目前只**展示**作息（只读），编辑规则（增删 / 停用 / 改时间）属于 Phase 2C。
- Routine 与 Schedule 的合并、以及"共享 / 跨人"的语义统一属于 Phase 3 StateEngine。
