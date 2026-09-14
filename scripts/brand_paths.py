"""YD 品牌资源单一来源（Python 生成脚本侧）。

与 ``scripts/brand-paths.mjs`` 保持同一份定义；用途映射见 ``docs/brand-assets.md``。
生成脚本一律从 ``brand/source`` 的定稿母版导出到 ``brand/exports``，
不允许各自去仓库里"找一张像图标的图"。
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# --- 母版（输入，已提交） ---------------------------------------------------
# 程序图标定稿：瓷白玻璃瓦片 + 灰/鼠尾草 YD 字标，自带 alpha 圆角。
APP_ICON_MASTER = ROOT / "brand" / "source" / "app-icon-master-v3.png"
# 字标定稿：托盘 / 标题栏 / 安装器品牌图共用。
MARK_MASTER = ROOT / "brand" / "source" / "yd-logo-mist-master.png"

# --- 产物（输出，已提交） ---------------------------------------------------
EXPORTS = ROOT / "brand" / "exports"
EXPORT_PNG = EXPORTS / "png"
EXPORT_SVG = EXPORTS / "svg"
INSTALLER = ROOT / "brand" / "installer"

APP_ICON = EXPORTS / "yd.ico"
APP_ICON_PNG = EXPORTS / "icon-256.png"
APP_ICON_PNG_LARGE = EXPORTS / "icon-512.png"

TRAY = EXPORTS / "tray-32.png"
TRAY_WHITE = EXPORT_PNG / "tray-white-32.png"
# 安装器品牌图使用的字标（单色深灰青），由 brand-render.cjs 产出。
TRAY_MONO_128 = EXPORT_PNG / "yd-mono-128.png"

INSTALLER_HEADER = INSTALLER / "header.bmp"
INSTALLER_SIDEBAR = INSTALLER / "sidebar.bmp"

# --- 界面字标 ---------------------------------------------------------------
UI_MARK_GRADIENT = ROOT / "src" / "ui" / "assets" / "gen" / "yd-logo-gradient.png"
UI_MARK_MONO = ROOT / "src" / "ui" / "assets" / "gen" / "yd-logo-mono.png"
UI_MARK_MONO_WHITE = ROOT / "src" / "ui" / "assets" / "gen" / "yd-logo-mono-white.png"

# --- 视觉常量 ---------------------------------------------------------------
SAGE = (47, 76, 61)          # --yd-brand
MONO_INK = (54, 86, 83)      # 字标单色墨色（托盘 / 标题栏）
MIST = (246, 244, 238)       # 暖雾白底
MIST_LIGHT = (252, 251, 247)
LINE = (216, 219, 208)       # 秩序线
MUTED = (138, 146, 138)
