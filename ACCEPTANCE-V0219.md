# YD 0.2.19 验收记录（品牌收敛与高级化精修）

日期：2026-09-11 · 版本：`0.2.18 → 0.2.19` · 数据目录：`%APPDATA%\事务助手`（未改动）

## 1. 交付物

| 项目 | 值 |
| --- | --- |
| 安装包 | `release\YD-Setup-0.2.19.exe`（127,780,985 字节，16:57:23，含关于页字标大小写修正） |
| SHA256 | `244B7CBF215862B283D79C4E930A0BF7786F0744CBABEB85EBB4DE20873DDEB7` |
| 已安装程序 | `C:\Users\hdy\AppData\Local\Programs\dayhub\YD.exe`（16:57 覆盖并已启动） |
| 程序版本 | ProductVersion `0.2.19.0` · FileVersion `0.2.19` |
| 卸载项 | `YD 0.2.19` |
| 安装前备份 | `test-data\pre-v0219-reinstall-20260911-164943\`（sqlite + .bak + log） |

## 2. 真实桌面端启动核对

```
2026-09-11T08:50:57.054Z [info] 启动 0.2.19 packaged=true
2026-09-11T08:50:57.134Z [info] 数据源 C:\Users\hdy\AppData\Roaming\事务助手\dayhub.sqlite · 课程=40 待办=0 提醒=128
2026-09-11T08:50:57.138Z [info] 桌宠素材 专属角色 · 会根据当前状态自动切换动作
2026-09-11T08:50:57.550Z [info] 主界面、桌宠与气泡页面已加载
```

- 结论：真实安装路径启动 0.2.19，读取真实数据库（课程 40 / 提醒 128），数据未重建、未迁移。

## 3. 本轮精修对照（截图：`deliverables\ui-shots-0.2.19\shots\`）

| 检查点 | 结果 |
| --- | --- |
| 标题栏品牌 | 唯一 lockup：`[扁平 monogram] YD YOUR DAY`，无黄色方砖 |
| 侧栏顶部 | 品牌块已删除，导航从第一项开始，顶部只留 18px 呼吸 |
| 侧栏选中态 | 浅胶囊 + 2px 黄铜金竖线 + 深色文字，无阴影无渐变无金字 |
| 左下角 | 一行 `● 本地模式`，tooltip「数据保存在本机，可离线使用」 |
| 首页 | 已删除 slogan；Day Arc 最强（opacity .9） |
| 工具页 | Day Arc 明显更弱（.38）；顶部留白收紧约 25%（对照 `04-courses.png` / `06-inbox.png`） |
| 「接下来」卡片 | 大 Y 水印 .022 / 186px / 右下角，不遮倒计时 |
| 金色 | 黄铜金 `#B08E4A` / 深档 `#7A6230` / 按钮 `#E6CE8C→#D6B863`，无柠檬黄 |
| 中性色 | 收件箱去蓝（`#F2F0EA` 等）；课程色改粉笔色（雾绿 / 雾紫 / 淡杏 / 灰粉） |
| 窗口控件 | 无默认分隔线，hover 才反馈；关闭按钮保留红色语义 |
| 滚动条 | 10px 细条，默认 13% 灰，hover 24% |

## 4. 工程校验

- `npx tsc --noEmit`：通过。
- `npm run build`：通过（`Build complete`）。
- `npx electron-builder --win nsis --x64 -c.electronDist=node_modules/electron/dist`：通过。
- 改动文件：`src/ui/style.css`、`src/ui/app.ts`、`src/ui/companion.ts`、`src/ui/views.ts`、`package.json`、`CHANGELOG.md`。

## 5. 说明

- 本轮**没有新增任何品牌元素**：仍然只有 YD Monogram、Day Arc、Day Dot / Day Line 三种语言。
- 完整 squircle app icon 只在桌面 / 开始菜单 / 任务栏 / 托盘 / 安装包出现，应用内部一律使用扁平 monogram。
- 品牌短句 `your day, quietly organized.` 已从首页移除，保留给启动页、About、首次引导等低频场景。
