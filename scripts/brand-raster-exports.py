"""从定稿的位图母版导出品牌图标资源。

主图标母版：brand/source/yd-app-icon-master.png（金底 squircle + 近白 YD 合体字标）
托盘字标：  src/ui/assets/gen/03-tray-mark.png（只取字标、深金、透明底）

两块素材在母版里都留了大量透明边距。Windows 任务栏 / 托盘按“整张画布”排布图标，
留白会让 YD 明显比相邻应用小一圈，所以导出前统一裁到内容外接框、只补一点点安全边距：

- 主图标：内容占画布 ≈ 92%（任务栏、桌面快捷方式、安装包、开始菜单）
- 托盘字标：内容占画布 ≈ 94%（右下角小标，16/24/32 三档都需要更满）

导出的文件被这些地方使用：
- brand/exports/yd.ico        electron-builder 的安装包/可执行文件图标（多尺寸）
- brand/exports/icon-256.png  构建时复制成 dist/icon.png（窗口图标）
- brand/exports/icon-512.png  商店/文档用大图
- brand/exports/tray-32.png   构建时复制成 dist/tray.png（系统托盘）

运行：python scripts/brand-raster-exports.py
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
MASTER = ROOT / "brand" / "source" / "yd-app-icon-master.png"
TRAY_MARK = ROOT / "src" / "ui" / "assets" / "gen" / "03-tray-mark.png"
OUT = ROOT / "brand" / "exports"
OUT_PNG = OUT / "png"

# 透明安全边距占内容边长的比例：0.045 → 内容约占画布 92%，0.03 → 约 94%。
ICON_PADDING_RATIO = 0.045
TRAY_PADDING_RATIO = 0.03
# 素材边缘常带一圈 alpha 只有个位数的柔光：它会把“内容外接框”撑大好几圈，
# 让图标看起来又变小，所以取外接框时先按阈值忽略这层柔光。
ALPHA_FLOOR = 24


def resize_square(image: Image.Image, size: int) -> Image.Image:
    return image.resize((size, size), Image.LANCZOS)


def cropped_to_content(image: Image.Image, padding_ratio: float = 0.06) -> Image.Image:
    """裁到不透明内容的外接框，再按比例补一点留白，避免小图标里字标过小。"""
    solid = image.getchannel("A").point(lambda value: 255 if value >= ALPHA_FLOOR else 0)
    bbox = solid.getbbox()
    if not bbox:
        return image
    left, top, right, bottom = bbox
    side = max(right - left, bottom - top)
    pad = int(round(side * padding_ratio))
    side += pad * 2
    cx, cy = (left + right) / 2, (top + bottom) / 2
    box = (int(cx - side / 2), int(cy - side / 2), int(cx + side / 2), int(cy + side / 2))
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.alpha_composite(image.convert("RGBA"), (-box[0], -box[1]))
    return canvas


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    OUT_PNG.mkdir(parents=True, exist_ok=True)

    master = cropped_to_content(Image.open(MASTER).convert("RGBA"), ICON_PADDING_RATIO)
    tray = cropped_to_content(Image.open(TRAY_MARK).convert("RGBA"), TRAY_PADDING_RATIO)

    for size in (16, 20, 24, 32, 40, 48, 64, 128, 256, 512):
        resize_square(master, size).save(OUT_PNG / f"yd-{size}.png")
    resize_square(master, 512).save(OUT / "icon-512.png")
    resize_square(master, 256).save(OUT / "icon-256.png")
    resize_square(tray, 32).save(OUT / "tray-32.png")
    resize_square(tray, 16).save(OUT_PNG / "tray-16.png")
    resize_square(tray, 24).save(OUT_PNG / "tray-24.png")

    # Windows .ico：按从大到小写入，系统会按 DPI 选取最接近的一档。
    resize_square(master, 256).save(
        OUT / "yd.ico",
        sizes=[(16, 16), (20, 20), (24, 24), (32, 32), (40, 40), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    print("brand exports updated:", ", ".join(sorted(p.name for p in OUT.glob("*.png")) + ["yd.ico"]))


if __name__ == "__main__":
    main()
