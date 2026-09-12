# YD v0.3 Phase 3C · Temporary Manual Status（2026-09-12）

Phase 3 的最后一刀：用户可以**临时告诉 YD "我现在实际上是什么状态"**，
在一段时间内压过 Schedule / Routine，到期自动恢复推导状态。
这是 YD 从"根据课表猜状态"走向"用户可纠正现实状态"的关键一步。

## 1. 优先级（正式完成）

```text
Manual Override   100   ← 本人确认的现实（Phase 3C）
Schedule           80   ← 课程 / 会议（DailyException 只是它的修饰层，不参与排序）
Routine            40   ← 日常规律
Idle               10
```

Reminder / Interaction 仍然不是 Person State：它们只叠加在 Companion Display 上。

## 2. 数据模型

```ts
interface ManualOverride {
  id: string;
  personId: PersonId;      // 第一版只会是本人
  kind: 'idle'|'busy'|'rest'|'focus'|'commute'|'meal'|'custom';   // 复用领域 kind，无 manual_*
  label: string;           // 用户看到的名字（自定义时由用户填写）
  startAt: number;
  endAt: number | null;    // null = 直到用户取消
  createdAt: number;
}

State.manualOverrides: ManualOverride[]   // 每个人最多一条
```

- 不塞进 Routine：Manual 是"临时现实状态"，Routine 是"日常规律"；
- 不新增 `manual_*` 重复 kind：来源由 `CurrentState.source = 'manual'` 表达；
- `endAt === null` 的"直到取消"持久化保存，重启后仍在，也可以随时取消。

## 3. 迁移

```text
DOMAIN_VERSION 4 → 5
步骤：manual-status —— 只补 `manualOverrides = []`
```

其它集合、档案、作息、设置逐字段不变；仍然走 Phase 0 的备份闸门
（`before-v030-*.dayhub/.sqlite/.json`，失败逐字节还原）。

## 4. 用户能做什么

- 从**首页状态行**的「设置当前状态」或**桌宠右键菜单**的「设置当前状态」打开对话框；
- 选择 空闲 / 忙碌 / 休息 / 专注 / 通勤 / 吃饭 / 自定义；
- 选择 30 分钟 / 1 小时 / 2 小时 / 自定义结束时间 / **直到我取消**；
- 随时「取消当前状态」，立即回到课表 / 作息推导；
- 到期不需要任何操作：`endAt` 一到就自然回落，过期记录在**下一次保存**时清理
  （不在每秒 tick 里写盘）。

## 5. 边界

- **只有本人能设置**：状态由状态主体本人确认，本机用户不能替同行者声明
  "你现在在做什么"（Together 下同行者仍按自己的课表推导）。
- **"今天不午睡"不做成 Manual**：那本质上是 Routine 的单日例外，属于后续阶段，
  本轮不混合两个概念。
- 手动"专注 / 休息 / 通勤 / 自定义"没有专属桌宠素材：文案照常显示，
  姿态交给显示层（不伪造动作）。

## 6. 信任信号

状态来源第一次在界面上可区分（`stateSourceLabel`）：

```text
正在专注   本人设置 · 16:30 结束
正在上课   按课表推测 · 15:40 结束
午饭       按作息推测 · 13:00 结束
```

`CurrentState.confidence = 1` 只出现在 Manual（本人确认不是概率）；
Schedule / Routine 不虚构 0.6 / 0.8 这类数字。

## 7. 验收

```text
npm test                                              211/211（+11 条手动状态用例）
npm run typecheck                                     PASS
npx electron runtime-audit.cjs                        64/64
npx electron runtime-audit-solo.cjs                   33/33
npx electron verify-v0220.cjs                         63/63（菜单新增一行后仍逐分钟一致）
npx electron verify-v030-identity-migration.cjs       18/18（v1 → v5）
npx electron verify-v030-routine-pet.cjs              17/17
npx electron verify-v030-routine-settings.cjs         36/36
npx electron verify-v030-current-state.cjs            44/44
npx electron verify-v030-manual-status.cjs            36/36（新增）
node verify-v0220-packaged.cjs                        27/27（重新打包）
```

`verify-v030-manual-status.cjs` 用真实 Electron + 受控时钟验证：

```text
11:20 上课（按课表推测）→ 对话框设置「专注，到 11:30」→ 专注中（本人设置）
Home / Mini / Tip / Tray / 状态条同源；桌宠不被伪造姿态
11:31 到期 → 自动回到「上课中」→ 「忙碌」→ 取消 → 立即回到「上课中」
菜单入口同样能打开对话框；自定义状态空名称会被拒绝且不写入
```

## 8. 结论

> 现在是否还存在多个模块分别判断"这个人现在在做什么"？ **0。**
> Reminder / interaction 是否错误进入 Person CurrentState？ **否。**

Phase 3 的三个阶段至此闭环：**统一状态引擎 → 单一真相消费 → 用户可纠正现实状态。**
