"""Prepare the user-supplied YD empty-state illustrations for the app.

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
    "empty-schedule": Path(r"C:\Users\hdy\AppData\Local\Temp\codex-clipboard-0e71b366-f4ac-4cc1-8841-76501d340a8d.png"),
    "empty-inbox": Path(r"C:\Users\hdy\AppData\Local\Temp\codex-clipboard-b5e9185a-4726-4205-be72-a6ccca14e793.png"),
    "empty-reminders": Path(r"C:\Users\hdy\AppData\Local\Temp\codex-clipboard-e8cd5962-5af2-4c41-a947-2bfaa48c9ea2.png"),
    "home-atmosphere": Path(r"C:\Users\hdy\AppData\Local\Temp\codex-clipboard-551eb48d-5a8e-4a30-a9eb-a41e7f08c427.png"),
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
        copy2(source_path, SOURCE / f"{name}-master.png")
        cleaned = clean_alpha(Image.open(source_path))
        if name == "home-atmosphere":
            save_scaled(cleaned, RUNTIME / f"{name}.png", (1200, 400))
            continue
        subject = crop_subject(cleaned)
        save_scaled(subject, RUNTIME / f"{name}.png", (512, 512))
        save_scaled(subject, RUNTIME / f"{name}-256.png", (256, 256))


if __name__ == "__main__":
    main()
