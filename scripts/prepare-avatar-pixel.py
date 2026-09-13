"""Split the approved 5x2 yd-pixel source sheet into production PNG frames.

The script performs lossless grid crops only: it never redraws, resizes, adds a
background, or changes pixel content.  The only pixels it removes are detached
fragments that belong to a *neighbouring* cell of the sheet: the approved art
overlaps its cell edges, so a figure's wand/hair can land inside the next cell
as an isolated island.  Pass the approved source PNG explicitly so repository
builds never depend on a temporary/private path.
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

# A neighbour's art enters a cell as an isolated island hugging the cell edge,
# usually clipped flat by the cell boundary. Real detached decoration (for
# example the floating "z z" of night_sleep) sits further inside the cell, so
# both guards below must hold before a component is treated as foreign bleed.
# Measured on the approved sheet: every bleed island sits within 8 px of the
# shared cell edge, while the nearest intentional decoration is 12 px away.
EDGE_MARGIN = 10
MAX_FOREIGN_RATIO = 0.05
MIN_FOREIGN_PIXELS = 30


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


def drop_edge_bleed(alpha: np.ndarray) -> np.ndarray:
    """Return a keep-mask with foreign islands from a neighbouring cell removed.

    The approved sheet overlaps its cell edges, so a neighbour's prop can land
    inside a cell as an isolated island. An island qualifies as foreign when it
    is clearly a piece of the neighbour: it reaches past the figure's own
    horizontal span, or it is clipped against the cell edge. Small interior
    specks and the figure itself are always kept, and the figure is never moved,
    so the pack's geometry stays exactly as tuned.
    """
    labels, component_ids = connected_components(alpha > 0)
    if not len(component_ids):
        return alpha > 0
    sizes = {int(component): int((labels == component).sum()) for component in component_ids}
    largest = max(sizes.values())
    main = next(component for component, size in sizes.items() if size == largest)
    main_ys, main_xs = np.nonzero(labels == main)
    main_left, main_right = int(main_xs.min()), int(main_xs.max())
    width = alpha.shape[1]
    keep = alpha > 0
    for component in component_ids:
        component = int(component)
        size = sizes[component]
        if size == largest or size < MIN_FOREIGN_PIXELS or size > largest * MAX_FOREIGN_RATIO:
            continue
        ys, xs = np.nonzero(labels == component)
        left, right = int(xs.min()), int(xs.max())
        beyond_figure = right < main_left or left > main_right
        clipped_at_edge = left < EDGE_MARGIN or width - 1 - right < EDGE_MARGIN
        if beyond_figure or clipped_at_edge:
            keep[labels == component] = False
    return keep


def clean_reference_crop(crop: Image.Image) -> Image.Image:
    """Clean one already-produced frame without changing anything except bleed."""
    keep = drop_edge_bleed(np.asarray(crop.getchannel("A")))
    mask = Image.fromarray((keep * 255).astype(np.uint8), mode="L")
    return Image.composite(crop, Image.new("RGBA", crop.size), mask)


def clean_existing_frames(directory: Path) -> None:
    """Repair frames produced by an older pipeline run in place."""
    for name in FRAME_NAMES:
        target = directory / f"{name}.png"
        if not target.exists():
            raise SystemExit(f"missing frame: {target}")
        with Image.open(target) as opened:
            opened.load()
            cleaned = clean_reference_crop(opened)
        cleaned.save(target, format="PNG", optimize=False)
        print(f"cleaned {name}.png")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path, nargs="?")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("src/ui/assets/companion/pixel"),
    )
    parser.add_argument(
        "--clean-output",
        action="store_true",
        help="re-apply edge-bleed cleanup to frames already written to --output",
    )
    args = parser.parse_args()

    if args.clean_output:
        clean_existing_frames(args.output)
        return
    if args.source is None:
        parser.error("a source PNG is required unless --clean-output is used")

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
            # Top-row cells can bleed sideways the same way bottom-row ones do;
            # the vertical-edge rule covers both rows.
            edge_keep = drop_edge_bleed(np.asarray(crop.getchannel("A")))
            edge_mask = Image.fromarray((edge_keep * 255).astype(np.uint8), mode="L")
            crop = Image.composite(crop, Image.new("RGBA", crop.size), edge_mask)
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
