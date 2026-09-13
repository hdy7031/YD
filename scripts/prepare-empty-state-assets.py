"""Prepare the user-supplied YD Visual Family artwork for the app.

The source PNGs are retained under brand/source. Runtime copies only remove
near-transparent/chroma-key edge specks and resize with the alpha channel intact.
"""

from pathlib import Path
from shutil import copy2

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "brand" / "source"
RUNTIME = ROOT / "src" / "ui" / "assets" / "gen"

INPUTS = {
    # The semantic mapping follows the artwork itself: inbox tray, calendar and
    # bell are routed to their matching product surfaces rather than relying on
    # clipboard order.
    "empty-home-day": Path(r"C:\Users\hdy\AppData\Local\Temp\codex-clipboard-cb67f1d4-bbe3-4015-b2ca-45a3c6731a1b.png"),
    "empty-inbox-selection": Path(r"C:\Users\hdy\AppData\Local\Temp\codex-clipboard-5e87a965-7ef9-4e9d-b29a-a54aa2ee062a.png"),
    "empty-companion-day": Path(r"C:\Users\hdy\AppData\Local\Temp\codex-clipboard-7c2e8553-83d1-4180-af16-e13505fac19b.png"),
    "empty-reminders": Path(r"C:\Users\hdy\AppData\Local\Temp\codex-clipboard-010fbdb3-9e02-48a2-8369-7b1e877c37d2.png"),
    "hero-whisper": Path(r"C:\Users\hdy\AppData\Local\Temp\codex-clipboard-a79d8559-7826-4a6e-807b-d6090f97d88a.png"),
    "about-brand-whisper": Path(r"C:\Users\hdy\AppData\Local\Temp\codex-clipboard-7271ccf8-f8d9-439c-9c61-61e83a9c8cce.png"),
    "app-icon-master": Path(r"C:\Users\hdy\AppData\Local\Temp\codex-clipboard-9fe3e893-9fa9-4f1d-9fdf-f0f494aa34a7.png"),
}


def clean_alpha(image: Image.Image) -> Image.Image:
    rgba = np.asarray(image.convert("RGBA")).copy()
    rgb = rgba[..., :3].astype(np.int16)
    alpha = rgba[..., 3]

    # Remove invisible crumbs and the occasional bright green/magenta fringe
    # left by transparent-background generation. Muted sage artwork is retained.
    alpha[alpha < 9] = 0
    green_fringe = (alpha < 210) & (rgb[..., 1] > 150) & (rgb[..., 1] - rgb[..., 0] > 48) & (rgb[..., 1] - rgb[..., 2] > 38)
    magenta_fringe = (alpha < 210) & (rgb[..., 0] > 150) & (rgb[..., 2] > 130) & (rgb[..., 0] - rgb[..., 1] > 48)
    alpha[green_fringe | magenta_fringe] = 0
    rgba[..., 3] = alpha
    return Image.fromarray(rgba, "RGBA")


def crop_subject(image: Image.Image) -> Image.Image:
    alpha = image.getchannel("A")
    box = alpha.getbbox()
    if not box:
        return image
    left, top, right, bottom = box
    pad = max(right - left, bottom - top) // 24
    left, top = max(0, left - pad), max(0, top - pad)
    right, bottom = min(image.width, right + pad), min(image.height, bottom + pad)
    cropped = image.crop((left, top, right, bottom))
    side = max(cropped.size)
    canvas = Image.new("RGBA", (side, side))
    canvas.alpha_composite(cropped, ((side - cropped.width) // 2, (side - cropped.height) // 2))
    return canvas


def save_scaled(image: Image.Image, path: Path, size: tuple[int, int]) -> None:
    resized = image.resize(size, Image.Resampling.LANCZOS)
    resized.save(path, optimize=True, compress_level=9)


def main() -> None:
    SOURCE.mkdir(parents=True, exist_ok=True)
    RUNTIME.mkdir(parents=True, exist_ok=True)
    for name, source_path in INPUTS.items():
        if not source_path.exists():
            raise FileNotFoundError(source_path)
        source_name = name if name.endswith("master") else f"{name}-master"
        copy2(source_path, SOURCE / f"{source_name}.png")
        cleaned = clean_alpha(Image.open(source_path))
        if name in {"hero-whisper", "about-brand-whisper"}:
            width = 1200
            height = round(cleaned.height * width / cleaned.width)
            save_scaled(cleaned, RUNTIME / f"{name}.png", (width, height))
            continue
        if name == "app-icon-master":
            icon = cleaned.resize((1024, 1024), Image.Resampling.LANCZOS)
            save_scaled(icon, RUNTIME / "app-icon-master.png", (512, 512))
            exports = ROOT / "brand" / "exports"
            png = exports / "png"
            png.mkdir(parents=True, exist_ok=True)
            for size in (16, 20, 24, 32, 40, 48, 64, 128, 256, 512):
                save_scaled(icon, png / f"yd-{size}.png", (size, size))
            save_scaled(icon, exports / "icon-256.png", (256, 256))
            save_scaled(icon, exports / "icon-512.png", (512, 512))
            icon.save(exports / "yd.ico", sizes=[(16, 16), (20, 20), (24, 24), (32, 32), (40, 40), (48, 48), (64, 64), (128, 128), (256, 256)])
            continue
        subject = crop_subject(cleaned)
        save_scaled(subject, RUNTIME / f"{name}.png", (512, 512))
        save_scaled(subject, RUNTIME / f"{name}-256.png", (256, 256))


if __name__ == "__main__":
    main()
