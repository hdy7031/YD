# YD 0.2.18 验收记录（金色品牌定稿 + 冷白重绘）

日期：2026-09-11 · 版本：`0.2.17 → 0.2.18` · 数据目录：`%APPDATA%\事务助手`（未改动）

## 1. 交付物

| 项目 | 值 |
| --- | --- |
| 安装包 | `release\YD-Setup-0.2.18.exe`（127,780,078 字节，2026-09-11 13:50:47） |
| SHA256 | `B96832206F3103130AC2FFB8F3EDE6913361F6083A580485802078C7B8E3C28E` |
| 已安装程序 | `C:\Users\hdy\AppData\Local\Programs\dayhub\YD.exe`（246,234,624 字节，13:50:44） |
| 程序版本 | ProductVersion `0.2.18.0` · FileVersion `0.2.18` |
| 卸载项 | `YD 0.2.18`（HKCU 卸载表） |
| 快捷方式 | 桌面 `YD.lnk`、开始菜单 `YD.lnk` 均指向安装目录的 `YD.exe` |

## 2. 真实桌面端启动核对（非沙箱）

覆盖安装后以真实用户身份启动已安装的 YD：

```
2026-09-11T05:53:15.761Z [info] 启动 0.2.18 packaged=true
2026-09-11T05:53:15.806Z [info] 数据源 C:\Users\hdy\AppData\Roaming\事务助手\dayhub.sqlite · 课程=40 待办=0 提醒=128
2026-09-11T05:53:15.810Z [info] 桌宠素材 专属角色 · 会根据当前状态自动切换动作
2026-09-11T05:53:16.187Z [info] 主界面、桌宠与气泡页面已加载
2026-09-11T05:53:16.246Z [info] 启动显示 主窗口=true 开机自启=false
```

- 结论：**真实安装路径启动的是 0.2.18，读的是真实数据库（课程 40 / 提醒 128），数据未被重建或迁移。**
- 安装前备份：`test-data\pre-v0218-reinstall-20260911-134923\`（dayhub.sqlite / .bak / dayhub.log）。
- 安装前的 0.2.17 进程（8 个）已先关闭再覆盖安装。

## 3. 界面验收（截图）

开发态全页面截图（1320×880 与 1920×1000）：`deliverables\ui-shots-0.2.18\shots\`

| 截图 | 检查点 |
| --- | --- |
| `01-today-empty.png` | 冷白画布、白色玻璃侧栏与标题栏、金色品牌锚点、首次使用横幅（冷色金调） |
| `02-today.png` | 状态区、需处理面板、"接下来"卡片（金竖线 + 极淡纹样）、今日日程 |
| `03-partner.png` / `03b-partner-wide.png` | Ta 的日程：课程卡 + 当日时间轨；最大化窗口下卡片与字号放大一档 |
| `06-inbox.png` / `08-settings-top.png` | 收件箱选中态、设置项选中态统一到品牌金 |
| `09-settings-bottom.png` | 关于区块：封面素材 + 金标 + `YD · Your Day` + 产品语 |

已安装应用实拍：`deliverables\installed-0.2.18\launch.png`（真实数据「思政课一 / 09-14」在 0.2.18 界面中显示）。

## 4. 工程校验

- `npx tsc --noEmit`：通过（0 错误）。
- `npm run build`：通过（`Build complete`）。
- `npx electron-builder --win nsis --x64 -c.electronDist=node_modules/electron/dist`：通过。
  （直接 `npm run dist` 会尝试联网下载 Electron 与 winCodeSign，本机网络受限，故指定本地运行时缓存。）
- 图标资源：`brand/exports/yd.ico`、`icon-256.png`、`icon-512.png`、`tray-32.png` 均由定稿母版重新导出。

## 5. 已知限制 / 后续

- 生图素材的透明度与压暗档位由 CSS 控制在 4%–12% 之间；若某处观感偏重，只需调整
  `src/ui/style.css` 里对应的 `opacity`，素材本身不用重做。
- 16px 托盘图标直接由深金字标缩放得到，若在深色任务栏下对比不足，可用用户已生成的纯白版
  （`03b-tray-mark-white.png`）替换 `brand/exports/tray-32.png`。
- 本轮不改信息架构、业务逻辑与数据层；用户数据目录与旧数据兼容性保持不变。
