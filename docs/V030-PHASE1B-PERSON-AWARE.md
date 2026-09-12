# YD v0.3 Phase 1B · Person-aware Domain Consumers（2026-09-12）

Phase 1B 让核心领域链路（Course / Event / Occurrence / Live / Reminder）真正按档案工作：
Solo（1 个档案）与 Together（self + companion）都能走完整条链路，且默认双人体验逐项不变。
**本轮没有 Solo UI、没有 Onboarding / Routine / StateEngine / Avatar / OCR / Sync。**

## 1. 领域改动

| 位置 | 变化 |
| --- | --- |
| `src/types.ts` | `Event.person?: PersonId`（v3 数据必有；旧数据由 `core.eventPerson()` 回退到本人） |
| `src/core.ts` | 新增 `eventPerson(state,event)`；`occurrences()` 按会议真实归属过滤与投影；`generate()` 用身份层解析"本人"而不是写死 `'me'`；`apply()` 保存会议时默认归属本人；`validate()` 校验归属存在；`validateState()` 在 v3 起要求会议必须有归属 |
| `src/live.ts` | `snapshot()` 按 `profiles` 动态投影（1 人 1 条 / 2 人 2 条）；同行者"提前 5 分钟"气泡改为按 role 判定；`migrateLive()` 移除三段私人业务分支 |
| `src/domain.ts` | `DOMAIN_VERSION` 2 → 3 |
 | `src/migration.ts` | 新增 `person-aware` 步骤（v2 → v3）与 `LEGACY_V2_RULES`（只在版本化迁移中使用） |

`occurrences(state, from, to, personId)` 对任意存在的档案 id 都成立；`DailyException` 语义不变
（仍作为课程模板的"本次覆盖"，不是独立竞争状态）。

## 2. 提醒策略（保持旧行为）

- 只为**工作区本人**的课程与会议生成提醒：`generate()` 通过 `requireSelfProfile(state).id` 取人，
  不再出现 `person === 'me'`。
- Task 语义不变（self-owned），业务代码中不再有身份字面量。
- 同行者的课程/会议不产生本机提醒（由 `tests/person-aware.test.ts` 锁定）。

## 3. 迁移 v2 → v3（`person-aware`）

1. 旧会议（没有 `person`）归属到工作区本人 —— 通过身份层解析，不写死 `'me'`。
2. 课程 `activity` 缺省补 `teaching`；v0.2 的"同行者 + 旧教研课名"规则在此一次性生效。
3. v0.2 的一次性归一化：同行者旧称呼（`她` / `女朋友` / `伴侣`）→ `Ta`；旧暂定学期
   （`2026-09-07` / 20 周）→ `tentative = true`。
4. 写入 `settings.domainVersion = 3`。其余字段（id / 时间 / 标题 / 提醒 / 关联 / 设置）原样保留，且幂等。

这些条件现在**只存在于 `LEGACY_V2_RULES` 与版本化迁移中**；`migrateLive()` 与常规领域运行时
不再引用任何具体称呼、学期日期或课程名。

行为差异（有意）：迁移之后再导入一份**不带 activity 的旧课表文件**时，不再自动把
`高一高二语文教研` 判为教研，而是按普通课程处理——该规则只对历史数据生效一次。

## 4. 验收证据

| 检查 | 结果 |
| --- | --- |
| `npm test` | 141 / 141（Phase 1A 为 131；新增 10 条 Solo/Together/归属用例，未删除任何原用例） |
| `npm run typecheck` | 通过 |
| `npx electron runtime-audit.cjs` | 64 / 64（默认双人路径，新装不产生 before-v030） |
| `npx electron verify-v030-identity-migration.cjs` | 15 / 15：真实 Electron 启动 → `领域迁移 v1→v3 完成 · identity-roles、person-aware`，旧会议归属本人、业务数据与界面均不变 |
| Phase 0 fixture guards | 继续工作，`v020-synthetic.dayhub|.sqlite` 逐字节未变 |

## 5. 交接：Phase 1C（UI / Pet compatibility）风险清单

见本次交付说明的最后一节；要点是 `snapshot()` 现在按档案数量输出，而界面与桌宠仍假设两条状态，
`src/ui/**`、`src/companion.ts`、`src/companion-display.ts`、`src/main.ts` 的 presence 参数
都还没有按 role / 档案遍历改写。
