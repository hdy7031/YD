"""为 NSIS 助手式安装向导生成品牌位图（header / sidebar）。

风格：暖雾白底 + 深灰青 YD 字标 + 鼠尾草细线，安静、克制、留白。
与程序图标、托盘、界面标题栏同属一套视觉，不使用旧版金 / 绿素材。

输出（24 位未压缩 BMP，NSIS 2 不支持 alpha，带 alpha 会渲染成黑块）：

    brand/installer/header.bmp   150 x 57   页眉条
    brand/installer/sidebar.bmp  164 x 314  左侧竖幅

字标来自品牌资源单一来源：``brand/exports/png/yd-mono-128.png``（单色深灰青），
由 ``scripts/brand-render.cjs`` 从 ``brand/source/yd-logo-mist-master.png`` 生成。
安装器图标（installerIcon / uninstallerIcon）与程序图标共用 ``brand/exports/yd.ico``，
配置见 package.json 的 nsis 段。

运行：python scripts/installer-brand-assets.py
"""
from __future__ import annotations

import os
import struct
import sys

from PIL import Image, ImageDraw, ImageFont

import brand_paths as bp

FONT_CANDIDATES = {
    "regular": ["segoeui.ttf", "SegUIVar.ttf", "arial.ttf"],
    "semibold": ["seguisb.ttf", "SegUIVar.ttf", "segoeuib.ttf", "arialbd.ttf"],
}


def load_font(style: str, size: int) -> ImageFont.FreeTypeFont:
    for name in FONT_CANDIDATES[style]:
        path = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts", name)
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def verify_mark() -> Image.Image:
    """字标必须存在、带 alpha、且是单色深灰青（防止误用旧的金 / 绿素材）。"""
    if not bp.TRAY_MONO_128.exists():
        raise SystemExit(
            f"缺少字标 {bp.TRAY_MONO_128}；先运行 npx electron scripts/brand-render.cjs"
        )
    mark = Image.open(bp.TRAY_MONO_128).convert("RGBA")
    alpha = mark.getchannel("A")
    if alpha.getextrema()[1] < 200:
        raise SystemExit(f"{bp.TRAY_MONO_128} 没有可用 alpha，无法用于品牌图")
    return mark


def vertical_gradient(size: tuple[int, int], top, bottom) -> Image.Image:
    """很轻的明度渐变，避免 dashboard 式的重渐变。"""
    width, height = size
    image = Image.new("RGB", size, top)
    draw = ImageDraw.Draw(image)
    for y in range(height):
        ratio = y / max(height - 1, 1)
        draw.line(
            [(0, y), (width, y)],
            fill=tuple(round(top[i] + (bottom[i] - top[i]) * ratio) for i in range(3)),
        )
    return image


def paste_mark(image: Image.Image, mark: Image.Image, size: int, left: int, top: int) -> None:
    scaled = mark.resize((size, size), Image.LANCZOS) if mark.size != (size, size) else mark
    image.paste(scaled, (left, top), scaled)


def centered_text(draw: ImageDraw.ImageDraw, text: str, font, top: int, width: int, fill) -> None:
    left, _, right, _ = draw.textbbox((0, 0), text, font=font)
    draw.text(((width - (right - left)) / 2 - left, top), text, font=font, fill=fill)


def build_header(mark: Image.Image) -> Image.Image:
    """150 x 57：左侧字标 + YD / Your Day，右侧留白给向导标题。"""
    width, height = 150, 57
    image = vertical_gradient((width, height), bp.MIST_LIGHT, bp.MIST)
    draw = ImageDraw.Draw(image)
    draw.line([(0, height - 1), (width, height - 1)], fill=bp.LINE)

    paste_mark(image, mark, 30, 14, (height - 30) // 2)
    draw = ImageDraw.Draw(image)
    wordmark = load_font("semibold", 17)
    caption = load_font("regular", 9)
    draw.text((52, 13), "YD", font=wordmark, fill=bp.MONO_INK)
    draw.line([(52, 37), (74, 37)], fill=bp.SAGE, width=2)
    draw.text((79, 31), "Your Day", font=caption, fill=bp.MUTED)
    return image


def build_sidebar(mark: Image.Image) -> Image.Image:
    """164 x 314：字标 + YD + Your Day + 秩序线 + tagline。"""
    width, height = 164, 314
    image = vertical_gradient((width, height), bp.MIST_LIGHT, bp.MIST)
    draw = ImageDraw.Draw(image)
    draw.line([(width - 1, 0), (width - 1, height)], fill=bp.LINE)

    paste_mark(image, mark, 56, (width - 56) // 2, 72)
    draw = ImageDraw.Draw(image)
    wordmark = load_font("semibold", 20)
    caption = load_font("regular", 10)
    footer = load_font("regular", 10)
    centered_text(draw, "YD", wordmark, 146, width, bp.MONO_INK)
    centered_text(draw, "Your Day", caption, 176, width, bp.MUTED)
    draw.line([((width - 44) // 2, 205), ((width + 44) // 2, 205)], fill=bp.SAGE, width=2)
    centered_text(draw, "your day, quietly organized.", footer, 224, width, bp.MUTED)
    return image


def save_bmp(image: Image.Image, path) -> int:
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
    mark = verify_mark()
    bp.INSTALLER.mkdir(parents=True, exist_ok=True)
    header = build_header(mark)
    sidebar = build_sidebar(mark)
    assert header.size == (150, 57), header.size
    assert sidebar.size == (164, 314), sidebar.size
    header_bytes = save_bmp(header, bp.INSTALLER_HEADER)
    sidebar_bytes = save_bmp(sidebar, bp.INSTALLER_SIDEBAR)
    print(
        "安装器品牌位图已生成：\n"
        f"  {bp.INSTALLER_HEADER.relative_to(bp.ROOT)}  150x57  {header_bytes} bytes\n"
        f"  {bp.INSTALLER_SIDEBAR.relative_to(bp.ROOT)} 164x314 {sidebar_bytes} bytes\n"
        "  字标来源：brand/exports/png/yd-mono-128.png（单色深灰青）"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
