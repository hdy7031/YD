# YD 品牌资源用途映射（单一可信来源）

本文档回答一个问题：**哪个文件用于哪个位置，谁负责生成它。**

程序里的品牌资源路径不再各处手写，统一来自：

| 侧 | 定义文件 |
| --- | --- |
| Node / Electron / 构建脚本 | `scripts/brand-paths.mjs` |
| Python 生成脚本 | `scripts/brand_paths.py` |
| Electron main 运行期文件名 | `src/brand-assets.ts` |

`scripts/verify-brand-assets.mjs`（`npm run assets:check`）会校验本文档描述的契约，
包括 `package.json` 里的 electron-builder 路径是否与上面一致。

---

## 1. App Icon（Windows 应用图标）

用于 `.exe`、任务栏、Alt+Tab、桌面/开始菜单快捷方式、主程序窗口图标。

| 项 | 值 |
| --- | --- |
| 定稿母版 | `brand/source/app-icon-master-v3.png`（瓷白玻璃瓦片 + 灰/鼠尾草 YD 字标，**自带 alpha 圆角**） |
| 生成脚本 | `python scripts/prepare-app-icon.py`（`npm run assets:icon`） |
| ICO 产物 | `brand/exports/yd.ico`（16/20/24/32/40/48/64/128/256 九层） |
| PNG 产物 | `brand/exports/png/yd-*.png`、`brand/exports/icon-256.png`、`icon-512.png` |
| 引用方 | `package.json` → `build.win.icon` |
| 运行期 | `brand/exports/icon-256.png` 由构建复制为 `dist/icon.png`，主窗口 `icon:` 引用它 |

硬性要求：四角 alpha 必须为 0。生成脚本会自检并拒绝不透明母版——0.2.21 曾因为
用了一版**完全不透明**的浅雾白母版，在桌面/任务栏上渲染成"白方块 + 白边"。

## 2. Tray Icon（托盘 / 任务栏角标）

| 项 | 值 |
| --- | --- |
| 定稿母版 | `brand/source/yd-logo-mist-master.png`（字标） |
| 生成脚本 | `npx electron scripts/brand-render.cjs` |
| 产物 | `brand/exports/tray-32.png`、`brand/exports/png/tray-16/24/32.png`；深色任务栏备用 `png/tray-white-*.png` |
| 引用方 | 构建复制为 `dist/tray.png`，`src/main.ts` 的 `new Tray(...)` 引用它 |

托盘与 app icon 是**两套独立资源**，但同属一套视觉：app icon 是瓷白瓦片，托盘是
单色深灰青字标（小尺寸下瓦片的玻璃质感会糊掉）。托盘**不继承** app icon，
修改其一不会影响另一处，必须分别确认。

## 3. Installer Icon（安装器窗口 / 卸载器图标）

| 项 | 值 |
| --- | --- |
| 来源 | `brand/exports/yd.ico`（与 App Icon 同一文件） |
| 引用方 | `package.json` → `nsis.installerIcon` / `nsis.uninstallerIcon` |

## 4. Installer Branding（安装器品牌图）

| 项 | 值 |
| --- | --- |
| 字标来源 | `brand/exports/png/yd-mono-128.png`（单色深灰青，与托盘同源） |
| 生成脚本 | `python scripts/installer-brand-assets.py` |
| 页眉图 | `brand/installer/header.bmp`（150x57，24 位 BMP） |
| 侧幅图 | `brand/installer/sidebar.bmp`（164x314，24 位 BMP） |
| 引用方 | `package.json` → `nsis.installerHeader` / `installerSidebar` / `uninstallerSidebar` |

风格：暖雾白底 + 深灰青字标 + 鼠尾草细线 + `YD / Your Day` / `your day, quietly organized.`。
不使用 About 页截图、旧 logo 拼贴，也不做重渐变。

> NSIS 2 的向导位图不支持 alpha；带透明通道的 PNG/32 位 BMP 会被渲染成黑块，
> 因此这里固定输出 24 位未压缩 BMP（脚本会校验位深）。

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

## 7. 版本号来源

| 位置 | 来源 |
| --- | --- |
| 应用真实版本 | `package.json` 的 `version` |
| About 页 | 构建时注入（`esbuild define __YD_VERSION__`），开发态与打包态一致 |
| 安装器显示版本 | NSIS 从 electron-builder 的 `${version}` 取 |
| 安装包文件名 | package.json → `artifactName: YD-Setup-${version}.${ext}` |

---

## 禁止用于生产（历史留档）

以下资源仅作考古，**任何链路都不得引用**。它们代表已被取代的视觉方案，
历史上因为"看起来像图标"而被误引用，导致安装器/托盘出现旧版金色或绿色素材。

| 位置 | 说明 |
| --- | --- |
| `brand/source/legacy/yd-app-icon-master.png` | v1 金色母版 |
| `brand/source/legacy/yd-app-icon-master-green-v1.png` | 更早的绿色初版 |
| `brand/source/legacy/yd-app-icon-master-white-bg.png` | 白底中间稿 |
| `brand/source/legacy/app-icon-master.png` / `-v2.png` | 浅雾白且**无 alpha**，曾造成白方块 |
| `brand/source/legacy/yd-app-icon-mist-master.png` | 旧的雾底字标候选 |
| `brand/legacy/01-app-icon-transparent.png` | 旧金色透明图标 |
| `brand/legacy/03-tray-mark.png` / `03b-tray-mark-white.png` | **0.2.17 深金托盘字标**——托盘曾误用它 |
| `brand/legacy/09-mark-ta.png`、`brand/legacy/app-icon-master.png` | 旧配色备选 |

`scripts/brand-paths.mjs` 的 `LEGACY_BRAND` 数组列出同一份清单，供脚本自动化检查使用。

历史提示词文档 `docs/brand_asset_prompts.md`、`BRAND-IMAGE-PROMPTS.md` 描述的是金色
那一代方案，同样只是留档。
