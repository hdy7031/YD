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

// Asset 编号（01–08）与用户交付顺序一致，用途映射见 docs/brand-assets.md。
export const BRAND = {
  /** Asset 05：程序图标母版（玻璃 / Mist & Sage squircle + YD 字标，自带 alpha）。 */
  appIconMaster: 'brand/source/app-icon-master-v4.png',
  /** Asset 08：App Icon 小尺寸光学变体（只用于 ICO 的 ≤48px frame）。 */
  appIconSmallMaster: 'brand/source/app-icon-small-master-v4.png',
  /** 程序图标 ICO（.exe / 任务栏 / Alt+Tab / 快捷方式 / 开始菜单 / 安装器 / 卸载器）。 */
  appIcon: 'brand/exports/yd.ico',
  /** 程序图标 PNG：窗口图标与商店/文档用大图。 */
  appIconPng: 'brand/exports/icon-256.png',
  appIconPngLarge: 'brand/exports/icon-512.png',
  /** Asset 06 / 07：托盘字标母版（深灰青 / 近白，几何同一枚）。 */
  trayDarkMaster: 'brand/source/tray-monogram-dark-master.png',
  trayLightMaster: 'brand/source/tray-monogram-light-master.png',
  /** 托盘产物：浅色 Windows 主题用 dark-*，深色主题用 light-*（16/24/32）。 */
  trayDark16: 'brand/exports/tray/dark-16.png',
  trayDark24: 'brand/exports/tray/dark-24.png',
  trayDark32: 'brand/exports/tray/dark-32.png',
  trayLight16: 'brand/exports/tray/light-16.png',
  trayLight24: 'brand/exports/tray/light-24.png',
  trayLight32: 'brand/exports/tray/light-32.png',
  /** Asset 01 / 02：安装器品牌素材母版与 build-ready 位图（24 位 BMP）。 */
  installerHeaderMaster: 'brand/source/installer-header-master.png',
  installerSidebarMaster: 'brand/source/installer-sidebar-master.png',
  installerHeader: 'brand/installer/header.bmp',
  installerSidebar: 'brand/installer/sidebar.bmp',
  /** Asset 03 / 04：Dock 语义图标母版与视觉参考稿。 */
  dockIconsMaster: 'brand/source/dock-icons-master.png',
  dockReference: 'brand/source/dock-reference.png',
  /** 界面字标：完整渐变（关于页）与单色（标题栏 / 小尺寸）。 */
  uiMarkGradient: 'src/ui/assets/gen/yd-logo-gradient.png',
  uiMarkMono: 'src/ui/assets/gen/yd-logo-mono.png',
  uiMarkMonoWhite: 'src/ui/assets/gen/yd-logo-mono-white.png',
  /** 字标母版与参考图。 */
  markMaster: 'brand/source/yd-logo-mist-master.png',
  markReference: 'brand/source/yd-logo-reference.png',
};

/**
 * 构建时复制进 dist 的资源（源 → dist 内的文件名，构建脚本负责加 dist/ 前缀）。
 * 托盘三档尺寸各自成文件：Electron 用 scaleFactor 表示选取，避免 125%/150% 缩放模糊。
 */
export const DIST_COPIES = [
  [BRAND.appIconPng, 'icon.png'],
  [BRAND.trayDark16, 'tray-dark-16.png'],
  [BRAND.trayDark24, 'tray-dark-24.png'],
  [BRAND.trayDark32, 'tray-dark-32.png'],
  [BRAND.trayLight16, 'tray-light-16.png'],
  [BRAND.trayLight24, 'tray-light-24.png'],
  [BRAND.trayLight32, 'tray-light-32.png'],
];

/** 面板 / 托盘在 dist 里的实际文件名（Electron main 侧引用）。 */
export const DIST_FILES = {
  panelIcon: 'icon.png',
  trayDark: ['tray-dark-16.png', 'tray-dark-24.png', 'tray-dark-32.png'],
  trayLight: ['tray-light-16.png', 'tray-light-24.png', 'tray-light-32.png'],
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
  // 上一代程序图标母版（2026-09-14 由 Asset 05 / 08 取代）。
  'brand/source/legacy/app-icon-master-v3.png',
  'brand/legacy/01-app-icon-transparent.png',
  'brand/legacy/03-tray-mark.png',
  'brand/legacy/03b-tray-mark-white.png',
  'brand/legacy/09-mark-ta.png',
  'brand/legacy/app-icon-master.png',
  // 0.2.17–0.2.21 的矢量托盘字标（浅色任务栏单色版）：被 Asset 06/07 取代，
  // 见 docs/brand-assets.md 的历史留档表。
  'brand/legacy/tray-vector/tray-16.png',
  'brand/legacy/tray-vector/tray-24.png',
  'brand/legacy/tray-vector/tray-32.png',
  'brand/legacy/tray-vector/tray-white-16.png',
  'brand/legacy/tray-vector/tray-white-24.png',
  'brand/legacy/tray-vector/tray-white-32.png',
];
