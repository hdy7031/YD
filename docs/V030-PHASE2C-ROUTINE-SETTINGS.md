# YD v0.3 Phase 2C · User-editable Routine Settings（2026-09-12）

Phase 2 的最后一刀：用户第一次可以**完全不接触代码**，在设置页里编辑每个档案自己的
日常节奏（睡觉 / 起床 / 吃饭 / 午睡……），并且桌宠**不重启**就跟着新时间变化。
这正是"开发者把伴侣作息写死在代码里"的正式产品闭环。

## 1. 界面（只新增，不重做）

设置页在「桌面陪伴」里新增一个 `日常节奏` 区块（沿用既有卡片 / 字号 / 圆角 / 变量）：

```text
日常节奏
  [ 我的 ] [ Ta ]                     ← 人数 > 1 时才出现；来自 state.profiles
  这是根据旧版本桌宠时间保留的默认作息，可按你的实际情况调整。   ← 仅在 source=legacy-default

  睡觉   睡觉    23:30 → 次日 07:30   每天    [✓]   编辑  删除
  起床   起床    07:30 → 07:50        每天    [✓]   编辑  删除
  …

  [添加一条]  [使用默认作息]  [清空作息]
```

- 跨午夜规则显示为 `23:30 → 次日 07:30`，编辑框里也会提示「跨过午夜」；
- 空作息显示 Empty State：还没有设置日常节奏 / 使用默认作息 / 添加第一条；
- 新增 / 编辑用与其它编辑框同一套 modal（`.modal` + `.form-grid`），字段为
  名称、类型、开始、结束、适用星期（七个按钮）、启用；
- `commute / focus / custom` 可以选择，但编辑框会明确说明「当前没有专属桌宠动作，
  只作为日常节奏记录」——不会为它们播放别的姿态。

## 2. 写入路径

UI 只准备"下一份规则数组"，所有写入都是同一条命令链：

```text
RoutineSettings（src/ui/companion.ts）
   ↓  routineRulesWith / Without / Toggled（src/ui/routine-settings.ts）
api.change({ type:'save', entity:'profiles', value:{...profile, routine} })
   ↓
core.apply → validate('profiles') → assertRoutineProfile
   ↓
Store.update → validateState → 原子落盘 → changed()
   ↓
PetScheduleClock 缓存键变化 → 立刻重算 → 桌宠下一次播报即切换
```

React 从不直接改 State；双层校验：`routineDraftError()`（编辑框内即时提示）+
`assertRoutineProfile`（领域兜底，错误消息直接显示）。

## 3. CRUD 语义

| 操作 | 行为 |
| --- | --- |
| 启用 / 停用 | 只改 `enabled`，**规则数据保留**，之后可以恢复 |
| 编辑 | 名称 / 类型 / 起止 / 星期；同 id 原位替换，不改变列表顺序 |
| 添加 | 追加一条；默认 `meal 12:00–12:30`（可改成早饭 / 晚饭，label 区分） |
| 删除 | 真正移除（先确认，与停用区分） |
| 使用默认作息 | 调用统一的 `createDefaultRoutine()`（与迁移同源的默认值），覆盖前确认 |
| 清空作息 | 规则置空（覆盖前确认），桌宠不再有时间状态 |

用户任何一次修改都会把 `source` 置为 `user` 并刷新 `updatedAt`：
legacy 提示随即消失，桌宠缓存失效。

## 4. 每个 Profile 独立

人物选择来自 `state.profiles`（`routinePersonOptions`：本人优先，同行者其次）：

- Solo：只有本人一条，桌宠主体=本人；
- Together：可以分别编辑本人与同行者，互不串数据（单测断言双方 `routine` 逐字段隔离）。

## 5. 测试与验收

| 类别 | 覆盖 |
| --- | --- |
| 单测 | `tests/routine-settings.test.ts`：CRUD、双层校验、Together/Solo 隔离、跨午夜不拆分、备份往返、默认模板与空作息、legacy 提示生命周期 |
| 运行时 | `verify-v030-routine-settings.cjs`（36 项）：真实 Electron 里停用 / 修改 / 新增 / 非法输入被拦 / 删除 / 模板 / 清空 / 切换编辑对象，以及每一步之后桌宠的即时反应 |
| 回归 | `verify-v0220.cjs` 63、`runtime-audit.cjs` 64、`runtime-audit-solo.cjs` 33、`verify-v030-routine-pet.cjs` 17、`verify-v0220-packaged.cjs` 27（重新打包后） |

## 6. 边界

- Routine 只影响桌宠（Phase 3 才进入 CurrentState / 悬浮球 / 首页）；
- 优先级编辑（priority）不暴露给用户：由 kind 的稳定默认值决定，重叠时结果确定；
- 节假日、调休、单次例外、跨设备同步不在本轮。
