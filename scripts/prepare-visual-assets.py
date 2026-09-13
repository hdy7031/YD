"""Prepare the user supplied YD mark for UI, Windows icon and tray use.

This script only cleans, crops and exports the supplied artwork. It does not
redraw the YD geometry. The largest connected alpha component is retained so
isolated extraction specks do not become part of the production mark.
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "brand" / "source" / "yd-logo-reference.png"
MASTER = ROOT / "brand" / "source" / "yd-logo-mist-master.png"
MONO = ROOT / "src" / "ui" / "assets" / "gen" / "yd-logo-mono.png"
MONO_WHITE = ROOT / "src" / "ui" / "assets" / "gen" / "yd-logo-mono-white.png"
UI_MARK = ROOT / "src" / "ui" / "assets" / "gen" / "yd-logo-gradient.png"
APP_MASTER = ROOT / "brand" / "source" / "yd-app-icon-mist-master.png"
OUT = ROOT / "brand" / "exports"
OUT_PNG = OUT / "png"


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


def app_tile(mark: Image.Image) -> Image.Image:
    size = 1024
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    tile = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(tile)
    draw.rounded_rectangle((36, 36, size - 36, size - 36), radius=218, fill="#F3F6F7", outline="#D6E1E1", width=4)
    canvas.alpha_composite(tile)
    fitted = mark.copy()
    fitted.thumbnail((758, 758), Image.Resampling.LANCZOS)
    canvas.alpha_composite(fitted, ((size - fitted.width) // 2, (size - fitted.height) // 2 + 8))
    return canvas


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

    icon = app_tile(mark)
    icon.save(APP_MASTER)
    for size in (16, 20, 24, 32, 40, 48, 64, 128, 256, 512):
        icon.resize((size, size), Image.Resampling.LANCZOS).save(OUT_PNG / f"yd-{size}.png", optimize=True)
    icon.resize((512, 512), Image.Resampling.LANCZOS).save(OUT / "icon-512.png", optimize=True)
    icon.resize((256, 256), Image.Resampling.LANCZOS).save(OUT / "icon-256.png", optimize=True)
    mono.resize((32, 32), Image.Resampling.LANCZOS).save(OUT / "tray-32.png", optimize=True)
    for size in (16, 24, 32):
        mono.resize((size, size), Image.Resampling.LANCZOS).save(OUT_PNG / f"tray-{size}.png", optimize=True)
        white.resize((size, size), Image.Resampling.LANCZOS).save(OUT_PNG / f"tray-white-{size}.png", optimize=True)
    icon.save(OUT / "yd.ico", sizes=[(16, 16), (20, 20), (24, 24), (32, 32), (40, 40), (48, 48), (64, 64), (128, 128), (256, 256)])


if __name__ == "__main__":
    main()
