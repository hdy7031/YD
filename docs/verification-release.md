# YD 发布验收门禁（跨版本）

基线：分支 `v0.3-productization`，Phase 5A + Phase 5B1，`DOMAIN_VERSION = 6`。
（本文档原为 `docs/verification-v030.md`，从 Phase 5 起升级为跨版本的发布验收文档。）

本文档只回答两个问题：**哪些验证必须全绿**、**哪些脚本只是历史考古**。
它不是阶段报告，也不替代各 Phase 的设计记录。

## 0. Fresh Install Contract（Phase 5A）

一台从来没有 YD 数据的电脑，第一次启动必须得到：

| 维度 | 契约 |
| --- | --- |
| Mode | Solo（绝不默认 Together） |
| Profiles | 恰好 1 个 `role = self`；没有 companion |
| PersonId | 正式生成器（UUID），不是 legacy `me` / `partner` |
| 身份 | 中性临时名「我」，不写死任何私人姓名或 Y / D |
| Schedule / DailyException | 空 |
| Todo / Event / Notice / Reminder | 空 |
| ManualOverride | 空 → `CurrentState = idle` |
| Routine | 空规则（`{source:'user',rules:[]}`）；「使用默认作息」是用户主动选择的 preset |
| Avatar | 官方默认 Pack（`yd-default` / `default`） |
| 校历 | 中性占位（本周周一 + 20 周 + 八节等长节次）+ `settings.setup=false`；真实校历留给 Phase 5B3 的 Academic 领域表达 |
| 第二次启动 | 复用同一个 PersonId，不重复建档案 |

由 `verify-v050-generalization.cjs` 锁定：它用全新临时 userData 启动两次（源码级两个
Electron 子进程；`--packaged` 时用 `release/win-unpacked/YD.exe` + CDP），并做私有哨兵扫描。

## 0.1 First-Run Onboarding Contract（Phase 5B1）

`settings.setup` 是"首次使用是否完成"的唯一真相，也是显示 onboarding 的唯一条件
（不用姓名 / 档案数量 / 是否有课程来猜）。流程最多三步：**关于你 → 使用方式 → 桌宠形象**，
默认「只为自己」，只有明确选择「我和另一位」才创建 companion。

| 维度 | 契约 |
| --- | --- |
| 触发 | `settings.setup === false`（fresh install 与"没做完就关掉"的下一次启动） |
| draft | 名字 / 使用方式 / Avatar 只存在于界面内存；不逐字写 Store，不落 draft 文件 |
| 提交 | 单条 `completeSetup` 命令（`src/setup.ts`）：校验通过才一次性写入，`settings.setup=true` 只在完整完成后设置 |
| self 身份 | 复用 5A 生成的同一个 PersonId；名称 trim 后 1—40 字符，Unicode / emoji 原样保留 |
| shortAlias | 不强迫填写，沿用 `people.ts` 的派生；改名时只清掉"系统自己填过"的代号 |
| companion | 只有选 Together 才创建，走 `createCompanionProfile` + 现代 UUID，作息 / 课表 / 待办仍然全空 |
| Avatar | 卡片来自 `listAvatarPacks()`；写入走 Phase 4 的 `setAvatarPack`，没动过的默认卡片保持 `source='default'` |
| 不 seed | 不创建课表 / 待办 / 会议 / 作息示例数据；`CurrentState` 仍由状态引擎给出 idle |
| 老用户 | `settings.setup === true` 时直接进入 Home，`completeSetup` 一律拒绝，State 零改写 |
| schema | `DOMAIN_VERSION` 仍为 6，本阶段不新增 migration |

由 `verify-v051-onboarding.cjs` 锁定：三个全新临时 userData 目录、六个 Electron 阶段
（solo / solo-restart / together / together-restart / abandon / abandon-restart），
全部动作走真实 DOM 点击与输入；`--packaged` 时用 `release/win-unpacked/YD.exe` + CDP 跑同样路径。

## 1. 当前维护的 release gate（必须全绿）

| 命令 | 覆盖 |
| --- | --- |
| `npm test` | 领域、状态引擎、迁移、持久化、Avatar 契约的单元与集成测试 |
| `npm run typecheck` | `tsc --noEmit` 全量类型检查 |
| `npm run build` | esbuild 打包 main / UI 到 `dist/`（Electron verifier 的前置步骤） |
| `npm run verify:vs2` | **VS2 视觉 / 运行时门禁统一入口**：依次运行 `scripts/visual-vs2.cjs` → `runtime-audit.cjs` → `runtime-audit-solo.cjs` → `verify-v030-dock.cjs` |
| `npx electron scripts/visual-vs2.cjs` | 三档宽度（780×600 / 1050×780 / 1600×960）× 六个页面；课表周次与八节时间、设置六分区与共享 setting-row、Duo Dock 两区同高同基线且牌面按实测内容定宽、点 Dock 在同一个窗口里打开详情（Mini 窗口保持隐藏）、Solo Dock 单行无分隔与单张全宽卡；报告含 `screen.getAllDisplays()` 缩放率与本次临时 userData 路径 |
| `npx electron runtime-audit.cjs` | Together 工作区端到端运行时审计 |
| `npx electron runtime-audit-solo.cjs` | Solo 工作区端到端运行时审计 |
| `npx electron verify-v0220.cjs` | 桌宠十态契约、作息时间边界、提醒优先级、拖动稳定性 |
| `npx electron verify-v030-identity-migration.cjs` | 身份迁移与备份/回滚安全 |
| `npx electron verify-v030-routine-pet.cjs` | 作息规则驱动桌宠状态 |
| `npx electron verify-v030-routine-settings.cjs` | 作息设置读写与恢复默认 |
| `npx electron verify-v030-current-state.cjs` | CurrentState 单一真相与消费方一致性 |
| `npx electron verify-v030-manual-status.cjs` | 临时手动状态（仅本人、到期回收） |
| `npx electron verify-v030-avatar-pack.cjs` | Avatar Pack 注册表 / manifest / 缺帧说明 |
| `npx electron verify-v030-avatar-person.cjs` | Person ↔ AvatarSelection ↔ PetInstance |
| `npx electron verify-v030-avatar-runtime.cjs` | 热切换、版本化缓存、竞态、last-known-good |
| `npx electron verify-v030-avatar-picker.cjs` | Picker / Preview / avatarSet / avatarReset / 重启持久化 |
| `npx electron verify-v030-dock.cjs` | Dual Status Dock：结构 / label / hover / click / drag / 快速拖动 / 位置落盘与重启恢复（Solo 见 `runtime-audit-solo.cjs`） |
| `node verify-v050-generalization.cjs` | **Fresh Install Contract**：空 userData → 第一次启动（Solo / 单 self / 全空 / idle / UI 无 undefined）/ 第二次启动同一 PersonId；含私人哨兵扫描 |
| `node verify-v051-onboarding.cjs` | **First-Run Onboarding Contract**：空 userData → 真实点击完成 Solo / Together（含未完成关闭与两次重启）；不 seed 业务数据、不改 PersonId、无 ghost companion |
| `node verify-v0220-packaged.cjs` | 打包版（`release/win-unpacked/YD.exe`）真实启动、Picker 热切换、冷启动持久化（数据由 `tests/fixtures/v3-together-synthetic.sqlite` 显式种下） |
| `node verify-v050-generalization.cjs --packaged` | 打包版清房验证（本轮手动跑一次即可，见 Phase 5A 报告） |
| `node verify-v051-onboarding.cjs --packaged` | 打包版清房 onboarding（Solo + Together + 重启；每轮手动跑一次即可，见 Phase 5B1 报告） |

两个 node 步骤都需要先 `npm run dist -- --config.electronDist=node_modules/electron/dist`
生成打包产物；产物缺失时打包步骤失败，不做静默跳过。

**数据种子的边界（Phase 5A）**：生产 fresh install 只有一个人，因此需要 Together 的门禁
（runtime-audit、verify-v0220、verify-v030-*、Dock、VS2 Together、packaged 等）都在启动前
把 `tests/fixtures/v3-together-synthetic.sqlite` 复制进各自的隔离 userData；
Solo 门禁用 `v3-solo-synthetic.sqlite`。生产代码永远不会读取这些 fixture。

## 2. 辅助维护验证

改到对应区域时运行；它们仍反映当前产品契约，但不是每次发布的硬门禁。

| 命令 | 覆盖 |
| --- | --- |
| `npx electron verify-v0214.cjs` | 主窗口窗口系统与响应式回归 |
| `npx electron verify-v0214-reminder.cjs` | 提醒送达链路 |
| `npx electron verify-epipe-stdio.cjs` | 子进程 stdout/stderr 断管后仍可工作 |
| `npx electron scripts/visual-mist.cjs` | 主窗口视觉系统回归（截图对比） |

`verify-v030-dock.cjs` 无参数时会依次 spawn `together` → `restart` 两个 Electron 实例
（应用自身是单实例，无法在同一进程里重启）。Solo 工作区的 Dock 单行退化由
`runtime-audit-solo.cjs` 的「状态浮标单人模式只有一行 / 没有第二个（幽灵）同行者行」覆盖。

本仓库没有 lint script（`package.json` 未定义），不要假装运行它。

## 3. 历史 / deprecated verifier（不是 release gate）

```text
verify-v0213.cjs
verify-v0215.cjs
verify-v0215-fallback.cjs
verify-v0216.cjs
```

These are retained for historical compatibility analysis and are not part of
the current v0.3 release gate.

它们检查的是已经退役的产品契约（Phase 4A 之前的七态桌宠素材、已删除的旧猫
fallback、视觉系统刷新前的按钮文案与窗口数量）。这些失败在不包含 Phase 4C2
改动的基线中同样可以复现，因此不代表当前产品缺陷。

### 已删除的可执行 verifier

```text
scripts/visual-v022.cjs   旧悬浮球（.presence-orb / .identity-mark）视觉审计
scripts/ui-audit.cjs      视觉系统刷新前的按钮文案走查（加载 dist/index.html）
```

两者对应的 DOM 契约已经在 VS2 中彻底消失（旧 Orb 结构被 Dual Status Dock 取代、
导航文案与页面结构重排），保留文件只会误导维护者，因此删除。覆盖已并入
`npm run verify:vs2`：响应式宽度、无横向滚动、空状态与 Dock 结构分别由
`scripts/visual-vs2.cjs`、`runtime-audit*.cjs`、`verify-v030-dock.cjs` 承担。
历史 Phase 文档中"当时存在这两个脚本"的陈述仍然成立，不追溯修改。

不要为了让这些脚本变绿而恢复旧素材、旧 UI 或旧契约；每个脚本顶部都有
`@deprecated` 说明与它被谁取代。

### 3.1 旧 audit-preload 外壳 harness（环境受阻，非 Phase 1 回归）

```text
scripts/verify-v0210-ui.cjs
scripts/verify-v0211-ui.cjs
scripts/verify-v0212-ui.cjs
```

这三个脚本用 `scripts/audit-preload.cjs` 直接加载 `dist/index.html`。该 mock 的
`dayhub.live()` 仍返回 Phase 3A 之前的形状（没有 `display` / `petInstance`），
当前 UI bundle 在挂载主界面之前就会抛错，因此脚本在第一次 `executeJavaScript`
就失败（`#root` 子节点为 0、`.nav-item` 不存在），根本走不到任何断言。

**这在 Phase 1 之前的基线 `9a9dbc9` 上同样可复现**，与 Self / Companion
Daily Summary 的改动无关。它们的覆盖已被当前门禁取代：

| 旧脚本覆盖 | 当前替代 |
| --- | --- |
| 响应式宽度、无横向滚动 | `scripts/visual-vs2.cjs`（三档宽度 × 六页）+ `runtime-audit*.cjs` |
| 同行者页当前状态卡 | `runtime-audit.cjs` |
| 空状态不居中 / 文档流布局 | `runtime-audit-solo.cjs`、`scripts/visual-vs2.cjs` |

不要为了修这三个脚本去复活旧 mock 契约；若要恢复，应先让 `audit-preload.cjs`
对齐 `LiveSnapshot` 现形（单独任务，不属于 Phase 1）。

## 4. 统一入口

```bash
node scripts/verify-current-release.cjs                  # 第 1 节全部门禁
node scripts/verify-current-release.cjs --with-aux       # 追加第 2 节辅助验证
node scripts/verify-current-release.cjs --skip-packaged  # 只做源码级检查
```

该脚本按顺序调用上面的 verifier，不重新实现任何检查逻辑，也不改写退出码：
任一步骤 `exit != 0`，整个运行就失败。

## 5. 运行环境

- Electron verifier 需要真实 GUI 会话；无桌面环境时会失败，这是环境问题而非产品问题。
- 所有 Electron verifier 都通过 `scripts/electron-test-profile.cjs` 把 userData 指向
  `os.tmpdir()` 下的唯一临时目录（`app.setPath('userData'|'sessionData')` 同时设置），
  并把 `DAYHUB_TEST_DATA` 指向同一目录；截图 / 报告仍写到仓库内 `test-data/`。
  任何 verifier 都不会读取、迁移、恢复、删除或修改 `%APPDATA%\事务助手`。
- 程序图标与字标是两条独立链路：程序图标 = `python scripts/prepare-app-icon.py`
  （源：`brand/source/app-icon-master-v2.png`），字标 / 托盘 =
  `npx electron scripts/brand-render.cjs`。判定 Windows 图标白边时以"四角 alpha 与
  边缘亮像素"为准，可运行打包后的 `release/win-unpacked/YD.exe` 复查嵌入帧。
- 桌宠显示/隐藏快捷键 `Ctrl+Alt+Y` 是机器级注册。运行 `verify-v0220.cjs` 前必须关闭
  其它 YD 实例（包含已安装版本；它们用各自的 userData 启动，不受单实例锁限制），
  否则该步骤会以「快捷键注册失败」失败，与代码改动无关。
- 在 Codex 桌面沙箱里运行 `npm run build` / `npm run dist` / Electron verifier 时，
  沙箱会拒绝枚举用户主目录，esbuild 的路径规范化会失败；这些步骤需要在沙箱外执行。
