"""从定稿主图标导出 Windows 应用图标资源（PNG 多尺寸 + ICO）。

主图标定稿：``brand/source/app-icon-master-v2.png``
    —— 瓷白软方瓦片 + 灰/鼠尾草 YD 联结字标。

## 为什么需要这个脚本

主图标是**完全不透明**的 RGB 位图：瓦片之外还有一圈浅灰绿垫底与右下方向的柔和
投影。如果直接把整张画布缩放成图标，Windows 会把整块方形都当成图标实体，浅白
近白底在桌面 / 任务栏 / Alt+Tab 上就表现为一枚"白方块 + 白边"（0.2.21 的实际
表现）。

因此导出时必须按瓦片的真实几何重建 alpha 通道：

* 瓦片占画布 88%（母版实测值），圆角半径约为瓦片边长的 27%；
* 圆角遮罩用 4 倍超采样后降采样，边缘抗锯齿但不发虚；
* 32px 及以上保留母版投影（右下淡影）以获得立体感；
* 24px 及以下只保留硬边圆角 —— 小尺寸下投影会糊成灰框，反而制造"脏边"。

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
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
MASTER = ROOT / "brand" / "source" / "app-icon-master-v2.png"
EXPORTS = ROOT / "brand" / "exports"
PNG_DIR = EXPORTS / "png"

SIZES = (16, 20, 24, 32, 40, 48, 64, 128, 256, 512)
ICO_SIZES = (16, 20, 24, 32, 40, 48, 64, 128, 256)

# 母版实测几何：瓦片占画布 88%，圆角约为瓦片边长 27%。
TILE_FRACTION = 0.88
RADIUS_FRACTION = 0.27
SHADOW_MAX_SIZE = 24  # 该尺寸及以下不保留投影


def build_icon(master: Image.Image, with_shadow: bool) -> Image.Image:
    """按瓦片真实几何裁出圆角图标，可选保留母版投影。"""
    canvas = master.convert("RGB")
    side = round(canvas.width * TILE_FRACTION)
    left = (canvas.width - side) // 2
    top = (canvas.height - side) // 2
    tile = canvas.crop((left, top, left + side, top + side))
    radius = round(side * RADIUS_FRACTION)

    supersample = 4
    mask = Image.new("L", (side * supersample, side * supersample), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, side * supersample - 1, side * supersample - 1],
        radius=radius * supersample,
        fill=255,
    )
    hard = mask.resize((side, side), Image.LANCZOS)

    if with_shadow:
        shadow = Image.new("L", (side, side), 0)
        shadow.paste(hard, (round(side * 0.008), round(side * 0.012)))
        shadow = shadow.filter(ImageFilter.GaussianBlur(round(side * 0.016)))
        alpha = Image.fromarray(np.maximum(np.asarray(shadow), np.asarray(hard)).astype("uint8"))
    else:
        alpha = hard

    icon = tile.convert("RGBA")
    icon.putalpha(alpha)
    return icon


def frame_for(icon_shadow: Image.Image, icon_flat: Image.Image, size: int) -> Image.Image:
    source = icon_flat if size <= SHADOW_MAX_SIZE else icon_shadow
    return source.resize((size, size), Image.LANCZOS)


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
    icon_shadow = build_icon(master, with_shadow=True)
    icon_flat = build_icon(master, with_shadow=False)

    PNG_DIR.mkdir(parents=True, exist_ok=True)
    frames: dict[int, Image.Image] = {}
    for size in SIZES:
        frame = frame_for(icon_shadow, icon_flat, size)
        frames[size] = frame
        frame.save(PNG_DIR / f"yd-{size}.png", optimize=True)
        frames[size] = frame

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
