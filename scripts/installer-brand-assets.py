"""从用户确认的安装器品牌素材生成 NSIS 助手式向导位图（header / sidebar）。

素材 → 用途（用户已指定，脚本不做二次设计）：

    Asset 01  brand/source/installer-header-master.png
              → brand/installer/header.bmp   150 x 57   页眉横幅（所有带页眉的向导页）
    Asset 02  brand/source/installer-sidebar-master.png
              → brand/installer/sidebar.bmp  164 x 314  Welcome / Finish 左侧竖幅

只做 crop + scale（保持宽高比），不拉伸、不重绘、不重新排版。
源图原样保存在 brand/source，本脚本只产出 build-ready 的 24 位 BMP。

尺寸来自当前工具链的真实规格，见：
  * node_modules/app-builder-lib/out/targets/nsis/NsisTarget.js
      nsis.installerHeader  → MUI_HEADERIMAGE_BITMAP       (150 x 57)
      nsis.installerSidebar → MUI_WELCOMEFINISHPAGE_BITMAP (164 x 314)
  * NSIS MUI2：向导位图不支持 alpha，必须是 24 位未压缩 BMP，
    带透明通道会被渲染成黑块（脚本会校验位深）。

运行：python scripts/installer-brand-assets.py
"""
from __future__ import annotations

import os
import struct
import sys

import numpy as np
from PIL import Image, ImageFilter

import brand_paths as bp

# MUI2 的向导位图固定尺寸（100% DPI 下的真实规格）。
HEADER_SIZE = (150, 57)
SIDEBAR_SIZE = (164, 314)

# 内容判定：低于该亮度的像素算"画面内容"（母版底色是 246–252 的雾白）。
CONTENT_LUMA = 232
# 页眉内边距（目标位图像素），保证缩到 150x57 后仍有呼吸感。
HEADER_PAD = 3


def load_master(path) -> Image.Image:
    if not path.exists():
        raise SystemExit(f"缺少安装器品牌素材：{path}")
    return Image.open(path).convert("RGB")


def content_box(image: Image.Image) -> tuple[int, int, int, int]:
    """画面内容（字标 / 文字）的外接矩形。"""
    luma = np.asarray(image.convert("L")).astype(int)
    mask = luma < CONTENT_LUMA
    ys, xs = np.where(mask)
    if not len(xs):
        raise SystemExit("素材中找不到可识别的内容，请检查输入文件")
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def background_patch(image: Image.Image) -> Image.Image:
    """从母版的空白区取一小块底色，用于补足页眉条两侧的留白。

    母版底色是非常轻的冷调渐变；直接填纯色会在内容边缘留下一条可见的接缝。
    """
    width, height = image.size
    return image.crop((0, int(height * 0.30), max(1, width // 10), int(height * 0.70)))


def fit(image: Image.Image, box: tuple[int, int, int, int], size: tuple[int, int], pad: int) -> Image.Image:
    """等比缩放到目标尺寸内部（contain），不做任何拉伸。"""
    crop = image.crop(box)
    scale = min((size[0] - pad * 2) / crop.width, (size[1] - pad * 2) / crop.height)
    return crop.resize((max(1, round(crop.width * scale)), max(1, round(crop.height * scale))), Image.LANCZOS)


def aspect_crop(image: Image.Image, center: tuple[float, float], aspect: float) -> tuple[int, int, int, int]:
    """以给定中心取一块比例等于目标位图的窗口（crop，不是 stretch）。"""
    width, height = image.size
    crop_height = min(height, max(1, round(min(width / aspect, height))))
    crop_width = max(1, min(width, round(crop_height * aspect)))
    if crop_width > width:
        crop_width = width
        crop_height = max(1, round(crop_width / aspect))
    left = min(max(0, round(center[0] - crop_width / 2)), width - crop_width)
    top = min(max(0, round(center[1] - crop_height / 2)), height - crop_height)
    return left, top, left + crop_width, top + crop_height


def build_header(master: Image.Image) -> Image.Image:
    """150 x 57：Asset 01 的横向品牌构图等比缩到页眉条内，留白取自素材本身。"""
    content = fit(master, content_box(master), HEADER_SIZE, HEADER_PAD)
    canvas = background_patch(master).resize(HEADER_SIZE, Image.LANCZOS).filter(ImageFilter.GaussianBlur(1.4))
    canvas.paste(content, ((HEADER_SIZE[0] - content.width) // 2, (HEADER_SIZE[1] - content.height) // 2))
    return canvas


def build_sidebar(master: Image.Image) -> Image.Image:
    """164 x 314：Asset 02 的纵向构图按目标比例裁切后等比缩放。"""
    box = content_box(master)
    center = ((box[0] + box[2]) / 2, (box[1] + box[3]) / 2)
    return master.crop(aspect_crop(master, center, SIDEBAR_SIZE[0] / SIDEBAR_SIZE[1])).resize(SIDEBAR_SIZE, Image.LANCZOS)


def save_bmp(image: Image.Image, size: tuple[int, int], path) -> int:
    if image.size != size:
        raise SystemExit(f"{path} 尺寸为 {image.size}，期望 {size}")
    image.convert("RGB").save(path, "BMP")
    with open(path, "rb") as handle:
        header = handle.read(30)
    if header[:2] != b"BM":
        raise SystemExit(f"{path} 不是 BMP")
    bits = struct.unpack_from("<H", header, 28)[0]
    if bits != 24:
        raise SystemExit(f"{path} 位深为 {bits}，NSIS 需要 24 位")
    return os.path.getsize(path)


def write_preview(header: Image.Image, sidebar: Image.Image) -> None:
    """人工目检用：页眉条 + 竖幅在助手式向导里的落地形态（2x 最近邻放大）。"""
    scale = 2
    width = HEADER_SIZE[0] * scale + SIDEBAR_SIZE[0] * scale + 60
    height = max(HEADER_SIZE[1], SIDEBAR_SIZE[1]) * scale + 40
    sheet = Image.new("RGB", (width, height), (241, 243, 240))
    sheet.paste(header.resize((HEADER_SIZE[0] * scale, HEADER_SIZE[1] * scale), Image.NEAREST), (20, 20))
    sheet.paste(sidebar.resize((SIDEBAR_SIZE[0] * scale, SIDEBAR_SIZE[1] * scale), Image.NEAREST), (HEADER_SIZE[0] * scale + 40, 20))
    bp.EXPLORE.mkdir(parents=True, exist_ok=True)
    sheet.save(bp.EXPLORE / "installer-branding.png")


def main() -> int:
    header_master = load_master(bp.INSTALLER_HEADER_MASTER)
    sidebar_master = load_master(bp.INSTALLER_SIDEBAR_MASTER)
    header = build_header(header_master)
    sidebar = build_sidebar(sidebar_master)

    bp.INSTALLER.mkdir(parents=True, exist_ok=True)
    header_bytes = save_bmp(header, HEADER_SIZE, bp.INSTALLER_HEADER)
    sidebar_bytes = save_bmp(sidebar, SIDEBAR_SIZE, bp.INSTALLER_SIDEBAR)
    write_preview(header, sidebar)
    print(
        "安装器品牌位图已生成（crop + scale，无拉伸）：\n"
        f"  {bp.INSTALLER_HEADER.relative_to(bp.ROOT)}  {HEADER_SIZE[0]}x{HEADER_SIZE[1]}  {header_bytes} bytes  ← {bp.INSTALLER_HEADER_MASTER.name}\n"
        f"  {bp.INSTALLER_SIDEBAR.relative_to(bp.ROOT)} {SIDEBAR_SIZE[0]}x{SIDEBAR_SIZE[1]} {sidebar_bytes} bytes  ← {bp.INSTALLER_SIDEBAR_MASTER.name}\n"
        "  目检图 brand/explore/installer-branding.png"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
