"""Split the approved 5x2 yd-pixel source sheet into production PNG frames.

The script performs lossless grid crops only: it never redraws, resizes, adds a
background, or changes pixel content.  Pass the approved source PNG explicitly
so repository builds never depend on a temporary/private path.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image


FRAME_NAMES = (
    "idle",
    "busy_class",
    "busy_work",
    "upcoming",
    "reminder",
    "gentle",
    "night_sleep",
    "eating",
    "nap",
    "wake_up",
)


def connected_components(binary: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Small dependency-free 8-connected labeler for the approved PNG alpha."""
    height, width = binary.shape
    labels = np.zeros((height, width), dtype=np.int32)
    parent = [0]

    def find(value: int) -> int:
        while parent[value] != value:
            parent[value] = parent[parent[value]]
            value = parent[value]
        return value

    def union(left: int, right: int) -> None:
        left, right = find(left), find(right)
        if left != right:
            parent[max(left, right)] = min(left, right)

    for y in range(height):
        for x in np.flatnonzero(binary[y]):
            neighbours = []
            if x > 0 and labels[y, x - 1]:
                neighbours.append(int(labels[y, x - 1]))
            if y > 0:
                for nx in range(max(0, x - 1), min(width, x + 2)):
                    if labels[y - 1, nx]:
                        neighbours.append(int(labels[y - 1, nx]))
            if neighbours:
                label = min(find(value) for value in neighbours)
                labels[y, x] = label
                for value in neighbours:
                    union(label, value)
            else:
                label = len(parent)
                parent.append(label)
                labels[y, x] = label

    roots = np.arange(len(parent), dtype=np.int32)
    for label in range(1, len(parent)):
        roots[label] = find(label)
    labels = roots[labels]
    component_ids = np.unique(labels[labels > 0])
    return labels, component_ids


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("src/ui/assets/companion/pixel"),
    )
    args = parser.parse_args()

    with Image.open(args.source) as source:
        source.load()
        if source.mode != "RGBA":
            raise SystemExit(f"expected transparent RGBA PNG, got {source.mode}")
        # The export's visual row boundary is 15 px below its mathematical
        # midpoint: the upper figures' shoes end before the lower figures'
        # hair begins. Use that real seam so neither row leaks into the other.
        alpha = np.asarray(source.getchannel("A"))
        x_edges = [round(index * source.width / 5) for index in range(6)]
        y_edges = [0, round(source.height / 2) + 15, source.height]
        isolated: list[Image.Image] = []
        for index, name in enumerate(FRAME_NAMES):
            row, column = divmod(index, 5)
            left, right = x_edges[column], x_edges[column + 1]
            top, bottom = y_edges[row], y_edges[row + 1]
            crop = source.crop((left, top, right, bottom))
            crop_alpha = np.asarray(crop.getchannel("A"))
            if row == 1:
                labels, component_ids = connected_components(crop_alpha > 0)
                safe = crop_alpha > 0
                for component in component_ids:
                    ys, xs = np.nonzero(labels == component)
                    from_upper_row = float(ys.mean()) < 25 and len(xs) < 10_000
                    from_left_neighbour = column in (1, 2) and float(xs.mean()) < 20 and len(xs) < 10_000
                    if from_upper_row or from_left_neighbour:
                        safe[labels == component] = False
                mask = Image.fromarray((safe * 255).astype(np.uint8), mode="L")
                crop = Image.composite(crop, Image.new("RGBA", crop.size), mask)
            bounds = crop.getchannel("A").getbbox()
            if bounds is None:
                raise SystemExit(f"cell {index + 1} ({name}) is empty")
            isolated.append(crop.crop(bounds))

        cell_width = max(frame.width for frame in isolated) + 4
        cell_height = max(frame.height for frame in isolated) + 4

        args.output.mkdir(parents=True, exist_ok=True)
        for name, crop in zip(FRAME_NAMES, isolated):
            frame = Image.new("RGBA", (cell_width, cell_height), (0, 0, 0, 0))
            frame.alpha_composite(crop, ((cell_width - crop.width) // 2, cell_height - crop.height))
            frame.save(args.output / f"{name}.png", format="PNG", optimize=False)

        print(f"wrote {len(FRAME_NAMES)} RGBA frames at {cell_width}x{cell_height}")


if __name__ == "__main__":
    main()
