// 品牌资源在运行时的落点定义（与 scripts/brand-paths.mjs 对应）。
//
// Electron main 只引用 `dist/` 下已经由构建复制好的文件名；真正的来源路径
// （母版 / exports / installer 品牌图）在 scripts/brand-paths.mjs 与
// scripts/brand_paths.py 里统一维护，用途映射见 docs/brand-assets.md。

/** 主窗口图标（构建时从 brand/exports/icon-256.png 复制而来）。 */
export const PANEL_ICON_FILE = 'icon.png';

/**
 * 系统托盘图标：Asset 06（深灰青字标）/ Asset 07（近白字标）各三档尺寸。
 *
 * key 是 **Windows 系统主题**，不是字标颜色：
 *   light（浅色任务栏）→ 深灰青字标   dark（深色任务栏）→ 近白字标
 * 文件由 scripts/prepare-tray-icons.py 导出，构建时复制进 dist/。
 */
export const TRAY_ICON_FILES: Record<'light' | 'dark', { scaleFactor: number; file: string }[]> = {
  light: [
    { scaleFactor: 1, file: 'tray-dark-16.png' },
    { scaleFactor: 1.5, file: 'tray-dark-24.png' },
    { scaleFactor: 2, file: 'tray-dark-32.png' },
  ],
  dark: [
    { scaleFactor: 1, file: 'tray-light-16.png' },
    { scaleFactor: 1.5, file: 'tray-light-24.png' },
    { scaleFactor: 2, file: 'tray-light-32.png' },
  ],
};

/**
 * 产品版本，由 esbuild 在构建时注入（见 scripts/build.mjs 的 define）。
 * 开发态直接跑 dist/main.cjs 时同样是这个值，不会再退回 Electron 版本。
 */
declare const __YD_VERSION__: string;

export const PRODUCT_VERSION: string =
  typeof __YD_VERSION__ === 'string' && __YD_VERSION__ ? __YD_VERSION__ : '0.0.0';
