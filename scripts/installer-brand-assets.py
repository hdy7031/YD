"""为 NSIS 助手式安装向导生成品牌位图（header / sidebar）。

只使用 24 位未压缩 BMP：NSIS 2 的向导位图不支持 alpha 通道，带 alpha 的
PNG/32 位 BMP 会被渲染成黑块或白块。这里统一在暖雾底色上作画，避免透明
边缘在半透明处露出白色轮廓。

输出：
  brand/installer/header.bmp   150 x 57   （页眉条）
  brand/installer/sidebar.bmp  164 x 314  （左侧竖幅）

运行：python scripts/installer-brand-assets.py
"""
from __future__ import annotations

import os
import struct
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICON_SOURCE = os.path.join(ROOT, "brand", "exports", "icon-256.png")
MARK_SOURCE = os.path.join(ROOT, "brand", "exports", "png", "yd-64.png")
OUT_DIR = os.path.join(ROOT, "brand", "installer")

MIST = (246, 244, 238)
MIST_DEEP = (238, 235, 226)
MIST_LIGHT = (252, 251, 247)
LINE = (216, 219, 208)
SAGE = (47, 76, 61)
SAGE_SOFT = (126, 154, 135)
SAGE_LIGHT = (231, 237, 230)
INK = (32, 38, 33)
MUTED = (138, 146, 138)

FONT_CANDIDATES = {
    "regular": ["segoeui.ttf", "SegUIVar.ttf", "arial.ttf", "calibri.ttf"],
    "semibold": ["seguisb.ttf", "SegUIVar.ttf", "segoeuib.ttf", "arialbd.ttf"],
}


def load_font(style: str, size: int) -> ImageFont.FreeTypeFont:
    candidates = FONT_CANDIDATES[style]
    for name in candidates:
        for root in (os.environ.get("WINDIR", r"C:\Windows"),):
            path = os.path.join(root, "Fonts", name)
            if os.path.exists(path):
                try:
                    return ImageFont.truetype(path, size)
                except OSError:
                    continue
    return ImageFont.load_default()


def assert_brand_icon() -> None:
    """确认用的是 VS2 绿色矢量导出，而不是旧的黄色位图主图。"""
    if not os.path.exists(ICON_SOURCE):
        raise SystemExit(
            f"缺少 {ICON_SOURCE}；先运行 npx electron scripts/brand-render.cjs"
        )
    with Image.open(ICON_SOURCE) as icon:
        rgba = icon.convert("RGBA")
        # 取样徽记实体区（左上圆角内）而不是抗锯齿边缘。
        sample = rgba.getpixel((rgba.width // 2, int(rgba.height * 0.08)))
    if sample[3] < 200:
        raise SystemExit(f"{ICON_SOURCE} 中心不是实心徽记（alpha={sample[3]}）")
    if not (sample[1] > sample[0] + 4 and sample[1] >= sample[2]):
        raise SystemExit(
            f"{ICON_SOURCE} 像素 {sample[:3]} 不是 VS2 绿色徽记；"
            "疑似旧的黄色位图导出，请重新运行 scripts/brand-render.cjs"
        )


def vertical_gradient(size: tuple[int, int], top: tuple[int, int, int], bottom: tuple[int, int, int]) -> Image.Image:
    """受限渐变：整幅高度只有很轻的明度变化，避免 dashboard 式重渐变。"""
    width, height = size
    image = Image.new("RGB", size, top)
    draw = ImageDraw.Draw(image)
    for y in range(height):
        ratio = y / max(height - 1, 1)
        color = tuple(round(top[i] + (bottom[i] - top[i]) * ratio) for i in range(3))
        draw.line([(0, y), (width, y)], fill=color)
    return image


def paste_mark(image: Image.Image, size: int, left: int, top: int) -> None:
    """把 VS2 矢量导出的徽记按需缩放合成，保证与产品图标同一套几何。"""
    mark = Image.open(MARK_SOURCE).convert("RGBA")
    if mark.size != (size, size):
        mark = mark.resize((size, size), Image.LANCZOS)
    image.paste(mark, (left, top), (mark.getchannel("A").point(lambda value: value)))


def build_header() -> Image.Image:
    """150 x 57 页眉：浅雾底 + 小徽记 + 字标，右侧留白给向导标题。"""
    width, height = 150, 57
    image = vertical_gradient((width, height), MIST_LIGHT, MIST).convert("RGB")
    draw = ImageDraw.Draw(image)
    draw.line([(0, height - 1), (width, height - 1)], fill=LINE)

    mark_size = 30
    paste_mark(image, mark_size, 12, (height - mark_size) // 2)
    wordmark = load_font("semibold", 17)
    caption = load_font("regular", 9)
    draw.text((52, 13), "YD", font=wordmark, fill=INK)
    draw.line([(52, 37), (74, 37)], fill=SAGE_SOFT, width=2)
    draw.text((79, 31), "Your Day", font=caption, fill=MUTED)
    return image


def build_sidebar() -> Image.Image:
    """164 x 314 侧幅：暖雾底 + 徽记 + 一条秩序线 + 两行小字。"""
    width, height = 164, 314
    image = vertical_gradient((width, height), MIST_LIGHT, MIST_DEEP).convert("RGB")
    draw = ImageDraw.Draw(image)
    draw.line([(width - 1, 0), (width - 1, height)], fill=LINE)

    mark_size = 56
    mark_x = (width - mark_size) // 2
    paste_mark(image, mark_size, mark_x, 72)
    wordmark = load_font("semibold", 20)
    caption = load_font("regular", 10)
    for text, font, top in (("YD", wordmark, 148), ("Your Day", caption, 176)):
        left, _, right, _ = draw.textbbox((0, 0), text, font=font)
        draw.text(((width - (right - left)) / 2 - left, top), text, font=font, fill=INK if font is wordmark else MUTED)

    line_width = 44
    draw.line(
        [((width - line_width) // 2, 205), ((width + line_width) // 2, 205)],
        fill=SAGE_SOFT,
        width=2,
    )

    footer = load_font("regular", 10)
    for text, top in (("quietly organized.", 224), ("day hub", 244)):
        left, _, right, _ = draw.textbbox((0, 0), text, font=footer)
        draw.text(((width - (right - left)) / 2 - left, top), text, font=footer, fill=MUTED)
    return image


def save_bmp(image: Image.Image, path: str) -> int:
    image.convert("RGB").save(path, "BMP")
    with open(path, "rb") as handle:
        header = handle.read(30)
    if header[:2] != b"BM":
        raise SystemExit(f"{path} 不是 BMP")
    bits = struct.unpack_from("<H", header, 28)[0]
    if bits != 24:
        raise SystemExit(f"{path} 位深为 {bits}，NSIS 需要 24 位")
    return os.path.getsize(path)


def main() -> int:
    assert_brand_icon()
    os.makedirs(OUT_DIR, exist_ok=True)
    header = build_header()
    sidebar = build_sidebar()
    assert header.size == (150, 57), header.size
    assert sidebar.size == (164, 314), sidebar.size
    header_bytes = save_bmp(header, os.path.join(OUT_DIR, "header.bmp"))
    sidebar_bytes = save_bmp(sidebar, os.path.join(OUT_DIR, "sidebar.bmp"))
    print(
        "安装向导品牌位图已生成：\n"
        f"  brand/installer/header.bmp  150x57  {header_bytes} bytes\n"
        f"  brand/installer/sidebar.bmp 164x314 {sidebar_bytes} bytes"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
