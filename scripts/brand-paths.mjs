// YD 品牌资源单一来源（Node / Electron 侧）。
//
// Python 生成脚本共用同一份定义，见 `scripts/brand_paths.py`；
// 人类可读的用途映射见 `docs/brand-assets.md`。
//
// 规矩：
//   1. 任何代码需要品牌资源路径时，从这里取，不要各写各的相对路径。
//   2. 这里的路径是"仓库相对路径"，指向已提交的产物或母版。
//   3. electron-builder 的 package.json 配置无法 import 本文件，
//      因此 `scripts/verify-brand-assets.mjs` 会校验两者一致。

export const BRAND = {
  /** 程序图标母版（唯一）：瓷白玻璃瓦片 + 灰/鼠尾草 YD 字标，自带 alpha。 */
  appIconMaster: 'brand/source/app-icon-master-v3.png',
  /** 程序图标 ICO（.exe / 任务栏 / Alt+Tab / 快捷方式 / 开始菜单 / 安装器）。 */
  appIcon: 'brand/exports/yd.ico',
  /** 程序图标 PNG：窗口图标与商店/文档用大图。 */
  appIconPng: 'brand/exports/icon-256.png',
  appIconPngLarge: 'brand/exports/icon-512.png',
  /** 托盘图标（单色鼠尾草字标）与深色任务栏备用白色字标。 */
  tray: 'brand/exports/tray-32.png',
  trayPng: 'brand/exports/png/tray-32.png',
  trayWhite: 'brand/exports/png/tray-white-32.png',
  /** 安装器品牌图（24 位 BMP，NSIS 助手式向导）。 */
  installerHeader: 'brand/installer/header.bmp',
  installerSidebar: 'brand/installer/sidebar.bmp',
  /** 界面字标：完整渐变（关于页）与单色（标题栏 / 小尺寸）。 */
  uiMarkGradient: 'src/ui/assets/gen/yd-logo-gradient.png',
  uiMarkMono: 'src/ui/assets/gen/yd-logo-mono.png',
  uiMarkMonoWhite: 'src/ui/assets/gen/yd-logo-mono-white.png',
  /** 字标母版与参考图。 */
  markMaster: 'brand/source/yd-logo-mist-master.png',
  markReference: 'brand/source/yd-logo-reference.png',
};

/** 构建时复制进 dist 的资源（源 → dist 内的文件名，构建脚本负责加 dist/ 前缀）。 */
export const DIST_COPIES = [
  [BRAND.tray, 'tray.png'],
  [BRAND.appIconPng, 'icon.png'],
];

/** 面板 / 托盘在 dist 里的实际文件名（Electron main 侧引用）。 */
export const DIST_FILES = {
  panelIcon: 'icon.png',
  trayIcon: 'tray.png',
};

/**
 * 禁止用于生产的历史资源：仅作留档，任何链路都不得引用。
 * 详细说明见 docs/brand-assets.md。
 */
export const LEGACY_BRAND = [
  'brand/source/legacy/yd-app-icon-master.png',
  'brand/source/legacy/yd-app-icon-master-green-v1.png',
  'brand/source/legacy/yd-app-icon-master-white-bg.png',
  'brand/source/legacy/app-icon-master.png',
  'brand/source/legacy/app-icon-master-v2.png',
  'brand/source/legacy/yd-app-icon-mist-master.png',
  'brand/legacy/01-app-icon-transparent.png',
  'brand/legacy/03-tray-mark.png',
  'brand/legacy/03b-tray-mark-white.png',
  'brand/legacy/09-mark-ta.png',
  'brand/legacy/app-icon-master.png',
];
