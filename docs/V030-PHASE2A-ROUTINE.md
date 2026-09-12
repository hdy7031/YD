# YD v0.3 Phase 2A · Routine Domain Foundation（2026-09-12）

Phase 2A 的第一刀只做一件事：**建立真正属于每个 Profile 的 Routine 数据模型与纯计算引擎**。
本轮完成后数据库里第一次存在 `Profile.routine.rules[]`，并且可以回答"某个时间点，这个人命中了
哪条作息规则"；但**桌宠与界面仍然走 0.2.x 的旧逻辑**，产品行为逐分钟不变。

## 1. 数据模型

```ts
interface RoutineProfile {          // 嵌在 Profile 下，因此不再存 personId
  source: 'legacy-default' | 'user';
  updatedAt: number;
  rules: RoutineRule[];
}
interface RoutineRule {
  id: string; kind: 'sleep'|'wake'|'meal'|'nap'|'commute'|'focus'|'custom';
  label: string; start: 'HH:mm'; end: 'HH:mm';
  days: number[];                   // 1—7，1 = 周一，指规则"开始"的那一天
  enabled: boolean; priority: number;
}
```

- **单一真相**：`Profile.id` 就是身份，`RoutineProfile` 不再重复存 `personId`，
  不存在 `profile.id !== profile.routine.personId` 这种双重真相。
- `Profile.routine?` 在类型上可选（v1—v3 数据没有它），但 `DOMAIN_VERSION = 4` 的 State
  必须每个档案都有合法 Routine：由 `initial()`、迁移与 `validateState` 共同保证。
- `source` 区分"0.2.x 为兼容旧桌宠自动种下的默认值（`legacy-default`，用户还没确认过）"
  与"用户自己的规则（`user`，含暂时还没有规则的空作息）"。设置页以后据此提示即可，
  不做复杂审计。

## 2. 时间语义（`src/routine.ts`）

| 约定 | 说明 |
| --- | --- |
| 区间 | 左闭右开 `[start, end)`：11:30 命中、12:00 不命中 |
| 时区 | 北京时间（UTC+8），与 `core.dateOf / epoch` 一致，无夏令时 |
| 跨午夜 | start > end 表示跨午夜，区间属于**开始的那一天**；库里始终是一条，不拆成两条 |
| 跨周 | `days=[7]` + 23:30–07:30 = 周日 23:30 → 周一 07:30，周一凌晨命中的是周日那条 |
| 非法时间 | `start === end` 不是"24 小时"：校验层拒绝，计算层直接忽略 |
| 重叠 | priority 大者胜；同级按"更晚开始 → 更小编号"，与数组顺序无关 |

派生对象 `RoutineOccurrence { ruleId, kind, label, startAt, endAt, priority }` 与 `PersonStatus`
一样：运行时实时算出，**永不落盘**。

API（纯函数，不读数据库 / 不走 IPC / 不碰 DOM 与桌宠素材）：

```ts
routineOccurrences(routine, from, to)   // 区间内的作息 occurrence（含前一天开始的跨午夜）
activeRoutine(routine, now)             // 此刻命中的规则，没有则 null
nextRoutineBoundary(routine, now)       // 下一个状态变化点，没有规则则 null
emptyRoutine(now) / legacyDefaultRoutine(now)   // 统一 factory
assertRoutineRule / assertRoutineProfile         // 校验（core.validateState 调用）
```

## 3. 迁移 v3 → v4（`routine-profile`）

`src/migration.ts` 注册了第三步、幂等的迁移：

- 只有**当前桌宠主体**（`resolvePetSubject`：有同行者 → 同行者；Solo → 本人）拿到
  `legacyDefaultRoutine(now)`（`source: 'legacy-default'`，5 条规则 = 0.2.x 写死的时间表）；
- 其他档案拿到 `emptyRoutine(now)`（`source: 'user'`，0 条规则）——不替任何人虚构作息；
- 课程 / 会议 / 待办 / 提醒 / 调课 / 通知 / 其它设置逐字段不变；
- 迁移前照旧先写 `before-v030-<stamp>.dayhub / .sqlite / .json`，失败按字节还原
  （回滚永远是"恢复迁移前的库"，不是让旧版读新库）。

`initial()` 同步改成用同一套 factory：本人空规则、默认同行者 legacy 默认作息，
因此全新安装的桌宠行为与 0.2.20 完全一致，而 magic time 只存在于 `routine.ts` 的常量里。

## 4. 本轮刻意不做

- 桌宠 / 悬浮球 / 首页**仍然调用 `getScheduledPetState()` 的旧实现**（Phase 2B 切换）；
- 没有 Routine CRUD UI（设置页规则列表、增删规则、时间选择器属于 2C）；
- 没有 StateEngine 统一、没有 Schedule 与 Routine 的优先级合并（Phase 3）；
- 文案系统（statusLabel / companionRailLabel / partnerHeadline / detail）不动。

## 5. 测试与验收

| 类别 | 覆盖 |
| --- | --- |
| 时间边界 | 11:30–12:00 的 11:29 / 11:30 / 11:59 / 12:00 |
| 跨午夜 | 23:29 / 23:30 / 23:59 / 00:00 / 07:29 / 07:30，一条规则只产出一个 occurrence |
| 跨周 | 周日 23:30 → 周一 07:30；周一开始的规则在周一凌晨不生效 |
| days / enabled | 周一至周五命中、周末不命中；停用规则不参与 |
| 重叠 | 优先级、同级"更晚开始 → 更小编号"、与数组顺序无关 |
| 空作息 | `rules: []` 与 `undefined`：null / 空集 / null 边界，不抛错 |
| 校验 | 非 HH:mm、24:00、`start === end`、空 days、越界 / 重复 days、非法 priority、重复 id、非法 kind / label / source / updatedAt |
| 不变式 | v4 每个档案必须有合法 Routine；v3 数据仍可没有（等迁移补齐） |
| 兼容 | 档案保存缺省 routine 不丢；**导入课表永不覆盖 Routine**（`SchedulePackage` 不再携带 routine） |
| 迁移 | v3 → v4 双人（只有同行者获得默认作息）与 Solo（本人获得默认作息）、ids / 业务集合 / 设置逐字段不变、备份与幂等 |
| 等价性 | legacy 默认作息与 `companion-display.companionSchedule` **逐分钟（1440 分钟）一致**——Phase 2B 切换消费方的安全绳 |

命令：`npm test`、`npm run typecheck`、`npx electron runtime-audit.cjs`、
`npx electron runtime-audit-solo.cjs`、`npx electron verify-v030-identity-migration.cjs`。

## 6. Phase 2B 的接入点

Phase 2B 只做"换消费方"：把 `companion-display` 的 `getScheduledPetState()` /
`PetScheduleClock` / `nightRestWindow` 从 `companionSchedule` 切换到
`activeRoutine(resolvePetSubject(state).routine, now)` + `nextRoutineBoundary(...)`，
并把 kind 映射到现有四种时间状态（sleep → night_sleep、wake → wake_up、
meal → eating、nap → nap）。逐分钟等价性已由本轮测试锁定，切换后删除旧常量。
