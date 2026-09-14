"""从定稿主图标导出 Windows 应用图标资源（PNG 多尺寸 + ICO）。

主图标定稿：``brand/source/app-icon-master-v3.png``
    —— 瓷白软方瓦片 + 灰/鼠尾草 YD 联结字标（自带 alpha 圆角与玻璃质感）。

## 关键约束

母版**必须自带 alpha**：瓦片之外是透明，四角是透明。

历史教训：0.2.21 用过一版完全不透明的浅雾白母版（alpha 全 255），Windows 会把
整块方画布都当成图标实体，浅白近白底在桌面 / 任务栏 / Alt+Tab 上表现为"白方块 +
白边"。因此脚本会先自检 alpha，不满足就直接报错，不会悄悄生成带白边的图标。

母版已经是最终设计（圆角、玻璃高光、投影都在画布内），导出只做等比缩放 +
可选的整体安全边距，不再重建形状。

托盘图标用的是单色字标，不在这里生成，见 ``scripts/brand-render.cjs``；
``scripts/prepare-visual-assets.py`` 仍负责界面侧的字标 PNG（含单色 / 白色 / 渐变）。

## 产物

    brand/exports/png/yd-<size>.png   16/20/24/32/40/48/64/128/256/512
    brand/exports/icon-256.png        窗口图标（构建时复制为 dist/icon.png）
    brand/exports/icon-512.png        商店 / 文档用大图
    brand/exports/yd.ico              多尺寸 ICO（桌面 / 任务栏 / 安装包 / 托盘）

托盘图标不在这里生成：托盘用的是单色字标，由 ``scripts/brand-render.cjs`` 输出。

运行：python scripts/export-app-icon.py
"""
from __future__ import annotations

import struct
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
MASTER = ROOT / "brand" / "source" / "app-icon-master-v3.png"
EXPORTS = ROOT / "brand" / "exports"
PNG_DIR = EXPORTS / "png"

SIZES = (16, 20, 24, 32, 40, 48, 64, 128, 256, 512)
ICO_SIZES = (16, 20, 24, 32, 40, 48, 64, 128, 256)

# 母版内容（不透明像素）占画布的比例下限：低于它说明图被裁得过小或导入错误。
# 当前定稿 v3 的实测值约 0.66（瓷片 + 玻璃投影共同构成内容区）。
MIN_CONTENT_FRACTION = 0.60
# 四角必须透明，否则又是"白方块"那一类问题。
MAX_CORNER_ALPHA = 8


def verify_master(master: Image.Image) -> Image.Image:
    """自检母版：必须有透明通道、四角透明、内容占比合理。"""
    icon = master.convert("RGBA")
    alpha = np.asarray(icon)[..., 3]
    corners = [int(alpha[0, 0]), int(alpha[0, -1]), int(alpha[-1, 0]), int(alpha[-1, -1])]
    if max(corners) > MAX_CORNER_ALPHA:
        raise SystemExit(f"母版四角不透明（{corners}）：会在 Windows 上渲染成白方块，请换用带透明圆角的版本")
    content = float((alpha > 10).mean())
    if content < MIN_CONTENT_FRACTION:
        raise SystemExit(f"母版内容只占画布 {content:.2f}，图标会显得偏小；请检查裁切")
    return icon


def frame_for(icon: Image.Image, size: int) -> Image.Image:
    return icon.resize((size, size), Image.LANCZOS)


def save_bmp_icon(frames: dict[int, Image.Image], target: Path) -> None:
    """写出多尺寸 ICO。Vista 之后的 ICO 允许直接内嵌 PNG，避免二次重采样。"""
    blobs: list[tuple[int, bytes]] = []
    for size in ICO_SIZES:
        buffer = _png_bytes(frames[size])
        blobs.append((size, buffer))

    header = struct.pack("<HHH", 0, 1, len(blobs))
    offset = 6 + 16 * len(blobs)
    directory = bytearray()
    for size, blob in blobs:
        directory += struct.pack(
            "<BBBBHHII",
            0 if size >= 256 else size,
            0 if size >= 256 else size,
            0,
            0,
            1,
            32,
            len(blob),
            offset,
        )
        offset += len(blob)
    target.write_bytes(header + bytes(directory) + b"".join(blob for _, blob in blobs))


def _png_bytes(image: Image.Image) -> bytes:
    import io

    buffer = io.BytesIO()
    image.save(buffer, "PNG", optimize=True)
    return buffer.getvalue()


def main() -> int:
    if not MASTER.exists():
        raise SystemExit(f"缺少主图标定稿：{MASTER}")

    master = Image.open(MASTER)
    print(f"主图标定稿：{MASTER.name} {master.mode} {master.size}")
    icon = verify_master(master)
    print(f"母版自检：四角透明、内容占比 {float((np.asarray(icon)[..., 3] > 10).mean()):.3f}")

    PNG_DIR.mkdir(parents=True, exist_ok=True)
    frames: dict[int, Image.Image] = {}
    for size in SIZES:
        frame = frame_for(icon, size)
        frames[size] = frame
        frame.save(PNG_DIR / f"yd-{size}.png", optimize=True)

    frames[256].save(EXPORTS / "icon-256.png", optimize=True)
    frames[512].save(EXPORTS / "icon-512.png", optimize=True)
    save_bmp_icon(frames, EXPORTS / "yd.ico")

    # 自检：四角必须透明；小尺寸边缘不得出现"亮白框"。
    problems: list[str] = []
    for size in (16, 24, 32, 128, 256):
        alpha = np.asarray(frames[size])[..., 3]
        corners = [alpha[0, 0], alpha[0, -1], alpha[-1, 0], alpha[-1, -1]]
        if max(corners) > 8:
            problems.append(f"{size}px 四角未透明：{corners}")
        lit = np.asarray(frames[size])[..., :3].astype(int).mean(axis=2)
        band = np.zeros(alpha.shape, bool)
        band[:1, :] = band[-1:, :] = True
        band[:, :1] = band[:, -1:] = True
        leak = int(((alpha > 200) & (lit > 236) & band).sum())
        if size <= 64 and leak > size:
            problems.append(f"{size}px 边缘疑似露出浅色垫底：{leak} px")

    print(f"导出 {len(SIZES)} 个 PNG + ICO（{len(ICO_SIZES)} 层，含 20/40 供 125% DPI）")
    if problems:
        print("自检未通过：")
        for item in problems:
            print("  -", item)
        return 1
    print("自检通过：四角透明，小尺寸无亮白边缘")
    return 0


if __name__ == "__main__":
    sys.exit(main())
