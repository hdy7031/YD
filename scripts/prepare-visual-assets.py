"""Prepare the user supplied YD mark for UI and tray use.

This script only cleans, crops and exports the supplied artwork. It does not
redraw the YD geometry. The largest connected alpha component is retained so
isolated extraction specks do not become part of the production mark.

程序图标（Windows .ico / 窗口图标 / 安装包图标）不在这里导出：它必须来自定稿母版
``brand/source/app-icon-master-v3.png``，由 ``scripts/prepare-app-icon.py`` 导出。
把字标直接缩放的旧做法会让不透明浅底在 Windows 上渲染成"白方块 + 白边"，
历史上曾经覆盖过一次定稿资源。用途映射见 ``docs/brand-assets.md``。
"""
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

import brand_paths as bp

ROOT = bp.ROOT
SOURCE = bp.MARK_REFERENCE
MASTER = bp.MARK_MASTER
MONO = bp.UI_MARK_MONO
MONO_WHITE = bp.UI_MARK_MONO_WHITE
UI_MARK = bp.UI_MARK_GRADIENT
OUT = bp.EXPORTS
OUT_PNG = bp.EXPORT_PNG


def clean_mark(source: Image.Image) -> Image.Image:
    rgba = np.asarray(source.convert("RGBA")).copy()
    alpha = rgba[:, :, 3]
    labels, count = ndimage.label(alpha >= 20)
    if count:
        sizes = np.bincount(labels.ravel())
        sizes[0] = 0
        keep = labels == sizes.argmax()
        rgba[:, :, 3] = np.where(keep, alpha, 0)
    # Remove fragile extraction pixels and softly retain the real antialiased edge.
    rgba[:, :, 3] = np.where(rgba[:, :, 3] < 18, 0, rgba[:, :, 3])
    cleaned = Image.fromarray(rgba, "RGBA")
    bbox = cleaned.getchannel("A").getbbox()
    if not bbox:
        raise RuntimeError("The supplied mark has no visible alpha content")
    cropped = cleaned.crop(bbox)
    side = max(cropped.size)
    pad = round(side * 0.095)
    canvas = Image.new("RGBA", (side + pad * 2, side + pad * 2), (0, 0, 0, 0))
    canvas.alpha_composite(cropped, ((canvas.width - cropped.width) // 2, (canvas.height - cropped.height) // 2))
    return canvas


def recolor(mark: Image.Image, color: tuple[int, int, int]) -> Image.Image:
    solid = Image.new("RGBA", mark.size, (*color, 0))
    solid.putalpha(mark.getchannel("A"))
    return solid


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    OUT_PNG.mkdir(parents=True, exist_ok=True)
    UI_MARK.parent.mkdir(parents=True, exist_ok=True)
    mark = clean_mark(Image.open(SOURCE))
    mark.save(MASTER)
    mark.resize((512, 512), Image.Resampling.LANCZOS).save(UI_MARK, optimize=True)
    mono = recolor(mark, (54, 86, 83))
    white = recolor(mark, (247, 250, 250))
    mono.resize((512, 512), Image.Resampling.LANCZOS).save(MONO, optimize=True)
    white.resize((512, 512), Image.Resampling.LANCZOS).save(MONO_WHITE, optimize=True)

    # 本脚本只产出界面侧字标（yd-logo-*）：关于页用完整渐变版，标题栏用单色版。
    #
    # 另外两类品牌资源各有唯一写者，不要在这里重复生成，否则会出现
    # "同一路径被两个脚本写成不同视觉"的历史问题（0.2.17 金 / 绿托盘混用）：
    #   程序图标  → scripts/prepare-app-icon.py（母版 brand/source/app-icon-master-v3.png）
    #   托盘字标  → scripts/brand-render.cjs   （母版 brand/source/yd-logo-mist-master.png）
    # 路径统一见 scripts/brand_paths.py 与 docs/brand-assets.md。


if __name__ == "__main__":
    main()
