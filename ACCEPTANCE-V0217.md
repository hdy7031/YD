# 0.2.17 YD Brand Refresh 验收

验证日期：2026-09-11。所有自动测试与 Electron 运行审计使用项目内隔离数据目录（`DAYHUB_TEST_DATA`）；打包与安装验证使用真实安装目录与真实用户数据（只读核对日志与数据行数）。

## 本次范围

只做品牌与界面：主品牌升级为 **YD / Your Day**，重做 logo / 图标资产、配色 token、侧栏品牌区、标题栏、按钮与卡片质感、空状态与水印语言、状态语义色。没有新增业务能力，没有改动状态引擎、提醒生命周期、Inbox 主链路、课表 / 事项 / 备份模型。

## 品牌系统

- 主名 **YD**，副名 **Your Day**，品牌短句 `your day, quietly organized.`，中文功能描述「本地日程中枢」。
- Logo：软方徽记 + YD 联结字标，96×96 单一几何推导全部尺寸；`large`（≥32px，笔画 10）与 `small`（16–24px，笔画 13）两个档位。
- 色彩 token（`--yd-*`）：深鼠尾草绿 `#2F4C3D`、暖雾白 `#F1EFE9`、低饱和玫瑰灰 `#A9838D`（仅 Ta 与状态点缀）、文本深墨绿灰 `#1F2521`、极浅暖灰线 `#E3DFD5`、侧栏深绿墨 `#1E2A22`。
- 状态语义色唯一来源 `src/companion-colors.ts`：空闲 `#8CBE9E`、即将 `#D6AE6A`、忙碌 `#DE9A63`、专注 `#8FAED2`、冲突 `#C2726A`、未知 `#A3ACB0`；主窗口双状态、迷你面板、悬浮球、桌宠状态条共用同一映射。
- 品牌语言：极浅时间弧氛围层（`.page-atmosphere`，会被裁剪，不制造横向滚动）、标题下的 32×2px 品牌短线、空状态右下角与侧栏底部水印（4–5% 不透明度）。

## 界面改动

1. 左上角品牌区：`[徽记 42px] + YD` / `Your Day · 本地日程中枢`，字号 19px / 字距 `.18em`。
2. 标题栏：`[字标] YOUR DAY`，窗口按钮 hover 改为品牌色 / 关闭红。
3. 侧栏：深绿墨底 + 顶部高光，选中态为品牌色渐变 + 左侧 2px 强调线；底部改为「本地优先存储 / 离线可用 · 北京时间」。
4. 首页：「我的 / Ta」改为双列状态模块（称呼 → 状态 → 依据三级层级）；「接下来」卡片保留左侧 3px 品牌条并加极浅时间弧；「今日日程」空状态改为水印 + 柔和引导。
5. 卡片系统：`.entry / .panel / .management-section / .focus-strip / .schedule-* / .modal` 统一 12–14px 圆角、暖灰细线、纸面配色，去掉玻璃拟态与彩色光晕。
6. 按钮体系：主按钮深鼠尾草渐变 + 内高光，次按钮品牌浅底描边，ghost / text-button 更克制；focus-visible 统一品牌色描边。
7. 课表：课程块、格子线、工具栏全部收敛到品牌配色；Ta 的日程使用玫瑰灰点缀（状态条、当前行、状态胶囊）。
8. 悬浮球：由通用青绿玻璃改为深鼠尾草玻璃，状态点使用同一语义色板。
9. 文案：「事务助手」在界面上清零，统一为 YD；备份文件对话框为「YD 备份」，课表为「YD 课表」，通知为「YD · 提醒气泡 / YD · 待处理提醒」。

## 自动测试结果

| 项目 | 命令 / 脚本 | 结果 |
| --- | --- | --- |
| 单元测试 | `npm test` | 103 / 103 通过 |
| 类型检查 | `npm run typecheck` | 通过 |
| 构建 | `npm run build` | 通过（`dist/main.cjs`、`dist/ui.js`、`dist/style.css`、`dist/tray.png`、`dist/icon.png`） |
| 基础运行审计 | `npx electron runtime-audit.cjs` | 59 / 59 通过 |
| 通知主链路 | `npx electron verify-v0213.cjs` | 29 / 29 通过 |
| 响应式回归 | `npx electron verify-v0214.cjs` | 13 / 13 通过（1920×1080 / 1050×780 / 750×600 无横向溢出，控制台错误 0） |
| 提醒回归 | `npx electron verify-v0214-reminder.cjs` | 8 / 8 通过 |
| 桌宠与收件箱 | `npx electron verify-v0215.cjs` | 46 / 46 通过 |
| 素材回退 | `npx electron verify-v0215-fallback.cjs` | 6 / 6 通过 |
| 0.2.16 全量回归 | `npx electron verify-v0216.cjs` | 131 / 131 通过（含状态点语义矩阵与拖动专项） |
| 打包版审计 | `node verify-v0216-packaged.cjs` | 32 / 32 通过（针对 `release/win-unpacked/YD.exe`） |
| EPIPE 回归 | `node verify-epipe-stdio.cjs` | 通过（打包版管道断开无未捕获异常） |

## 视觉验收

- 开发态截图：`test-data/v0217-visual-1789066134611/`（`01-today`、`02-brand-sidebar`、`03-courses`、`04-tasks`、`05-partner`、`06-settings`、`07-today-compact`、`08-orb`、`09-mini-panel`、`10-companion`），另含 `metrics.json`（品牌文案、底部说明、状态行文本）。
- 方向探索与尺寸自检：`brand/explore/directions.png`（方向 A / B / C + 16–128px 阶梯 + 8 倍放大实拍）。
- 安装后真实窗口：`test-data/v0217-installed-window.png`、`test-data/v0217-installed-desktop.png`、`brand/explore/installed-exe-icon.png`。

## 图标资产

| 资产 | 路径 | 说明 |
| --- | --- | --- |
| SVG 主文件 | `brand/exports/svg/yd-mark.svg` | 主标（含 small / porcelain / mono / glyph 变体） |
| PNG 多尺寸 | `brand/exports/png/yd-16…512.png` | 每个尺寸按真实像素渲染 |
| 单色 PNG | `brand/exports/png/yd-mono-64/128/256/512.png` | 字标挖空，供单色场合 |
| Windows ICO | `brand/exports/yd.ico` | 16/24/32/48/64/128/256 七层，已用于 exe 与安装包 |
| 托盘 / 任务栏 | `brand/exports/tray-32.png` → `dist/tray.png` | 小尺寸专用字面 |
| 应用主图标 | `brand/exports/icon-256.png` / `icon-512.png` | 窗口图标 |

## 打包与安装

- 打包命令：`npx electron-builder --win nsis --x64 --config.electronDist=node_modules/electron/dist`（NSIS / winCodeSign 走本机已有缓存）。
- 安装包：`release/YD-Setup-0.2.17.exe`，120,699,180 字节，SHA-256 `AAA181F16FC46C44E87981426C7D8456B8A6CD5A3EED51454BACCB5467F2CDD5`。
- 打包目录：`release/win-unpacked/YD.exe`（246,202,368 字节，FileVersion / ProductVersion `0.2.17`，ProductName `YD`），`resources/app.asar` 33,687,556 字节。
- 静默安装：`release/YD-Setup-0.2.17.exe /S`，exit 0；沿用同一 appId（`cn.dayhub.desktop`）在同目录就地升级到 `C:\Users\hdy\AppData\Local\Programs\dayhub`（旧 `事务助手.exe` 已移除，卸载程序为 `Uninstall YD.exe`）。
- 注册表卸载项：`YD 0.2.17`，DisplayIcon 指向 `...\dayhub\YD.exe`；桌面快捷方式由 `事务助手.lnk` 替换为 `YD.lnk`。
- 安装目录内 `resources/app.asar` 与 `release/win-unpacked/resources/app.asar` SHA-256 完全一致（`1AF969C7…4EB664`）。
- 安装后启动核对（真实数据，未使用任何测试钩子）：`dayhub.log` 记录 `启动 0.2.17 packaged=true`、`数据源 C:\Users\hdy\AppData\Roaming\事务助手\dayhub.sqlite · 课程=40 待办=0 提醒=128`，与 0.2.16 一致——升级没有迁移、没有改写用户数据。

## 已知限制

- **生图模型不可用**：本轮会话没有内置图像生成工具，环境也未配置 `OPENAI_API_KEY`（CLI 备用通道需要它），因此没有调用 image2.5 生图。logo 探索改为矢量方式完成：`brand/explore/directions.png` 给出三个方向（A 软方徽记 / B 字标优先 + 日线 / C 圆徽记 + 日弧）与尺寸阶梯，最终选择方向 A，并以可复现的几何（`scripts/brand-mark.mjs`）落地为 SVG / PNG / ICO。若需要生图风格的草稿，可在配置 API Key 后补做，不影响当前已落地资产。
- 安装包未配置发行者签名证书，Windows 可能显示「未知发布者」。
- 托盘图标在系统托盘中的观感依赖系统缩放，本轮验证到「32px 图层 + 16/24/32 实拍清晰」（`directions.png` 下半部分），未在多套 DPI / 深浅主题下逐个人工核对。
- 16px 下字标 YD 可辨认但字距最紧，小于 16px 请改用纯字标变体。
- 其他既有边界（未接入 QQ / 微信 / 在线模型 / 云同步 / 移动端，OCR 依赖系统语言包与策略）与 0.2.16 相同。

## 验证记录文件

- `test-data/v0217-visual-1789066134611/`（品牌改版截图 + metrics.json）
- `test-data/v0216-runtime-1789066569929/report.json`（131/131）
- `test-data/v0216-packaged-1789066951699/`（打包版 32/32）
- `test-data/v0214-system-1789066402107/`（响应式 13/13）、`test-data/v02-runtime-1789066221805/`（运行审计 59/59）
- `test-data/epipe-report-1789067212834.json`
