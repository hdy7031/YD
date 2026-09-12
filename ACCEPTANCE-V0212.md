# 0.2.12 Responsive Polish / Layout Policy 验收

日期：2026-09-09。

## 实现范围

- 在现有 `.page-frame` 上增加明确的 `width-fluid`、`width-adaptive`、`width-constrained` 与 Ta 课表阅读宽度策略，不改数据模型、状态引擎和业务流程。
- 课表管理保持 Fluid；首页与事项与会议保持 Adaptive Grid；通知、提醒和设置使用居中 Constrained Content。
- 首页保留宽屏双栏和三个核心区域，移除“今日概览”四宫格。
- Ta 的日程列表限制在 1080px 阅读宽度，行内使用 150px / `minmax(280px, 1fr)` / 172px 三列；1180px 以上的状态卡内部把当前状态与下一节课分区。
- 事项与会议工具栏限制在 980px 内，搜索与筛选相邻，Tabs 保持右侧单行聚合。
- 通知和提醒的页级空状态使用 220px 正常文档流承载区，不再使用剩余 viewport 垂直居中；通知空状态不再重复顶部 CTA。
- 设置页限制在 1120px 并在主内容区居中，内部字段仍保持紧凑 proximity。
- 鼠标焦点与键盘 `:focus-visible` 分开；导航选中使用 `aria-current="page"` 与既有 active 样式，键盘焦点环改为中性蓝灰色。
- 辅助文字、空状态说明、课表更新、地点与日期 meta 的对比度适度提高。

## 自动验证

- `npm run typecheck` 通过。
- `npm test` 通过，58 项测试全部通过。
- `npm run build` 通过。由于 esbuild 在工作区沙箱内受目录读取限制，构建阶段使用获准的沙箱外执行。
- 项目没有配置 `lint` 脚本，因此 lint 不适用。
- `scripts/verify-v0212-ui.cjs` 通过：
  - 实际切换 7 个主页面，请求 1366×768、1440×900、1600×900、1920×1080、2560×1440 五档窗口尺寸，逐页检查水平滚动与元素溢出。
  - 检查 100%、125%、150% 缩放下的设置页布局。
  - 宽屏下 Ta 列表为 1080px，三列间距为 16px；状态卡内部两区成立。
  - 事项工具栏为 980px，搜索与筛选间距 12px，Tabs 保持单行。
  - 通知与提醒空状态高度为 220px、`flex-grow: 0`；通知空状态内操作数为 0。
  - 设置内容宽度为 1120px 且在主区左右边距相等。
  - 课表管理 frame 宽度与主内容可用宽度相等，仿真宽视口下仍保持 Fluid。
  - 真实鼠标输入后导航项 `:focus-visible=false`；键盘 Tab 后 `:focus-visible=true` 且焦点环为 2px。
- `scripts/ui-audit.cjs` 既有主界面交互回归通过。
- `scripts/verify-v0210-ui.cjs` Ta 课表既有功能与 1366 / 1920 / 2560、100% / 125% / 150% 回归通过。该脚本实际记录的大视口为 2546×1377。
- `scripts/visual-v022.cjs` 悬浮球回归通过：D / Y 双状态区、状态点/环、迷你面板和设置内边距均未回归。

## 视觉检查

- 检查了首页 1366 宽度截图，以及 Ta 课表、事项与会议、通知收件箱、未处理提醒、设置与备份、课表管理的 1920 宽度截图。
- 新增截图与几何报告位于 `test-data/v0212-ui`。
- 当前宿主对部分连续 resize 请求会限制到 1906×1017；因此使用独立 Ta 回归实测 2546×1377，并用缩放后 2284px 课表内容区补充超宽屏布局检查。

## 打包与冒烟

- `npm run dist -- --config.electronDist=node_modules/electron/dist` 通过。
- 安装包：`release/DayHub-Setup-0.2.12.exe`，119202395 字节。
- SHA-256：`5078FB9C4461E56514E32C18ABB2F79060C8B5D291843D246B5EFABF9D7F12B1`。
- `app.asar` 内 `package.json` 版本核对为 0.2.12。
- `release/win-unpacked/事务助手.exe` 使用 `test-data/portable-0212-smoke` 隔离数据启动；日志确认 `启动 0.2.12 packaged=true`、主界面/桌宠/气泡页面加载完成。

## 已知边界

- 未发现本轮遗留的响应式溢出、工具栏断裂、列表操作越界或设置表单压缩问题。
- 本轮不改动数据模型、状态引擎、悬浮球交互或正式桌宠素材。
