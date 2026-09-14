# YD 品牌资源用途映射（单一可信来源）

本文档回答一个问题：**哪个文件用于哪个位置，谁负责生成它。**

程序里的品牌资源路径不再各处手写，统一来自：

| 侧 | 定义文件 |
| --- | --- |
| Node / Electron / 构建脚本 | `scripts/brand-paths.mjs` |
| Python 生成脚本 | `scripts/brand_paths.py` |
| Electron main 运行期文件名 | `src/brand-assets.ts` |

`scripts/verify-brand-assets.mjs`（`npm run assets:check`）会校验本文档描述的契约，
包括 `package.json` 里的 electron-builder 路径、ICO 的分层来源、托盘与 Dock 图标规格。

---

## 0. 正式素材（Asset 01–08）用途表

用户确认的 8 张素材全部保存在 `brand/source/`，**运行时与构建只引用这里的导出物**，
不再从历史 commit / archive / legacy 目录里找"看起来差不多"的图。

| 素材 | 母版 | 用途 | 生成脚本 | 产物 |
| --- | --- | --- | --- | --- |
| Asset 01 | `installer-header-master.png` | NSIS 页眉横幅（安装选项 / 目录 / 进度等所有带页眉的向导页） | `installer-brand-assets.py` | `brand/installer/header.bmp` |
| Asset 02 | `installer-sidebar-master.png` | NSIS Welcome / Finish 左侧竖幅 | `installer-brand-assets.py` | `brand/installer/sidebar.bmp` |
| Asset 03 | `dock-icons-master.png` | Dock / 详情面板语义小图标（7 枚） | `prepare-dock-icons.py` | `src/ui/assets/dock-icons/*.png` |
| Asset 04 | `dock-reference.png` | **仅设计参考**，不进入运行时、不进入构建 | — | — |
| Asset 05 | `app-icon-master-v4.png` | App Icon 母版（≥64px frame、窗口图标、关于页展示） | `prepare-app-icon.py` | `brand/exports/yd.ico`、`icon-256/512.png`、`png/yd-*.png` |
| Asset 06 | `tray-monogram-dark-master.png` | 浅色 Windows 主题的系统托盘图标 | `prepare-tray-icons.py` | `brand/exports/tray/dark-16/24/32.png` |
| Asset 07 | `tray-monogram-light-master.png` | 深色 Windows 主题的系统托盘图标 | `prepare-tray-icons.py` | `brand/exports/tray/light-16/24/32.png` |
| Asset 08 | `app-icon-small-master-v4.png` | App Icon 小尺寸光学变体（≤48px frame） | `prepare-app-icon.py` | 合入同一个 `brand/exports/yd.ico` |

> Asset 02 画面里的 "A calmer, more organized you" 只属于该张安装器艺术图本身；
> YD 的 canonical tagline 仍然是 `your day, quietly organized.`。

---

## 1. App Icon（Windows 应用图标）

用于 `.exe`、任务栏、Alt+Tab、桌面 / 开始菜单快捷方式、主窗口图标、安装器窗口图标、
安装器 EXE 与卸载器 EXE。**不存在第二套 competing app icon。**

| 项 | 值 |
| --- | --- |
| 大尺寸母版 | `brand/source/app-icon-master-v4.png`（Asset 05，自带 alpha） |
| 小尺寸母版 | `brand/source/app-icon-small-master-v4.png`（Asset 08，同体系光学变体） |
| 生成脚本 | `python scripts/prepare-app-icon.py`（`npm run assets:icon`） |
| ICO 产物 | `brand/exports/yd.ico` |
| 引用方 | `package.json` → `build.win.icon`、`nsis.installerIcon`、`nsis.uninstallerIcon` |
| 运行期 | `brand/exports/icon-256.png` 由构建复制为 `dist/icon.png`，主窗口 `icon:` 引用它 |

### ICO 分层（九层，单一文件）

| frame | 母版 | 理由 |
| --- | --- | --- |
| 16 / 20 / 24 / 32 / 40 / 48 | Asset 08 | 主体更饱满，缩小后不糊；20/40 供 125% DPI |
| 64 / 128 / 256 | Asset 05 | 完整玻璃细节 |

硬性要求：**四角 alpha 必须为 0**。`prepare-app-icon.py` 会自检母版与每个导出 frame，
不通过直接失败——0.2.21 曾用不透明浅雾白母版导致"白方块 + 白边"。

## 2. Tray Icon（系统托盘）

**App Icon ≠ Tray Icon**：托盘从不使用玻璃 squircle 的缩小版、不使用历史绿色 / 金色素材。

| 项 | 值 |
| --- | --- |
| 母版 | Asset 06 `tray-monogram-dark-master.png`（深灰青）/ Asset 07 `tray-monogram-light-master.png`（近白） |
| 生成脚本 | `python scripts/prepare-tray-icons.py` |
| 产物 | `brand/exports/tray/{dark,light}-{16,24,32}.png` |
| 引用方 | 构建复制为 `dist/tray-{dark,light}-{16,24,32}.png`，`src/main.ts` 的 `new Tray(...)` 使用 |

主题映射（**key 是系统主题，不是字标颜色**）：

| Windows 主题 | 托盘图标 | 理由 |
| --- | --- | --- |
| 浅色（`nativeTheme.shouldUseDarkColors === false`） | `dark-*`（深灰青字标） | 亮底需要深色字标 |
| 深色 | `light-*`（近白字标） | 暗底需要浅色字标 |

运行期行为：`src/main.ts` 启动时按当前主题创建 Tray，`nativeTheme.on('updated')` 时
只调用 `tray.setImage(...)`——不重建 Tray，因此菜单、事件与句柄都不会丢。
三档尺寸通过 `nativeImage.addRepresentation({scaleFactor})` 组合成一张图（1x / 1.5x / 2x）。

两枚母版几何视为同一 Logo，只换颜色；导出只裁留白、按内容框对齐，不做描边、不加底盘。

## 3. Installer Icon（安装器窗口 / EXE / 卸载器）

| 项 | 值 |
| --- | --- |
| 来源 | `brand/exports/yd.ico`（与 App Icon 同一文件） |
| 引用方 | `package.json` → `nsis.installerIcon` / `nsis.uninstallerIcon` |

## 4. Installer Branding（安装器品牌图）

素材 → 用途（用户已指定，脚本不做二次设计）：

| 位置 | 素材 | 产物 | 尺寸 |
| --- | --- | --- | --- |
| 页眉（所有带页眉的向导页） | Asset 01 | `brand/installer/header.bmp` | 150 × 57 |
| Welcome / Finish 左侧竖幅 | Asset 02 | `brand/installer/sidebar.bmp` | 164 × 314 |
| 卸载器竖幅 | Asset 02 | `brand/installer/sidebar.bmp` | 164 × 314 |

生成脚本：`python scripts/installer-brand-assets.py`；只做 crop + scale（保持宽高比），
不拉伸、不重绘、不重新排版；源图原样保留在 `brand/source/`。

尺寸与字段来自当前工具链的真实 schema（electron-builder 26 的 NSIS 模板）：

```
node_modules/app-builder-lib/out/targets/nsis/NsisTarget.js
  nsis.installerHeader  → MUI_HEADERIMAGE + MUI_HEADERIMAGE_RIGHT + MUI_HEADERIMAGE_BITMAP
  nsis.installerSidebar → MUI_WELCOMEFINISHPAGE_BITMAP
  nsis.uninstallerSidebar → MUI_UNWELCOMEFINISHPAGE_BITMAP
```

> NSIS 2 的向导位图不支持 alpha；必须是 24 位未压缩 BMP，带透明通道会渲染成黑块。
> 脚本与 `npm run assets:check` 都会校验位深。

## 5. About 页品牌展示

| 项 | 值 |
| --- | --- |
| 完整渐变字标 | `src/ui/assets/gen/yd-logo-gradient.png` |
| 引用方 | `src/ui/brand.ts` 的 `BrandMark`（关于页） |
| 生成脚本 | `python scripts/prepare-visual-assets.py`（源 `brand/source/yd-logo-reference.png` → `yd-logo-mist-master.png`） |

## 6. 应用内轻量字标 / monogram

| 项 | 值 |
| --- | --- |
| 单色字标 | `src/ui/assets/gen/yd-logo-mono.png`（标题栏、小尺寸） |
| 白色字标 | `src/ui/assets/gen/yd-logo-mono-white.png`（深色底） |
| 引用方 | `src/ui/brand.ts` 的 `BrandGlyph` |
| 生成脚本 | `npx electron scripts/brand-render.cjs`（`brand/exports/svg`、`png/yd-mono-*` 同源） |

## 7. Dock 语义图标（Asset 03）

用于状态 Dock 的详情面板（当前 / 下一项）。**只属于 UI 表现层**，
`CurrentState` 里没有 icon 字段；找不到准确映射时只显示状态点 + 文字，不用 emoji。

| 语义 | 文件 | 映射 |
| --- | --- | --- |
| calendar | `src/ui/assets/dock-icons/calendar.png` | 课程 / 日程 / 下一项安排 |
| meeting | `.../meeting.png` | 会议 / 活动 |
| task | `.../task.png` | 待办 / 工作 |
| reading | `.../reading.png` | 阅读 / 轻休闲 |
| commute | `.../commute.png` | 通勤 |
| meal | `.../meal.png` | 用餐 |
| sleep | `.../sleep.png` | 夜间 / 午休 |

生成脚本 `python scripts/prepare-dock-icons.py`：按透明度自动切分母版，逐枚归一化到
64×64 透明画布（最长边 86%），并检查 alpha、四角透明与非透明底。

## 8. 版本号来源

| 位置 | 来源 |
| --- | --- |
| 应用真实版本 | `package.json` 的 `version` |
| About 页 | 构建时注入（`esbuild define __YD_VERSION__`），开发态与打包态一致 |
| 安装器显示版本 | NSIS 从 electron-builder 的 `${version}` 取 |
| 安装包文件名 | package.json → `artifactName: YD-Setup-${version}.${ext}` |

---

## 禁止用于生产（历史留档）

以下资源仅作考古，**任何链路都不得引用**。它们代表已被取代的视觉方案，
历史上因为"看起来像图标"而被误引用，导致安装器 / 托盘出现旧版金色或绿色素材。

| 位置 | 说明 |
| --- | --- |
| `brand/source/legacy/yd-app-icon-master.png` | v1 金色母版 |
| `brand/source/legacy/yd-app-icon-master-green-v1.png` | 更早的绿色初版 |
| `brand/source/legacy/yd-app-icon-master-white-bg.png` | 白底中间稿 |
| `brand/source/legacy/app-icon-master.png` / `-v2.png` | 浅雾白且**无 alpha**，曾造成白方块 |
| `brand/source/legacy/yd-app-icon-mist-master.png` | 旧的雾底字标候选 |
| `brand/source/legacy/app-icon-master-v3.png` | 上一代程序图标（2026-09-14 由 Asset 05 / 08 取代） |
| `brand/legacy/01-app-icon-transparent.png` | 旧金色透明图标 |
| `brand/legacy/03-tray-mark.png` / `03b-tray-mark-white.png` | **0.2.17 深金托盘字标**——托盘曾误用它 |
| `brand/legacy/tray-vector/tray-{16,24,32}.png`、`tray-white-*.png` | 0.2.17–0.2.21 的**矢量重绘**托盘字标（由 `brand-render.cjs` 从 `brand-mark.mjs` 光栅化）；2026-09-14 起由 Asset 06/07 取代 |
| `brand/legacy/09-mark-ta.png`、`brand/legacy/app-icon-master.png` | 旧配色备选 |

`scripts/brand-paths.mjs` 的 `LEGACY_BRAND` 数组列出同一份清单，供脚本自动化检查使用。

历史提示词文档 `docs/brand_asset_prompts.md`、`BRAND-IMAGE-PROMPTS.md` 描述的是金色
那一代方案，同样只是留档。
