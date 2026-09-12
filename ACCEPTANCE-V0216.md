# 0.2.16 Interaction Polish & Companion Reliability 验收

验证日期：2026-09-10。所有自动测试与 Electron 运行审计都使用项目内隔离数据目录（`DAYHUB_TEST_DATA`），不读写 `%APPDATA%\事务助手\dayhub.sqlite`。

## 本次范围

只做交互收敛、桌宠稳定性、Inbox 录入重构、页面信息架构、工程化文案清理与最终视觉收口；没有新增业务能力，没有改动状态引擎、Reminder 生命周期、Inbox → Draft → Human Review → Entity 主链路、课表 / 事项 / 备份模型，也没有接入 QQ、微信、在线模型、云同步或移动端。

## 测试环境

- Windows 11（10.0.22631），Electron 44.2.0，Node 24/25，项目内 `sql.js` WASM。
- 主显示器缩放 150%（`devicePixelRatio = 1.5`），工作区 1920×1040 DIP。
- 桌宠 / 气泡 / 迷你面板 / 提示条都是独立透明无边框窗口，主窗口为 1050×780 起、最小 750×550。
- 打包验证使用 `release/win-unpacked/事务助手.exe`（0.2.16，`packaged=true`），安装包为 `release/DayHub-Setup-0.2.16.exe`。
- 项目没有 lint 脚本，本次同样没有运行 lint；静态验证以 `tsc --noEmit` 与单元测试为准。

## 测试数据

- 运行审计先在空库上验证首次进入、空状态与录入链路，再导入 `ingest/2026秋季双方课表.dayhub-schedule.json`（双方课程、作息与教学周）验证课表、状态与配色。
- 通知数据包含：文字粘贴通知、Ctrl+V 图片通知、拖放图片通知、整理失败通知、已确认通知、已忽略通知，以及两个与已有会议同名同时间的通知（用于重复与更正分支）。
- 提醒使用真实时钟：把待办截止时间设到下一个分钟边界，等待真实触发，验证 reminder 姿态、气泡、计数与「确认提醒不完成待办」。
- 打包验证使用全新的隔离目录 `test-data/v0216-packaged-<timestamp>`，只写入该目录内的 `dayhub.sqlite`、`attachments` 与 `dayhub.log`。

## 核心变更

1. **桌宠固定画布**：新增 `src/companion-layout.ts`，三种显示模式 × 三种尺寸的窗口尺寸只由常量决定；渲染结构改为 `pet-dock > pet-handle > sprite-stage > sprite-inner` 与独立 `status-rail` 两层，状态栏固定贴底，角色动画无法推动或裁掉它。
2. **拖动只有一个真相**：`pointerdown` 立即进入 `is-dragging`，拖动期间关闭呼吸、hover 抬升、scale、transition、滤镜与状态切换动画；窗口位移只来自主进程，尺寸未变化时只调用 `setPosition`。
3. **拖动锚点双保险**：同时记录窗口原点、渲染层指针与系统光标；当渲染层指针增量与系统光标增量不一致（多显示器或 125%/150% 缩放）时改用系统光标并按当前位置重新对齐，避免越拖越偏。
4. **透明窗口合成收敛**：状态栏去掉 `backdrop-filter`，hover 不再使用 `drop-shadow` 滤镜，改为静态投影层；角色窗口尺寸不变时不再重复 `setBounds`，减少透明合成与 1px 抖动。
5. **统一 Capture Composer**：收件箱只有一个录入入口，`Ctrl+V` 文字进输入区待编辑、`Ctrl+V` 图片直接建图片通知、拖入图片（PNG/JPG/JPEG/WEBP）直接导入，`Ctrl+Enter` 或「整理通知」提交；原文先入库，OCR 在后台进行。
6. **收件箱信息架构**：宽窗真正 Master–Detail（无页面级返回、无面包屑），窄窗才用 `← 返回通知收件箱` 并恢复筛选与滚动；详情用标题与分隔线分节，只有警告类内容套容器；底部固定操作条，主操作按事务类型命名。
7. **事项与会议筛选 IA**：一级「全部 / 待办 / 会议」，待办内再选状态与时间，会议内选时间；管理页新增 `+ 新建`。
8. **课表与 Ta 的日程**：课程颜色改为按课程 id 稳定 hash；课表工具栏分层，「学校作息」降级为文字入口、「载入整理后的课表」改名为「导入课表」；Ta 的日程改为紧凑时间轴，低频操作收进 `⋯`。
9. **文案与视觉收口**：设置页桌面陪伴重组为外观 / 动态效果 / 气泡提醒 / 窗口行为，动态效果合并为「标准 / 减少」，删除“第一版范围”等开发说明；托盘与桌宠右键菜单术语统一；侧栏选中态改为浅背景 + 左侧 Accent；信息密度提高约 10%，正文与辅助文字对比度提高。
10. **稳定性小修**：保存数据库时的偶发 `EPERM/EBUSY` rename 自动重试；浮动球圆形按短边计算，避免 150% 下客户端取整造成椭圆。

## 自动测试结果

| 项目 | 命令 / 脚本 | 结果 |
| --- | --- | --- |
| 单元测试 | `npm test` | 100 / 100 通过（新增 `tests/layout.test.ts` 4 项） |
| 类型检查 | `npm run typecheck` | 通过（无输出即无错误） |
| 构建 | `npm run build` | 通过（`dist/main.cjs`、`dist/ui.js`、样式与素材） |
| 0.2.16 运行审计 | `npx electron verify-v0216.cjs` | 100 / 100 通过，无未通过备注 |
| 0.2.16 打包版审计 | `node verify-v0216-packaged.cjs` | 28 / 28 通过 |
| 基础运行回归 | `npx electron runtime-audit.cjs` | 59 / 59 通过 |
| 通知主链路回归 | `npx electron verify-v0213.cjs` | 29 / 29 通过 |
| 响应式回归 | `npx electron verify-v0214.cjs` | 13 / 13 通过（1920×1080 / 1050×780 / 750×600，无横向溢出，控制台错误 0） |
| 提醒回归 | `npx electron verify-v0214-reminder.cjs` | 8 / 8 通过（到时提醒只进入 due，不完成待办） |
| 0.2.15 回归 | `npx electron verify-v0215.cjs` | 通过；因北京时间已接近午夜，真实课表姿态切换改由 0.2.16 的投影断言覆盖（见备注） |
| 素材回退回归 | `npx electron verify-v0215-fallback.cjs` | 6 / 6 通过（隐藏素材目录后回退小猫并写日志） |
| EPIPE 回归 | `npx electron verify-epipe-stdio.cjs` | 通过（管道断开不产生主进程未捕获异常） |

`verify-v0214.cjs`、`verify-v0215.cjs` 中针对旧交互的断言（“待办时间筛选”下拉、面包屑返回、设置勾选项、提示文案）已按 0.2.16 的新交互更新，产品行为没有回退。

## Packaged 验证

- `npx electron-builder --win nsis --x64 --config.electronDist=node_modules/electron/dist` 生成 `release/DayHub-Setup-0.2.16.exe`（120,368,804 字节，SHA-256 `E46DC77AD615CDF94FD808287937E4A6A0D5BAFF5CBE6DC165D83A65686D21BE`）与 `release/win-unpacked/`。
- `release/win-unpacked/resources/app.asar`（33,354,453 字节）包含 `dist/assets/companion/custom/manifest.json` 与六个 PNG、`dist/main.cjs`、`dist/preload.cjs`、`dist/ui.js`、`dist/style.css`、`dist/presence-orb.css`、`dist/tray.png`。
- `node verify-v0216-packaged.cjs` 用隔离 `DAYHUB_TEST_DATA` 启动 `release/win-unpacked/事务助手.exe`（单实例锁按 userData 划分，因此不会影响正在运行的正式实例），通过调试协议在**打包版渲染进程**里实测 28 项：
  - 五个真实窗口加载完成，素材解析为六个状态，来源指向 `app.asar` 内的 `assets/companion/custom`；
  - 三层结构（`sprite-stage` / `sprite-inner` / `status-rail`）与 `D ● Y ●` 状态条渲染正确，角色帧已解码完成，状态栏没有 `backdrop-filter`；
  - 样式表包含「hover 只作用于 sprite-inner」与「拖动冻结动画」两条规则；
  - 真实指针序列拖动：`is-dragging` 生效、`sprite-inner` transform 为 `none`、角色动画为 `none`，窗口真的移动且尺寸变化 ≤2px，松手后状态栏仍在、动画恢复，位置写入设置；
  - 收件箱只有一个录入入口，`Ctrl+V` 文字进入 Composer，`Ctrl+Enter` 保存原文并自动整理且详情自动打开，详情底部是 sticky 操作条，原文可回溯、`sourceType=CLIPBOARD`；
  - 事项筛选为「全部 / 待办 / 会议」，设置页使用用户语言且动态效果只有两个选项；
  - 日志记录素材接入、无资源加载失败、无渲染进程退出，且数据确实写入隔离目录。
- 打包版默认窗口宽度 1050px，属于窄窗语义，因此打包脚本断言的是「窄窗有返回入口」；宽窗语义（1320/1920 无返回、列表同屏）由 `verify-v0216.cjs` 与 `verify-v0213.cjs` 覆盖。

## Companion Drag 专项

`verify-v0216.cjs` 的 Companion 段（真实 Electron 窗口）：

| 编号 | 场景 | 结果 |
| --- | --- | --- |
| 1 | idle 姿态拖动 30 次 | 窗口只平移，宽高变化 ≤2px，状态栏完整 |
| 2 | busy_class 姿态拖动 | 同上，姿态与状态栏同时保留 |
| 3 | reminder 姿态拖动 | 同上，提醒姿态不打断拖动 |
| 4 | hover 后立即拖动 | 拖动期间 `sprite-inner` transform=`none`、角色动画=`none`、滤镜=`none` |
| 5 | 拖动过程中状态切换 | 拖动期间冻结所有视觉变化，松手后按新状态恢复 |
| 6 | 拖动完成后 D / Y rail | 六种显示状态 + 每次拖动后 `.rail-chip` 恒为 2 个 |
| 7 | 小 / 中 / 大切换后再拖动 | 尺寸符合固定画布常量，脚底锚点偏移 ≤2px，切换后仍稳定 |
| 8 | 专属角色 → 小猫 → 玻璃球 → 专属角色 | 每次切换后尺寸正确，切回后状态栏恢复，再拖动稳定 |
| 9 | 125% / 150% DPI | 拖动位移与指针位移一致（本次实测 scaleFactor=1.5，位移 120/-30 DIP 完全一致） |
| 10 | 位置持久化 | 设置写入 `settings.orb`；关闭“记住桌宠位置”后不再覆盖 |

补充：窗口尺寸断言使用 2px 容差，因为 Windows 会把透明无边框窗口对齐到物理像素栅格，150% 缩放下同一 DIP 尺寸在不同屏幕位置可能报告 ±1px；圆形本体、角色脚底锚点与状态栏在窗口内的位置使用更严格的断言。

## Inbox Capture 专项

| 编号 | 场景 | 结果 |
| --- | --- | --- |
| A | 进入收件箱直接 `Ctrl+V` 文字 | 文字进入 Composer，可继续编辑，来源记为 `CLIPBOARD` |
| B | `Ctrl+V` 图片 | 直接建图片通知，原图落盘，OCR 在后台进行 |
| C | 拖入图片 | drag-over 有反馈（边框与提示变化），松手后导入并建立通知 |
| D | 手动输入 + `Ctrl+Enter` | 原文先保存，自动整理，右侧详情自动打开 |
| E | OCR 失败 | 原图仍保留，提示“图片已保存，本机识别未完成”，可手动填写 |
| F | Parser / Organizer 失败 | 原文仍保留，详情给出失败原因与重新整理入口 |
| G | 重复通知 | 触发相似事项提示，勾选前主操作不可用 |
| H | Correction | 可更新已有事项，主操作变为「确认更新已有事项」 |

同时确认：录入区不再出现「新建文字通知 / 粘贴文字 / 粘贴截图 / 保存并整理」，只有一个主操作「整理通知」；OCR 进行中不会阻塞下一条录入（原图先入库，识别在后台）。

## Responsive

| 宽度 | 结果 |
| --- | --- |
| 1920×1080 | 详情不无限拉宽，无横向溢出，控制台错误 0 |
| 1320×860 | 左列表 + 右详情同屏，无“返回通知大厅”，固定操作条可见，切换通知稳定 |
| 1050×780 | 主窗口默认宽度：进入详情为窄窗语义，列表隐藏、详情单列 |
| 920×780 | 窄窗详情替换列表，返回后保留筛选与滚动位置 |
| 750×600 | 列表 → 详情 → 返回，恢复原滚动位置（误差 <80px），无横向溢出 |

课表、事项与会议、设置为 `width-fluid / width-adaptive / width-constrained` 三类宽度策略，窄窗下工具栏换行、周课表保持最小列宽并可横向滚动。

## 视觉验收

- `deliverables/ui-catalog-0.2.16/`：84 屏界面目录 + 10 张联系表，含新增的 `50b-companion-rail`（状态栏）、`50c-companion-dragging`（拖动冻结）、`37-inbox-composer-empty / 37b-pasted / 37c-drop`（统一录入区）、`25/25b/25c-tasks-filter-*`（两级筛选）、`36a-inbox-detail-menu`（⋯ 菜单）、`58/61`（外观与动态效果）、`69/70`（桌宠右键与托盘原生菜单）。
- 本轮重点截图：`companion-idle`、`companion-dragging`、`inbox-wide`、`inbox-narrow`、`settings-companion`（同时保存在 `test-data/v0216-runtime-*/`）。

## 已知限制

> 2026-09-11 补充：本轮在 0.2.16 内追加了「状态点颜色语义修复 / 拖动稳定性加固 / 夜间 sleeping 状态」，下面的追加段落是这部分的验收记录，其余章节保持上一轮结论。

## 追加轮次：状态颜色、拖动稳定性与夜间休息（2026-09-11）

### 修了什么

1. **D / Y 同为空闲却颜色不同**：状态点此前存在两套颜色（默认绿色 + `.rail-dot.partner` 粉色），并且 `presence` 语义里 `research` 标记会让「空闲」变成专注蓝、`BUSY_EVENT/BUSY_MEETING` 带标记时会跳色。现在颜色只由 `src/companion-colors.ts` 一张表决定，`presenceStateFor` 与 `statusLabel` 共享同一份语义，颜色不再按人分叉，也没有红色兜底：空闲=绿、即将=琥珀、忙碌=橙、教研=蓝、冲突=红、未知=灰。单元测试逐个状态码穷举「文案 → 颜色」映射，任何同文案多颜色都会立刻失败（本轮就是靠它抓出 `research` 与活动/会议两处残留）。
2. **拖动贴图异常 / 状态条消失**：拖动期间改为「暂停」帧动画而不是删除动画（删除会在松手瞬间重播淡入，看起来像闪一下或贴图错位）；拖动不再切换 `setResizable`、不再切换鼠标穿透；状态栏 `status-rail` 固定贴底并高于 sprite stage，sprite-stage 只到 rail 上沿，角色动画永远不可能裁掉状态栏；尺寸未变化时只调用 `setPosition`。
3. **夜间 sleeping**：北京时间 23:30–06:30，且没有进行中的安排、没有到时间的提醒时进入睡觉姿态；优先级为「待处理提醒 > 进行中的重要事项 > 夜间休息 > 即将开始 > 空闲」。睡觉素材由 `scripts/companion-assets.py` 与六格素材走同一套规范（同画布 418×618、脚底基线 y=604、等比缩放），归属 `assets/companion/custom/sleeping.png`，缺失时回退空闲。

### 测试结果（本轮）

| 项目 | 结果 |
| --- | --- |
| `npm test` | 103 / 103 通过（新增颜色唯一性、夜间窗口、拖动坐标决策用例） |
| `npm run typecheck` | 通过 |
| `npm run build` | 通过 |
| `npx electron verify-v0216.cjs` | 131 / 131 通过（含颜色矩阵、idle 20 次 + sleeping 20 次连续拖动、真实光标 DPI 拖动、sleeping 专项、夜间提醒优先、夜间开关） |
| 回归 | `runtime-audit` 59/59、`verify-v0213` 29/29、`verify-v0214` 13/13、`verify-v0214-reminder` 8/8、`verify-v0215` 通过（夜间窗口分支已说明）、`verify-v0215-fallback` 6/6、EPIPE 通过 |
| `node verify-v0216-packaged.cjs` | 32 / 32 通过（打包版读到七个状态、sleeping 可解码、状态点同色、夜间开关可关闭并持久化） |

颜色语义核对：D 空闲 / Y 空闲 → 同为绿色；D 空闲 / Y 忙碌 → 绿 / 橙；双方忙碌 → 同为橙色；未知 / 未录入课表 → 中性灰；只有 `conflict` 才显示红色。

拖动核对：idle 20 次、sleeping 20 次、reminder 若干次连续拖动后状态栏始终存在且夜间样式保留；拖动结束后画面不重播淡入（`animation-play-state: paused` 生效），窗口尺寸变化 ≤2px（Windows 物理像素对齐），松手位置落盘。

夜间核对：23:29 不睡、23:30 入睡、06:29 仍睡、06:30 起床；夜间有 due reminder 时保持提醒姿态（`base=sleeping` 且 `nightly=true`）不睡觉；关闭设置后夜间不再睡觉；重启/迁移后旧配置自动补齐 `nightRest=true`。

### 打包与安装

- 安装包 `release/DayHub-Setup-0.2.16.exe`（120,667,099 字节，SHA-256 `BF0BF79D…95D8E9`）已重新生成并静默安装到 `C:\Users\hdy\AppData\Local\Programs\dayhub`；安装目录内 `resources/app.asar`（33,653,450 字节，SHA-256 `5CA172C9…A3A0AD0`）与 `release/win-unpacked/resources/app.asar` 完全一致，包内包含 `dist/assets/companion/custom/sleeping.png`。
- 安装后已重新启动正式应用：`dayhub.log` 记录 `启动 0.2.16 packaged=true`、数据源 `%APPDATA%\事务助手\dayhub.sqlite`、课程=40 提醒=128、`桌宠素材 专属角色 · 会根据当前状态自动切换动作`；升级迁移按惯例先生成 `backups/before-v0210-1789061780591.dayhub` 再补齐夜间休息字段，用户数据未被改动。

- 拖入图片只支持静态图片（PNG / JPG / JPEG / WEBP / BMP / GIF 首帧），不支持视频与 PDF。
- `Ctrl+Enter` 提交，Enter 仍为换行；快捷键不可自定义，`Ctrl+K` 只聚焦“事项与会议”的搜索框。
- 图片 OCR 仍走 Windows 本机识别，语言包缺失或权限受限时会失败，但原图始终保留且可手动填写。
- Windows 会把透明无边框窗口对齐到物理像素栅格（150% 缩放实测中号 170×272 而非请求的 168×272），因此窗口尺寸断言使用 2px 容差；角色本体按画布等比缩放，不会变形。
- 打包版验证通过调试协议驱动打包后的渲染进程，未做真实鼠标长按拖动的人工操作；开发模式下的拖动专项使用真实指针事件序列与 30 步连续拖动覆盖。
- 未实测多显示器拔插、125% / 150% 之外的高 DPI 组合、长时间运行内存曲线，以及系统勿扰模式下的通知投递。
- 仍然没有 QQ / 微信 / 在线大模型 / Agent / 云同步 / 移动端 / 教务抓取 / 账号系统，这些属于 0.3.x。

## 验证记录文件

- `test-data/v0216-runtime-1789054427854/report.json`（100/100，含 companion-idle / companion-reminder / inbox-wide / inbox-narrow / settings-companion 截图）
- `test-data/v0216-packaged-1789054529544/report.json`（最终打包产物 28/28）
- `test-data/v0215-runtime-1789053220790/report.json`、`test-data/v0213-1789053086697/report.json`、`test-data/v0214-system-1789053429154/report.json`、`test-data/v0214-reminder-1789053359597/report.json`、`test-data/v02-runtime-1789052759839/report.json`、`test-data/v0215-fallback-1789053510576/report.json`
- `deliverables/ui-catalog-0.2.16/catalog.json` 与 `catalog.md`
