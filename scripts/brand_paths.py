"""YD 品牌资源单一来源（Python 生成脚本侧）。

与 ``scripts/brand-paths.mjs`` 保持同一份定义；用途映射见 ``docs/brand-assets.md``。
生成脚本一律从 ``brand/source`` 的定稿母版导出到 ``brand/exports``，
不允许各自去仓库里"找一张像图标的图"。

2026-09-14 收口：用户确认的 8 张正式素材全部落在 ``brand/source/``，本文件按
素材编号登记它们的用途。素材编号（Asset 01–08）与用户交付顺序一致。
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# --- 母版（输入，已提交） ---------------------------------------------------
# Asset 05：正式 App Icon 母版（玻璃 / Mist & Sage squircle + YD 字标）。
APP_ICON_MASTER = ROOT / "brand" / "source" / "app-icon-master-v4.png"
# Asset 08：App Icon 小尺寸光学变体（更饱满），只用于 ICO 的小尺寸 frame。
APP_ICON_SMALL_MASTER = ROOT / "brand" / "source" / "app-icon-small-master-v4.png"
# Asset 06：深灰青 YD 字标（透明底）——浅色 Windows 主题的托盘图标。
TRAY_DARK_MASTER = ROOT / "brand" / "source" / "tray-monogram-dark-master.png"
# Asset 07：近白 YD 字标（透明底）——深色 Windows 主题的托盘图标。
TRAY_LIGHT_MASTER = ROOT / "brand" / "source" / "tray-monogram-light-master.png"
# Asset 03：Dock / 详情面板语义小图标母版（7 枚，透明底）。
DOCK_ICONS_MASTER = ROOT / "brand" / "source" / "dock-icons-master.png"
# Asset 01 / 02：安装器页眉横幅与Welcome/Finish 竖幅。
INSTALLER_HEADER_MASTER = ROOT / "brand" / "source" / "installer-header-master.png"
INSTALLER_SIDEBAR_MASTER = ROOT / "brand" / "source" / "installer-sidebar-master.png"
# Asset 04：Dock 视觉参考稿（设计参考，不进入运行时）。
DOCK_REFERENCE = ROOT / "brand" / "source" / "dock-reference.png"
# 字标定稿：界面内轻量字标（标题栏 / 关于页）仍取自这一份。
MARK_MASTER = ROOT / "brand" / "source" / "yd-logo-mist-master.png"

# --- 产物（输出，已提交） ---------------------------------------------------
EXPORTS = ROOT / "brand" / "exports"
EXPORT_PNG = EXPORTS / "png"
EXPORT_SVG = EXPORTS / "svg"
EXPORT_TRAY = EXPORTS / "tray"
INSTALLER = ROOT / "brand" / "installer"
EXPLORE = ROOT / "brand" / "explore"

APP_ICON = EXPORTS / "yd.ico"
APP_ICON_PNG = EXPORTS / "icon-256.png"
APP_ICON_PNG_LARGE = EXPORTS / "icon-512.png"

# 托盘：每个主题三档尺寸，供 Electron nativeImage 的 scaleFactor 表示使用。
TRAY_DARK_PATTERN = EXPORT_TRAY / "dark-{size}.png"
TRAY_LIGHT_PATTERN = EXPORT_TRAY / "light-{size}.png"

# Dock 语义图标（切分后的独立生产资源）。
DOCK_ICONS = ROOT / "src" / "ui" / "assets" / "dock-icons"

# 安装器品牌图（24 位 BMP，NSIS MUI2 不支持 alpha）。
INSTALLER_HEADER = INSTALLER / "header.bmp"
INSTALLER_SIDEBAR = INSTALLER / "sidebar.bmp"

# --- 界面字标 ---------------------------------------------------------------
UI_MARK_GRADIENT = ROOT / "src" / "ui" / "assets" / "gen" / "yd-logo-gradient.png"
UI_MARK_MONO = ROOT / "src" / "ui" / "assets" / "gen" / "yd-logo-mono.png"
UI_MARK_MONO_WHITE = ROOT / "src" / "ui" / "assets" / "gen" / "yd-logo-mono-white.png"

# --- 视觉常量 ---------------------------------------------------------------
SAGE = (47, 76, 61)          # --yd-brand
MONO_INK = (54, 86, 83)      # 字标单色墨色（界面标题栏）
MIST = (246, 244, 238)       # 暖雾白底
MIST_LIGHT = (252, 251, 247)
LINE = (216, 219, 208)       # 秩序线
MUTED = (138, 146, 138)
