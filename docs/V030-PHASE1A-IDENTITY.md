# YD v0.3 Phase 1A · Identity Foundation（2026-09-12）

Phase 1A 把 `'me' | 'partner'` 从"固定身份模型"降级为"历史兼容 ID"：
领域层第一次能合法表达 1—2 个个人档案，同时双人产品的界面行为完全不变。
**本轮没有 Solo UI、没有 Onboarding、没有 Routine / StateEngine / Avatar 变动。**

## 1. 领域语义

| 位置 | 变化 |
| --- | --- |
| `src/types.ts` | `PersonId` 由 `'me' \| 'partner'` 放宽为 `string`；新增 `ProfileRole = 'self' \| 'companion'`；`Profile.role?: ProfileRole`；`Settings.domainVersion?: number` |
| `src/domain.ts`（新） | `DOMAIN_VERSION = 2` + `stateDomainVersion(state)`（缺失视为 1），无依赖叶子模块 |
| `src/people.ts`（新） | 唯一的身份查询层：解析顺序、按角色查询、短代号默认值 |
| 持久字段 | 仍然叫 `profiles`；**没有** `State.workspace` / `State.people`；**没有**重写任何已有 id |

### 身份解析顺序（只在 people.ts 实现）

```
1. 显式 role（v2 数据）
2. 历史 id：me → self，partner → companion（v1 数据 / 旧备份）
3. 数组位置：第 0 个 → self，第 1 个 → companion（仅迁移前的极端旧数据）
```

业务代码不得散落 `profiles[0] 就是本人` 的假设；目前除 `src/ui/app.ts` 的表单兜底
（Phase 1C 处理）之外没有其它数组位置依赖。

### 校验不变式（`validateState`）

| 情况 | 结果 |
| --- | --- |
| 1 个档案、恰好 1 个 `self` | 合法（Solo） |
| 2 个档案、1 `self` + 1 `companion` | 合法（Together） |
| 0 个档案 | 拒绝 |
| 两个 `self` / 两个 `companion` | 拒绝 |
| 3 个及以上档案 | 拒绝 |
| 重复 id | 拒绝 |
| `domainVersion >= 2` 但没有显式 role | 拒绝（必须迁移） |
| v1 旧数据（无 role，id 为 me/partner 或自定义） | 合法（按兼容顺序解析） |

课程/会议/待办仍然必须引用存在的档案 id；`importSchedule` 也只接受工作区里已有的档案 id
（不再写死 me / partner，同时避免把未知 id 写成数组越界槽位）。

## 2. 迁移 v1 → v2

`src/migration.ts` 注册第一步：`{ from: 1, to: 2, id: 'identity-roles' }`。

- 只做两件事：给每个档案补 `role`（沿用兼容解析顺序），写入 `settings.domainVersion = 2`。
- 不重写 id、不动课程 / 待办 / 会议 / 提醒 / 调课 / 通知 / 设置内容，不做 Routine / Avatar / Workspace / 课表结构升级。
- 迁移前照旧先落 `before-v030-<stamp>.dayhub` + `.sqlite` + `.json` 回执；失败按 Phase 0 的回滚模型还原字节。
- 全新安装由 `initial()` 直接产生 v2（带角色、带 domainVersion），因此**不会**在新装时触发迁移或产生 before-v030 备份。

## 3. 行为冻结

- `src/ui/**` 与 `src/companion-display.ts` 零改动。
- 运行时投影仍然返回 `['me','partner']` 两条状态；1 人工作区只是不再抛错（缺失档案返回
  `UNKNOWN`「状态暂不可用」），界面不会因为数据模型放宽而改版。
- 唯一新增的运行时防御：`personStatus()` 对不存在的档案返回不可用状态，避免主进程 live 快照崩溃。

## 4. 验收证据

| 检查 | 结果 |
| --- | --- |
| `npm test` | 131 / 131（Phase 0 为 119，新增 12 条身份/迁移用例，未删除任何原用例） |
| `npm run typecheck` | 通过 |
| `npx electron runtime-audit.cjs` | 64 / 64（新装路径，未产生 before-v030） |
| `npx electron verify-v030-identity-migration.cjs`（新） | 14 / 14：v1 数据库 → 真实 Electron 启动 → v2 + 备份 + 业务数据不变 + 双人界面不变 |

## 5. 交接：Phase 1B 的 domain consumers

以下依赖仍然存在，属于下一刀的范围（本轮刻意不动）：

1. **Event 归属**：`core.occurrences()` 把 event 的 `person` 恒定为 `'me'`；`Event` 没有 person 字段。
2. **提醒策略**：`core.generate()` 只给 `'me'` 生成课程提醒；`live.bubbleEvents()` 只给
   `o.person==='partner'` 生成"提前 5 分钟"气泡。
3. **运行时投影**：`live.snapshot()` 固定返回 `['me','partner']` 两条状态，`personStatus` 的调用方
   仍按 me/partner 取值。
4. **companion subject**：`companion-display.companionBusinessState()` 以 `'partner'` 状态优先；
   `companion.ts` 的悬停区域与 `main.ts` 的 presence 参数仍然只接受 me/partner。
5. **界面导航**：`ui/app.ts` 的「我的课表 / Ta的课表」选项、`person` 状态、`partnerRows`、
   `ui/companion.ts` 的「我的 / Ta」文案，以及 `profiles[0]` 表单兜底。
6. **历史数据兼容分支**（可随后清理）：`live.migrateLive()` 里按标题 `高一高二语文教研` 判定
   research、按 `startDate==='2026-09-07' && weeks===20` 标记 tentative、把 `她/女朋友/伴侣`
   改名成 Ta 的三个分支。
