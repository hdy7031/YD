# YD v0.3 Phase 0 · Safety Baseline（2026-09-12）

Phase 0 的目标只有一个：**在修改身份模型之前，把工程基线变成可恢复、无私人数据依赖的状态。**
本轮不实现 Person / Workspace / Routine / StateEngine / Onboarding / Avatar 中的任何一项。

## 1. Git 基线

`DayHub-v0.1` 此前不是 Git 仓库（`git rev-parse` 失败、无 `.git`），因此没有"未提交修改"可保留，
也没有历史可保护。本轮建立了最小可用的版本基线：

| 项目 | 值 |
| --- | --- |
| 初始提交 | `chore(baseline): YD v0.2.20 demo-stable snapshot` |
| 稳定 tag | `v0.2.20-demo-stable`（指向初始提交） |
| 分支 | `main`（基线）/ `v0.3-productization`（本轮及后续工作） |
| 提交范围 | `src/`、`tests/`、`scripts/`、`docs/`、`brand/`、`artwork/`、`native/`、根目录 `.cjs` 验收脚本与 `.md` 文档、`package.json` / `package-lock.json`、`tsconfig.json` |

被排除在版本库之外（仍完整保留在本机磁盘）：

```
node_modules/  dist/  release/  test-data/  .build-cache/  *.log  __pycache__/  *.pyc
ingest/                 # 私人课表、真实数据库与其备份
deliverables/           # 生成的评估/截图产物（281 MB）
scripts/build-2026-autumn-schedule.mjs
scripts/verify-2026-autumn-schedule.mjs
scripts/seed-v028-smoke.mjs
scripts/verify-v028-smoke.mjs
```

最后四个脚本内嵌/断言开发者本人的真实课表，因此与 `ingest/` 一起被排除；它们仍在磁盘上，
不影响任何产品代码。**未做任何 Git 历史改写**（本仓库本来没有历史）。

## 2. 备份与回滚模型（Phase 1 起必须遵守）

`src/migration.ts` 是 v0.3 领域迁移的唯一入口，规则：

1. 迁移前必须写两份备份到 `<userData>/backups/`：
   - `before-v030-<stamp>.dayhub`（与产品「导出完整备份」同格式，可由界面恢复）；
   - `before-v030-<stamp>.sqlite`（迁移前数据库的原始字节，回滚用）；
   - 外加 `before-v030-<stamp>.json` 回执（版本 + 各集合计数 + sha256）。
2. 迁移在单个 `Store.update` 内完成：磁盘上只存在迁移前或迁移后的状态，没有中间版本。
3. 失败（步骤抛错、校验失败、落盘失败）→ 还原迁移前的数据库字节，备份**永不删除**，
   失败的迁移产物另存为 `.failed.sqlite` 供诊断。不 drop、不清空、不修改用户数据内容。
4. **回滚 = 恢复迁移前的数据库字节**，不是"让旧版本直接读新数据库"。
   旧版 `validateState` 强制 `profiles.length===2`，而 v0.3 允许 1 个 Person；
   "旧版忽略未知字段"只说明不会立刻报错，不代表语义正确。该约束由
   `tests/migration.test.ts` 的 `回滚不依赖旧版读取新数据` 用例锁定。

Phase 0 没有注册任何迁移步骤（`migrationSteps = []`，`DOMAIN_VERSION = 1`），
闸门挂在 `src/main.ts` 启动流程中但完全惰性：运行期日志里不会出现"领域迁移"，
也不会产生 `before-v030-*` 文件（已由 runtime audit 现场确认）。

## 3. 测试数据策略

| 文件 | 用途 |
| --- | --- |
| `tests/fixtures/synthetic-schedule.json` | 合成课表：Alex（`me`，16 周）/ Sam（`partner`，20 周暂定），15 门虚构课程（14 个不同名称）、Building A/B/C、Lab 204 |
| `tests/fixtures/synthetic.ts` | 合成课的加载器与状态构造器（走真实的 `importSchedule` + `migrateLive` 路径） |
| `tests/fixtures/v020-synthetic.ts` | v0.2.20 形态的迁移 fixture 构造器（含 event / task / notice / exception / 三种提醒状态 / pet / setup） |
| `tests/fixtures/v020-synthetic.dayhub` | 上述状态的备份格式（提交到仓库，供迁移测试使用） |
| `tests/fixtures/v020-synthetic.sqlite` | 上述状态的 SQLite 存储格式（提交到仓库） |
| `npm run fixtures:build` | 从构造器重新生成上面两个文件 |

解绑私人数据的范围：`tests/live.test.ts`、`tests/companion.test.ts`、`tests/consistency.test.ts`、
`tests/inbox.test.ts`、`tests/layout.test.ts`、`runtime-audit.cjs`、`ui-shots.cjs`、`ui-catalog.cjs`、
`verify-v0216.cjs`、`scripts/visual-v021.cjs`、`scripts/visual-v0217.cjs`、`scripts/visual-v022.cjs`。
`tests/fixture-baseline.test.ts` 会持续断言：正式测试与上述公共脚本都不得再出现 `ingest/`。

受影响的断言按新 fixture 重新表达（课程 15 条 / research 2 条 / 8 节次 / 学期日期整体平移到
2027-02-22 与 2027-03-01），行为类别不变。

## 4. 基线结果

| 检查 | Phase 0 之前 | Phase 0 之后 |
| --- | --- | --- |
| `npm test` | 109 / 109 通过 | **119 / 119 通过**（+7 迁移、+3 fixture 守卫） |
| `npm run typecheck` | 通过 | 通过 |
| `npx electron runtime-audit.cjs`（五窗口，隔离数据目录） | 64 项通过 | **64 项通过** |
| `node verify-v0220-packaged.cjs`（release 中的 0.2.20 打包产物） | 27 项通过 | 未重跑（打包产物未变） |
| `npx electron verify-v0220.cjs` | 环境受阻 | 环境受阻（见下） |
| `npx electron scripts/ui-audit.cjs` | 既有失败 | 既有失败（未修改） |

已知问题（均为既有、非本轮引入）：

- `verify-v0220.cjs` 第 142 行断言 `Ctrl+Alt+Y` 已注册；开发者的安装版 YD 正在运行并占用该全局快捷键，
  因此这项检查在并行运行安装版时必然失败。**跑该脚本前需要先退出已安装的 YD。**
- `scripts/ui-audit.cjs` 的假 preload 数据停留在旧版 UI（找不到「未处理提醒 · 1」），基线即失败。
- `verify-v0216.cjs` 是 0.2.16 的历史验收入口，其设置页文案断言早于 0.2.20 的「作息状态」改版；
  本轮只解除它的私人数据依赖，不修复其历史断言。
- 打包版验收（`verify-v0220-packaged.cjs`）依赖 `release/win-unpacked`；Phase 1 合入后需要重新
  `npm run dist` 才能复验打包产物。

## 5. Phase 1 决策备忘（本轮只记录，不实现）

1. **`Profile` 不直接改名 `Person`。** 第一轮保持持久字段名 `profiles`，只放开语义：
   `id` 从 `'me'|'partner'` 放宽为字符串，新增 `role` / `avatarId`（可选），
   `profiles.length` 允许 1–2。改名留到 v0.3.2，用读取别名（`people ?? profiles`）过渡。
   理由：`profiles` 被 `core.ts` / `live.ts` / `ui/app.ts` / 备份 / 测试共同消费，
   物理改名会同时制造数据 diff 与全链路改动，收益却为零。
2. **`Workspace` 第一轮不持久化。** 单工作区是隐含事实，先由 `people.length` 推导；
   等确实需要多工作区时再引入持久对象。
3. **`PersonId='me'|'partner'` 渐进解除的路径**：类型放宽为 `string` 但保留旧字面量常量 →
   所有 `=== 'me'` / `=== 'partner'` 判断改为"角色/顺序"查询（`people[0]`、`role==='self'`）→
   最后才允许自定义 id。旧数据不做 id 重写。
4. **1 人首次成为合法状态的顺序**：先改 `validateState`（`1 <= profiles.length <= 2`）与
   `Event.person`（事件也要归属到人）→ 再改 `snapshot()` / `personStatus()` 遍历 people →
   最后才让 UI 隐藏第二位同行者的入口。三者必须在同一个 Phase 1 切片内完成，
   否则会出现"数据合法但界面仍假设两人"的中间态。
5. **第一刀必须改**：`src/types.ts`、`src/core.ts`（initial / validateState / occurrences / delete 规则）、
   `src/live.ts`（snapshot / personStatus 遍历）、`src/ui/app.ts`（导航与表单由 people 派生）。
   **可以靠兼容层继续用旧接口**：`src/companion-display.ts`（继续接收 `PersonStatus[]`）、
   `src/selectors.ts`、`src/inbox.ts`（继续只处理 `'me'` 的课表变更）、所有 `scripts/`、所有验收脚本。

## 6. 本轮明确不做

Solo / Together UI、Routine、StateEngine、Avatar 切换、Onboarding、OCR、AI、同步、云、账户，
以及任何数据库结构变更（Phase 0 只新增文件与惰性闸门，不改写任何持久字段）。
