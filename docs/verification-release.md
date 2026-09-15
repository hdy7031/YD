# YD 发布验收门禁（跨版本）

基线：分支 `v0.3-productization`，Phase 5A + Phase 5B1（P0 桌面交互 + 可选桌宠）+
Phase 5B2（Profile 生命周期）+ Phase 5B3（Academic Decoupling），`DOMAIN_VERSION = 7`。
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
| 校历 | **没有学业配置**（Phase 5B3 起 absence 合法）：不生成学期 / 教学周 / 节次占位；`settings.setup=false` 表示首次使用未完成 |
| 第二次启动 | 复用同一个 PersonId，不重复建档案 |

由 `verify-v050-generalization.cjs` 锁定：它用全新临时 userData 启动两次（源码级两个
Electron 子进程；`--packaged` 时用 `release/win-unpacked/YD.exe` + CDP），并做私有哨兵扫描。

## 0.1 First-Run Onboarding Contract（Phase 5B1）

`settings.setup` 是"首次使用是否完成"的唯一真相，也是显示 onboarding 的唯一条件
（不用姓名 / 档案数量 / 是否有课程来猜）。流程最多四步、按条件跳过：
**关于你 → 使用方式 → 桌面陪伴 → 桌宠形象与日常节奏**。默认「只为自己」，
只有明确选择「我和另一位」才创建 companion；桌面桌宠默认「暂时不用」，
不选就不会出现任何桌面悬浮物。

| 维度 | 契约 |
| --- | --- |
| 触发 | `settings.setup === false`（fresh install 与"没做完就关掉"的下一次启动） |
| draft | 名字 / 使用方式 / 桌宠开关 / Avatar / 主体只存在于界面内存；不逐字写 Store，不落 draft 文件 |
| 提交 | 单条 `completeSetup` 命令（`src/setup.ts`）：校验通过才一次性写入，`settings.setup=true` 只在完整完成后设置 |
| self 身份 | 复用 5A 生成的同一个 PersonId；名称 trim 后 1—40 字符，Unicode / emoji 原样保留 |
| shortAlias | 不强迫填写，沿用 `people.ts` 的派生（显式值 → 去掉「小 / 老 / 阿」称呼前缀后的首字素 → 名称首字素 → 我 / TA）；改名时只清掉"系统自己填过"的代号，不改写用户存过的 Y / D |
| companion | 只有选 Together 才创建，走 `createCompanionProfile` + 现代 UUID，作息 / 课表 / 待办仍然全空 |
| 桌宠开关 | `settings.petEnabled`：选「暂时不用」时跳过形象 / 主体 / 节奏引导，`petEnabled=false`；YD Core 照常完整可用 |
| Avatar | 卡片来自 `listAvatarPacks()`；写入走 Phase 4 的 `setAvatarPack`，没动过的默认卡片保持 `source='default'`；关闭桌宠时不写入形象选择 |
| 桌宠主体 | `settings.petSubjectRole`：Solo 恒为 `self`（领域层强制，不信任 UI 隐藏字段）；Together 默认 `companion`，可改 |
| 不 seed | 不创建课表 / 待办 / 会议 / 作息示例数据；`CurrentState` 仍由状态引擎给出 idle |
| 老用户 | `settings.setup === true` 时直接进入 Home，`completeSetup` 一律拒绝，State 零改写 |
| schema | `DOMAIN_VERSION = 7`；v6 → v7 一次补齐 `petEnabled`（旧用户 = true）与 `petSubjectRole`（旧视觉行为不变） |

由 `verify-v051-onboarding.cjs` 锁定：五个全新临时 userData 目录、九个 Electron 阶段
（solo-off / solo-restart / solo-on / solo-restart / together / together-restart /
toggle / abandon / abandon-restart），全部动作走真实 DOM 点击与输入；包含
「关掉桌宠 → 立即隐藏、数据保留 → 重新打开恢复主体与形象」的运行时生命周期；
`--packaged` 时用 `release/win-unpacked/YD.exe` + CDP 跑同样路径。

## 0.2 Desktop Interaction Contract（Phase 5B1 P0）

桌面桌宠 / Dock 是"透明 + 点击穿透"窗口。实测（`test-data/hover-probe.cjs`）：
`setIgnoreMouseEvents(true,{forward:true})` 在该 Electron / Windows 组合下**不会**把真实
鼠标移动交给渲染层（点击穿透期间 0 个 mousemove / pointerenter），因此命中判定必须由主进程
按真实系统光标位置完成。

| 维度 | 契约 |
| --- | --- |
| 命中区 | 只有 `[data-hitbox]` 元素的真实渲染矩形 + 4–6px 容错接收鼠标：`sprite`（人物本体，可拖动）、`rail`（状态小框，hover/点击但不拖动）、`hover`（状态牌面，触发微展开）、`cloud`（提醒气泡） |
| 穿透 | 其余透明区域始终 `setIgnoreMouseEvents(true,{forward:true})`，点击交给桌面；穿透状态只在真正变化时写一次 |
| hover | 由主进程指针状态驱动（点击穿透时渲染层收不到 pointerleave）：进入牌面微展开，离开立即收起；hover 只改牌面布局，不改窗口 bounds |
| 拖动 | 只能从人物本体开始；拖动期间冻结穿透状态切换，结束后清理 hover / 提示 / 拖动标记 |
| 主窗口 viewport | 渲染层 CSS 视口必须等于窗口客户区；每条几何路径（resize / maximize / restore / show / 显示设置变化）核对一次，不一致才强制重排；页面缩放锁死为 1 |

由 `verify-v051-desktop-interaction.cjs` 锁定（真实光标 + 命中区矩阵 + 布局不变量矩阵 +
拖动清理），`verify-v030-dock.cjs` 继续覆盖 Dock 的 hover / 详情 / 拖动 / z-order。

## 0.3 Profile Lifecycle Contract（Phase 5B2）

使用方式是"当前怎么用 YD"，不是档案清单：**模式切换 ≠ 删除人物**。
`settings.usageMode`（`solo` / `together`）只在用户真的做过切换时才写入；缺失时由
`people.ts` 的 `usageModeOf` 按档案事实推导（有 companion → Together，只有本人 → Solo），
因此旧库、v1 备份与 fresh install 都不需要迁移（仍然是 `DOMAIN_VERSION = 7`，无新 migration）。

| 维度 | 契约 |
| --- | --- |
| Solo | 恰好 1 个 self；**允许**保留 1 个 inactive companion（档案 / PersonId / 课表 / 作息 / Avatar / 临时状态全部保留） |
| Together | 恰好 1 个 self + 恰好 1 个 companion；没有 companion 的 Together 状态非法 |
| 上限 | companion 最多 1 个（不泛化成多人群组） |
| Together → Solo | 只改 `settings.usageMode`；不删除、不改写任何 person-scoped 数据；幂等 |
| Solo → Together | 有 retained companion → 恢复**同一个** PersonId（不重建）；没有 → 走 `createCompanionProfile`（现代 UUID / 空作息 / 空课表 / 默认形象） |
| 档案身份 | 只有 `name` / `shortAlias` 可编辑（`profileIdentity` 命令，复用 5B1 的名称规则）；PersonId 与 role 不可修改；Avatar 走 `avatarSet`，作息走 Routine 设置 |
| 活跃人物 | `live.people` / 导航 / 人员选项 / Dock / 桌宠几何只投影 `activeProfiles(state)`：Solo 下被保留的 companion 不出现，也不产生幽灵状态行 |
| 桌宠偏好 | `petSubjectRole` 在 Solo 下原样保留（它是 Together 下的选择），运行时主体恒为本人；恢复 Together 后原偏好立即生效，不需要重启 |
| 桌宠开关 | `petEnabled` 与使用方式完全解耦：模式切换不打开、也不关闭桌宠 |
| 删除 | 本阶段**不做**永久删除陪伴对象（留给后续与 Backup/Restore 一起设计） |
| schema | `DOMAIN_VERSION = 7`，无新 migration，无新持久化字段（`usageMode` 只在切换时按需写入） |

由 `verify-v052-profile-lifecycle.cjs` 锁定：两个全新临时 userData 目录、八个 Electron 阶段
（together / switch-solo / solo-restart / restore-together / identity-edit / final-restart /
create-pet-off / pet-off-restart），用户动作全部走真实 DOM 点击与输入，切换前后对
`PersonId / 档案 / 课表 / 作息 / Avatar / 临时状态` 做逐字段比较；
`--packaged` 时用 `release/win-unpacked/YD.exe` + CDP 跑同样的清房生命周期。

## 1. 当前维护的 release gate（必须全绿）

## 0.4 Academic Decoupling Contract（Phase 5B3）

YD Core **不默认用户是学生**：日程的通用形态是"绝对日期 + 时间 + 标题 + 地点 + 归属人"
（Event / Task），「学期 / 教学周 / 节次」是**可选能力**，只有学生与教师需要。

| 维度 | 契约 |
| --- | --- |
| 学业配置 | Profile 上的 `startDate` / `weeks` / `periods` 是扁平**可选**字段（持久化结构未变）；三者要么都有、要么都没有 |
| 解析层 | 只有 `src/academic.ts` 的 `academicOf` / `academicPresence` / `hasAcademic` 判定"有没有学业配置"，业务代码不得各自拼 `profile.startDate && profile.weeks` |
| absence | Fresh install、新 companion 都不带学业字段；`validateState` 接受 absence，不生成任何占位学期（没有 20 周 / 中性校历 / 第 0 周） |
| presence | 一旦存在就必须满足原有内部约束（第一教学周的周一、1—60 周、1—24 节有序不重叠）；只填一部分是坏数据，明确拒绝（optional ≠ unvalidated） |
| 通用日程 | Event / Task 完全不依赖学业配置：occurrence、CurrentState（Schedule 80 层）、提醒、Dock、宠物姿态照常工作 |
| 课程 | Course 是学业语义的载体（按教学周 + 节次展开），因此要求所属人**先有**学期与节次；没有时给出明确指引，不偷偷造一个学期 |
| 状态文案 | 没有学业配置的人不会看到「尚未录入课表 / 学期尚未开始 / 本学期已结束 / 今天无课」；空闲时是「空闲 / 即将有安排」 |
| 现有学生数据 | v1—v7 的旧库、备份与 fixture 逐字段保留学业配置；课程展开、学期阶段码、CurrentState 行为不变 |
| schema | `DOMAIN_VERSION = 7`，无新 migration：字段改为可选是**放宽**校验，旧数据天然兼容 |
| preset | `STANDARD_PERIOD_PRESET` / `SUGGESTED_TERM_WEEKS` / `suggestedTermStart` 只作为用户显式打开「学期与节次」时的表单初值，永不自动落盘 |

由 `tests/academic-decoupling.test.ts`（Case A—F：fresh 无学业 / 通用 Solo / 通用 Together /
旧学生数据 / Solo↔Together 生命周期 / 无假占位）与 `verify-v050-generalization.cjs`
（fresh install 断言 absence + 课表管理页给出配置入口而不是空网格）、
`verify-v052-profile-lifecycle.cjs`（新 companion 不生成假学期）共同锁定。

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
| `node verify-v052-profile-lifecycle.cjs` | **Profile Lifecycle Contract**：Together → Solo → Together 的可逆切换（逐字段数据保留）、retained companion 的 UI / 导航 / Dock 收拢、第一次创建 companion 的通用默认、档案身份编辑、桌宠偏好与开关的解耦 |
| `npx electron verify-v051-desktop-interaction.cjs` | **Desktop Interaction Contract**：主窗口 viewport 不变量 / 命中区矩阵 / hover / 拖动清理（真实光标） |
| `node verify-v0220-packaged.cjs` | 打包版（`release/win-unpacked/YD.exe`）真实启动、Picker 热切换、冷启动持久化（数据由 `tests/fixtures/v3-together-synthetic.sqlite` 显式种下） |
| `node verify-v050-generalization.cjs --packaged` | 打包版清房验证（本轮手动跑一次即可，见 Phase 5A 报告） |
| `node verify-v051-onboarding.cjs --packaged` | 打包版清房 onboarding（Solo + Together + 重启；每轮手动跑一次即可，见 Phase 5B1 报告） |
| `node verify-v052-profile-lifecycle.cjs --packaged` | 打包版清房生命周期（首次设置 → 切 Solo → 重启 → 恢复 Together → 再重启；每轮手动跑一次即可，见 Phase 5B2 报告） |

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
