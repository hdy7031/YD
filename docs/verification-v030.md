# YD v0.3 验收门禁

基线：分支 `v0.3-productization`，Phase 4 accepted，`DOMAIN_VERSION = 6`。

本文档只回答两个问题：**哪些验证必须全绿**、**哪些脚本只是历史考古**。
它不是 Phase 4 报告，也不替代各 Phase 的设计记录。

## 1. 当前维护的 release gate（必须全绿）

| 命令 | 覆盖 |
| --- | --- |
| `npm test` | 领域、状态引擎、迁移、持久化、Avatar 契约的单元与集成测试 |
| `npm run typecheck` | `tsc --noEmit` 全量类型检查 |
| `npm run build` | esbuild 打包 main / UI 到 `dist/`（Electron verifier 的前置步骤） |
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
| `node verify-v0220-packaged.cjs` | 打包版（`release/win-unpacked/YD.exe`）真实启动、Picker 热切换、冷启动持久化 |

`verify-v0220-packaged.cjs` 需要先 `npm run dist -- --config.electronDist=node_modules/electron/dist`
生成打包产物；产物缺失时该步骤失败，不做静默跳过。

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
scripts/ui-audit.cjs
```

These are retained for historical compatibility analysis and are not part of
the current v0.3 release gate.

它们检查的是已经退役的产品契约（Phase 4A 之前的七态桌宠素材、已删除的旧猫
fallback、视觉系统刷新前的按钮文案与窗口数量）。这些失败在不包含 Phase 4C2
改动的基线中同样可以复现，因此不代表当前产品缺陷。

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
| 响应式宽度、无横向滚动 | `scripts/visual-mist.cjs` + `runtime-audit*.cjs` |
| 同行者页当前状态卡 | `runtime-audit.cjs` |
| 空状态不居中 / 文档流布局 | `runtime-audit-solo.cjs`、`scripts/visual-mist.cjs` |

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
- 所有 verifier 把 `DAYHUB_TEST_DATA` 指向仓库内 `test-data/`，不读写正式用户数据。
- 桌宠显示/隐藏快捷键 `Ctrl+Alt+Y` 是机器级注册。运行 `verify-v0220.cjs` 前必须关闭
  其它 YD 实例（包含已安装版本；它们用各自的 userData 启动，不受单实例锁限制），
  否则该步骤会以「快捷键注册失败」失败，与代码改动无关。
- 在 Codex 桌面沙箱里运行 `npm run build` / `npm run dist` / Electron verifier 时，
  沙箱会拒绝枚举用户主目录，esbuild 的路径规范化会失败；这些步骤需要在沙箱外执行。
