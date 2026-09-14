"""从用户确认的两枚托盘字标母版导出 Windows 托盘图标（浅色主题 / 深色主题）。

素材 → 用途（用户已指定）：

    Asset 06  brand/source/tray-monogram-dark-master.png   深灰青 YD 字标
              → 浅色 Windows 任务栏（亮底需要深色字标）
    Asset 07  brand/source/tray-monogram-light-master.png  近白 YD 字标
              → 深色 Windows 任务栏

两枚字标属于同一套几何：脚本只裁掉画布留白、按内容框对齐到同一块正方形画布，
不做描边、不加底盘、不改变宽高比、不改颜色（颜色由母版决定）。

产物（每个主题 16 / 24 / 32，供 Electron nativeImage 的 scaleFactor 表示）：

    brand/exports/tray/dark-16.png    1x
    brand/exports/tray/dark-24.png    1.5x
    brand/exports/tray/dark-32.png    2x
    brand/exports/tray/light-{16,24,32}.png

运行：python scripts/prepare-tray-icons.py
"""
from __future__ import annotations

import sys

import numpy as np
from PIL import Image

import brand_paths as bp

SIZES = (16, 24, 32)
# 字标内容宽度占画布的比例：字标是横向的 YD 连体，按宽度对齐最饱满。
CONTENT_WIDTH_FRACTION = 0.94
# 透明阈值：低于它的像素视为画布留白。
ALPHA_FLOOR = 16


def content_box(mark: Image.Image) -> tuple[int, int, int, int]:
    alpha = np.asarray(mark)[..., 3]
    ys, xs = np.where(alpha > ALPHA_FLOOR)
    if not len(xs):
        raise SystemExit("托盘字标母版没有可见内容")
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def normalize(path, label: str) -> tuple[Image.Image, float]:
    """裁到内容框并按统一画布比例重排；返回 (画布, 内容宽高比)。"""
    if not path.exists():
        raise SystemExit(f"缺少{label}母版：{path}")
    mark = Image.open(path).convert("RGBA")
    box = content_box(mark)
    cropped = mark.crop(box)
    # 先输出 512 高的工作画布，再按目标尺寸缩放（避免逐尺寸重复量化）。
    work = 512
    content_width = work * CONTENT_WIDTH_FRACTION
    scale = content_width / cropped.width
    resized = cropped.resize((round(cropped.width * scale), round(cropped.height * scale)), Image.LANCZOS)
    canvas = Image.new("RGBA", (work, work), (0, 0, 0, 0))
    canvas.alpha_composite(resized, ((work - resized.width) // 2, (work - resized.height) // 2))
    return canvas, cropped.width / cropped.height


def main() -> int:
    dark, dark_ratio = normalize(bp.TRAY_DARK_MASTER, "浅色主题托盘字标")
    light, light_ratio = normalize(bp.TRAY_LIGHT_MASTER, "深色主题托盘字标")

    bp.EXPORT_TRAY.mkdir(parents=True, exist_ok=True)
    written = []
    for name, canvas in (("dark", dark), ("light", light)):
        for size in SIZES:
            frame = canvas.resize((size, size), Image.LANCZOS)
            target = bp.EXPORT_TRAY / f"{name}-{size}.png"
            frame.save(target, optimize=True)
            written.append(target.relative_to(bp.ROOT))

    print(f"托盘图标已生成（{len(written)} 个文件）：")
    for item in written:
        print("  ", item)
    print(f"  几何：内容宽高比 dark={dark_ratio:.3f} light={light_ratio:.3f}（两枚母版自身差异，未做拉伸）")
    print("  映射：浅色 Windows 主题 → dark-*；深色 Windows 主题 → light-*")
    return 0


if __name__ == "__main__":
    sys.exit(main())
