"""从定稿的 YD App Icon 母版导出 Windows 应用图标资源（PNG 多尺寸 + 单一 ICO）。

两个母版属于同一套品牌图标体系，按尺寸分工（用户已指定）：

    Asset 05  brand/source/app-icon-master-v4.png
              → 64 / 128 / 256 / 512（完整细节）
    Asset 08  brand/source/app-icon-small-master-v4.png
              → 16 / 20 / 24 / 32 / 40 / 48（小尺寸光学变体，主体更饱满）

合成结果只有 **一个** `brand/exports/yd.ico`（九层，含 20/40 供 125% DPI），
供 YD.exe / BrowserWindow / 任务栏 / Alt+Tab / 开始菜单 / 桌面快捷方式 /
安装器 / 卸载器共用；不存在第二套 competing app icon。

## 关键约束（白边回归防线）

母版必须自带 alpha：瓦片之外透明、四角透明。历史上 0.2.21 用过不透明浅雾白
母版，Windows 把整块方画布当成图标实体，桌面 / 任务栏 / Alt+Tab 上表现为
"白方块 + 白边"。因此脚本在导出前后都会自检，不通过就直接失败：

  * 四角 alpha 必须为 0；
  * 内容占比必须落在合理区间（母版裁切正确）；
  * 小尺寸 frame 的四角透明、且边缘不得出现"亮白框"。

运行：python scripts/prepare-app-icon.py
"""
from __future__ import annotations

import io
import struct
import sys

import numpy as np
from PIL import Image

import brand_paths as bp

SIZES = (16, 20, 24, 32, 40, 48, 64, 128, 256, 512)
ICO_SIZES = (16, 20, 24, 32, 40, 48, 64, 128, 256)
# 小尺寸 frame（Asset 08）与大尺寸 frame（Asset 05）的分界。
SMALL_MAX = 48

# 母版内容（不透明像素）占画布比例的下限：低于它说明图被裁得过小或导入错误。
# 实测：v4 大图标约 0.58、小尺寸变体约 0.65（后者的主体本来就故意更饱满）。
MIN_CONTENT_FRACTION = 0.55
# 四角必须透明，否则又是"白方块"那一类问题。
MAX_CORNER_ALPHA = 8


def load_master(path, label: str) -> Image.Image:
    if not path.exists():
        raise SystemExit(f"缺少{label}定稿母版：{path}")
    master = Image.open(path).convert("RGBA")
    alpha = np.asarray(master)[..., 3]
    corners = [int(alpha[0, 0]), int(alpha[0, -1]), int(alpha[-1, 0]), int(alpha[-1, -1])]
    if max(corners) > MAX_CORNER_ALPHA:
        raise SystemExit(f"{label}四角不透明（{corners}）：会在 Windows 上渲染成白方块，请换用带透明圆角的版本")
    fraction = float((alpha > 10).mean())
    if fraction < MIN_CONTENT_FRACTION:
        raise SystemExit(f"{label}内容只占画布 {fraction:.2f}，图标会显得偏小；请检查裁切")
    print(f"{label}：{path.name} {master.size} 内容占比 {fraction:.3f}")
    return master


def frame_for(master: Image.Image, size: int) -> Image.Image:
    return master.resize((size, size), Image.LANCZOS)


def _png_bytes(image: Image.Image) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, "PNG", optimize=True)
    return buffer.getvalue()


def save_ico(frames: dict[int, Image.Image], target) -> None:
    """写出多尺寸 ICO。Vista 之后的 ICO 允许直接内嵌 PNG，避免二次重采样。"""
    blobs = [(size, _png_bytes(frames[size])) for size in ICO_SIZES]
    header = struct.pack("<HHH", 0, 1, len(blobs))
    offset = 6 + 16 * len(blobs)
    directory = bytearray()
    for size, blob in blobs:
        directory += struct.pack("<BBBBHHII", 0 if size >= 256 else size, 0 if size >= 256 else size, 0, 0, 1, 32, len(blob), offset)
        offset += len(blob)
    target.write_bytes(header + bytes(directory) + b"".join(blob for _, blob in blobs))


def inspect_ico(target) -> list[int]:
    """读回 ICO 目录：层数与尺寸必须与 ICO_SIZES 一致。"""
    data = target.read_bytes()
    reserved, kind, count = struct.unpack_from("<HHH", data, 0)
    if reserved != 0 or kind != 1:
        raise SystemExit(f"{target} 不是 ICO 文件")
    sizes = []
    for index in range(count):
        width = data[6 + index * 16]
        sizes.append(256 if width == 0 else width)
    return sizes


def frame_problems(frame: Image.Image, size: int) -> list[str]:
    problems: list[str] = []
    array = np.asarray(frame)
    alpha = array[..., 3]
    corners = [int(alpha[0, 0]), int(alpha[0, -1]), int(alpha[-1, 0]), int(alpha[-1, -1])]
    if max(corners) > MAX_CORNER_ALPHA:
        problems.append(f"{size}px 四角未透明：{corners}")
    lit = array[..., :3].astype(int).mean(axis=2)
    band = np.zeros(alpha.shape, bool)
    band[:1, :] = band[-1:, :] = True
    band[:, :1] = band[:, -1:] = True
    leak = int(((alpha > 200) & (lit > 236) & band).sum())
    if size <= 64 and leak > size:
        problems.append(f"{size}px 边缘疑似露出浅色垫底：{leak} px")
    return problems


def main() -> int:
    large = load_master(bp.APP_ICON_MASTER, "App Icon 母版")
    small = load_master(bp.APP_ICON_SMALL_MASTER, "小尺寸光学变体")

    bp.EXPORT_PNG.mkdir(parents=True, exist_ok=True)
    frames: dict[int, Image.Image] = {}
    source_of: dict[int, str] = {}
    for size in SIZES:
        master = small if size <= SMALL_MAX else large
        source_of[size] = "Asset 08" if size <= SMALL_MAX else "Asset 05"
        frames[size] = frame_for(master, size)
        frames[size].save(bp.EXPORT_PNG / f"yd-{size}.png", optimize=True)

    frames[256].save(bp.APP_ICON_PNG, optimize=True)
    frames[512].save(bp.APP_ICON_PNG_LARGE, optimize=True)
    save_ico(frames, bp.APP_ICON)

    problems: list[str] = []
    for size in (16, 24, 32, 128, 256):
        problems += frame_problems(frames[size], size)
    ico_sizes = inspect_ico(bp.APP_ICON)
    if ico_sizes != list(ICO_SIZES):
        problems.append(f"ICO 层与预期不一致：{ico_sizes}")

    print(f"导出 {len(SIZES)} 个 PNG + 单一 ICO（{len(ICO_SIZES)} 层）")
    print("  frame 来源：" + "、".join(f"{size}px←{source_of[size]}" for size in ICO_SIZES))
    if problems:
        print("自检未通过：")
        for item in problems:
            print("  -", item)
        return 1
    print("自检通过：四角透明，小尺寸无亮白边缘，ICO 层完整")
    return 0


if __name__ == "__main__":
    sys.exit(main())
