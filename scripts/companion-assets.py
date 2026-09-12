"""Split the desk pet artwork into normalized, per-state desk pet assets.

输入（`artwork/companion/custom/`）：
  * `character-sheet.png`   正式十宫格（5 列 × 2 行）或旧的 3 × 2 六格合集
  * `sleeping.png` / `night_sleep.png`、`eating.png`、`nap.png`、`wake_up.png`
                             单图状态（只在旧六格合集模式下使用）

输出：
  * `src/ui/assets/companion/custom/<state>.png` + `manifest.json`
  * `src/companion-fallback-idle.ts`（与正式桌宠同一形象的 idle 兜底帧）

The script never runs at runtime: it is a build-time authoring tool. The generated
files are committed so `npm run build` stays Python-free.

合集图阅读顺序（5 列 × 2 行，从左到右、先上后下）：
  idle · busy_class · busy_work · relaxed · reminder
  happy · night_sleep · eating · nap · wake_up

Normalization rules (kept identical for every state):
  * one shared canvas for all states, so the transparent window never resizes;
  * identical feet baseline, so the character never jumps vertically;
  * body height (hair top -> soles) scaled to one target, so poses read as one person;
  * shared horizontal anchor (hair centre), so the figure never drifts sideways;
  * 躺下的姿态（午睡）不参与体型归一，改为整体等比放进同一画布；
  * soft alpha below a floor is cleared, removing faint generation noise.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
ARTWORK = ROOT / "artwork" / "companion" / "custom"
DEFAULT_SHEET = ARTWORK / "character-sheet.png"
DEFAULT_OUT = ROOT / "src" / "ui" / "assets" / "companion" / "custom"
FALLBACK_MODULE = ROOT / "src" / "companion-fallback-idle.ts"
PREVIEW_DIR = ROOT / ".build-cache" / "companion"

ALPHA_FLOOR = 24
ALPHA_CLEAN = 6
FIGURE_MIN_PIXELS = 5000
HAIR_WIDTH_RATIO = 0.22
HEAD_BAND = 60
CANVAS_PADDING = 14
FALLBACK_WIDTH = 200

# 正式十宫格：5 列 × 2 行，阅读顺序固定为“先左到右，再上到下”。
STATES_TEN = [
    ("idle", "默认 / 安静待机", "自然站立，双手放松", "第 1 行第 1 格"),
    ("busy_class", "阅读 / 教学类状态", "戴眼镜，一手执书一手持教鞭", "第 1 行第 2 格"),
    ("busy_work", "学习 / 记录类状态", "抱笔记本与笔，思考神态", "第 1 行第 3 格"),
    ("relaxed", "喝水 / 饮品状态", "端着带盖水杯，轻松伸展", "第 1 行第 4 格"),
    ("reminder", "白天 / 活跃提示状态", "身体前倾，抬手温和提示，身旁一个暖金色提示光点（太阳意象）", "第 1 行第 5 格"),
    ("happy", "开心 / 激励状态", "轻庆祝，笑容与少量星光", "第 2 行第 1 格"),
    ("night_sleep", "夜间睡觉", "抱着月亮坐在云朵上入睡", "第 2 行第 2 格"),
    ("eating", "吃饭", "端着碗用筷子吃饭", "第 2 行第 3 格"),
    ("nap", "午睡", "趴在粉色枕头上午睡", "第 2 行第 4 格"),
    ("wake_up", "刚睡醒 / 伸懒腰", "揉眼并伸展手臂", "第 2 行第 5 格"),
]
# 旧 3 × 2 合集只包含白天六态，其余四态取自单图素材。
STATES_LEGACY_SHEET = STATES_TEN[:6]

# 躺下 / 横向姿态不参与“头发顶 → 脚底”的体型归一：它会把所有站姿一起缩小。
# 这些状态改为整体等比放进同一画布（底边对齐），与旧的单图状态处理方式一致。
FIT_STATES = {"nap"}

# 单图状态：不来自合集图，而是独立生成的透明 PNG。接入规则与合集状态完全一致
# （同一画布、同一脚底基线、等比缩放）。文件缺失时跳过并说明，应用按相近动作回退。
EXTRA_STATES = [
    ("night_sleep", "夜间睡觉", "抱着月亮坐在云朵上入睡", ["sleeping.png", "night_sleep.png"]),
    ("eating", "吃饭", "端着碗用筷子吃饭", ["eating.png"]),
    ("nap", "午睡", "趴在粉色枕头上午睡", ["nap.png"]),
    ("wake_up", "刚睡醒 / 伸懒腰", "揉眼并伸展手臂", ["wake_up.png"]),
]


@dataclass
class Figure:
    key: str
    label: str
    note: str
    slot: str
    # 面具用的是“该格”的局部坐标，origin 记录这一格在整张合集图里的左上角。
    origin: tuple[int, int]
    mask: np.ndarray
    core: np.ndarray
    bbox: tuple[int, int, int, int]
    hair_top: int
    head_center: float
    feet_y: int
    body_height: int
    left_extent: float
    right_extent: float


def log(message: str) -> None:
    print(f"[companion-assets] {message}")


def clean_alpha(data: np.ndarray) -> np.ndarray:
    alpha = data[:, :, 3]
    alpha[alpha < ALPHA_CLEAN] = 0
    data[:, :, 3] = alpha
    return data


def load_sheet(path: Path) -> np.ndarray:
    if not path.exists():
        raise SystemExit(f"找不到角色合集图：{path}")
    image = Image.open(path).convert("RGBA")
    data = clean_alpha(np.array(image).astype(np.int16))
    log(f"读取合集图 {image.size[0]}x{image.size[1]} · {path.name}")
    return data


def slice_sheet(mask: np.ndarray, columns: int, rows: int) -> list[tuple[np.ndarray, int, int]]:
    """把整张合集图切成 columns × rows 个面具。

    十宫格里同一列上下两格常常“脚跟贴头发”地挨在一起，直接做连通域会把两格连成一团，
    所以这里先按列切片，再在水平接缝带里取覆盖像素最少的一行作为切分线。
    切分线以下的像素归下一格，最多损失一两个像素，肉眼不可见。
    """
    height, width = mask.shape
    cells: list[tuple[np.ndarray, int, int]] = []
    for row in range(rows):
        for column in range(columns):
            x0, x1 = round(column * width / columns), round((column + 1) * width / columns)
            if rows == 2:
                profile = mask[:, x0:x1].sum(axis=1)
                middle = round(height / 2)
                lo, hi = max(0, middle - 100), min(height, middle + 100)
                cut = lo + int(profile[lo:hi].argmin())
                y0, y1 = (0, cut) if row == 0 else (cut, height)
            else:
                y0, y1 = round(row * height / rows), round((row + 1) * height / rows)
            cells.append((mask[y0:y1, x0:x1].copy(), y0, x0))
    return cells


def collect_figures(data: np.ndarray, states: list[tuple[str, str, str, str]], columns: int, rows: int) -> list[Figure]:
    mask = data[:, :, 3] > ALPHA_FLOOR
    cells = slice_sheet(mask, columns, rows)
    figures: list[Figure] = []
    for index, (key, label, note, slot) in enumerate(states):
        own, y0, x0 = cells[index]
        if not own.any():
            raise SystemExit(f"合集图第 {index + 1} 格里没有找到人物像素")
        labels, count = ndimage.label(own, structure=np.ones((3, 3), dtype=int))
        sizes = ndimage.sum(own, labels, range(1, count + 1))
        core = labels == (1 + int(np.argmax(sizes)))
        figures.append(measure(key, label, note, slot, (y0, x0), own, core))
    return figures


def probe_layout(data: np.ndarray, columns: int, rows: int) -> list[Figure] | None:
    """按给定排版切一遍；切不出像样的人物就返回 None，交给下一种排版再试。"""
    states = STATES_TEN if columns * rows == len(STATES_TEN) else STATES_LEGACY_SHEET
    try:
        figures = collect_figures(data, states, columns, rows)
    except SystemExit:
        return None
    if min(int(figure.mask.sum()) for figure in figures) < FIGURE_MIN_PIXELS:
        return None
    return figures


def measure(key: str, label: str, note: str, slot: str, origin: tuple[int, int], own: np.ndarray, core: np.ndarray) -> Figure:
    # 面具是格内局部坐标，这里统一换算成整张合集图的坐标，后面的裁切 / 缩放 / 基线
    # 计算都只在整图坐标系里进行。
    y0, x0 = origin
    rows = np.where(own.any(axis=1))[0]
    cols = np.where(own.any(axis=0))[0]
    top, bottom = int(rows[0]) + y0, int(rows[-1]) + y0
    left, right = int(cols[0]) + x0, int(cols[-1]) + x0

    core_rows = np.where(core.any(axis=1))[0]
    core_top, core_bottom = int(core_rows[0]), int(core_rows[-1])
    widths = core[core_top : core_bottom + 1].sum(axis=1)
    threshold = HAIR_WIDTH_RATIO * int(widths.max())
    hair_offset = int(np.argmax(widths >= threshold))
    hair_top = core_top + hair_offset + y0

    # core 是格内局部坐标，这里必须用局部行号取“头顶到下 60 行”的带状区域。
    local_hair = hair_top - y0
    head_rows = core[local_hair : local_hair + HEAD_BAND]
    head_weights = head_rows.sum(axis=1).astype(float)
    head_xs = np.arange(core.shape[1], dtype=float)[None, :] * head_rows
    center = float((head_xs.sum()) / max(1.0, head_weights.sum())) + x0

    feet_y = bottom
    body_height = feet_y + 1 - hair_top
    left_extent = center - left
    right_extent = right - center
    return Figure(key, label, note, slot, origin, own, core, (top, bottom, left, right), hair_top, center, feet_y, body_height, left_extent, right_extent)


def crop_figure(data: np.ndarray, figure: Figure, pad: int = 2) -> tuple[Image.Image, int, int]:
    """按面具裁出单格图像（同时返回它在整图里的左上角），并清掉格子外的低 alpha 噪声。"""
    cell_y0, cell_x0 = figure.origin
    top, bottom, left, right = figure.bbox
    y0 = max(cell_y0, top - pad)
    y1 = min(cell_y0 + figure.mask.shape[0], bottom + 1 + pad)
    x0 = max(cell_x0, left - pad)
    x1 = min(cell_x0 + figure.mask.shape[1], right + 1 + pad)
    rgba = data[y0:y1, x0:x1].astype(np.float32)
    keep = figure.mask[y0 - cell_y0 : y1 - cell_y0, x0 - cell_x0 : x1 - cell_x0]
    rgba[:, :, 3] = np.where(keep, rgba[:, :, 3], 0)
    return Image.fromarray(np.clip(rgba, 0, 255).astype(np.uint8), "RGBA"), y0, x0


def scaled_figure(image: Image.Image, figure: Figure, y0: int, x0: int, scale: float) -> tuple[Image.Image, np.ndarray]:
    target = (max(1, int(round(image.width * scale))), max(1, int(round(image.height * scale))))
    resized = image.resize(target, Image.LANCZOS, reducing_gap=2.0)
    # Anchor bookkeeping after resampling.
    hair_local = (figure.hair_top - y0) * scale
    feet_local = (figure.feet_y - y0) * scale
    head_local = (figure.head_center - x0) * scale
    return resized, np.array([hair_local, feet_local, head_local], dtype=float)


def build_canvas(figures: list[Figure], data: np.ndarray, target_body: float) -> tuple[dict[str, Image.Image], dict]:
    prepared: dict[str, tuple[Image.Image, np.ndarray, Figure]] = {}
    half_width = 0.0
    arm_overhang = 0.0
    for figure in figures:
        image, y0, x0 = crop_figure(data, figure, 2)
        scale = target_body / figure.body_height
        resized, anchors = scaled_figure(image, figure, y0, x0, scale)
        hair_local, feet_local, head_local = anchors
        half_width = max(half_width, head_local, resized.width - head_local)
        arm_overhang = max(arm_overhang, hair_local)
        prepared[figure.key] = (resized, anchors, figure)
        log(
            f"  {figure.key}: 体型 {figure.body_height}px -> 缩放 {scale:.3f} · "
            f"内容 {resized.width}x{resized.height}"
        )

    width = int(np.ceil(half_width * 2 + CANVAS_PADDING * 2))
    if width % 2:
        width += 1
    top_space = int(np.ceil(arm_overhang + CANVAS_PADDING))
    baseline = top_space + int(round(target_body))
    height = baseline + CANVAS_PADDING
    center_x = width / 2

    canvases: dict[str, Image.Image] = {}
    for key, (image, anchors, figure) in prepared.items():
        hair_local, feet_local, head_local = anchors
        canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        offset_x = int(round(center_x - head_local))
        offset_y = int(round((baseline - target_body) - hair_local))
        canvas.alpha_composite(image, (offset_x, offset_y))
        canvases[key] = canvas

    meta = {"width": width, "height": height, "baseline": baseline, "bodyHeight": int(round(target_body))}
    return canvases, meta


def fit_into_canvas(image: Image.Image, width: int, height: int, baseline: int, body_height: int, label: str) -> tuple[Image.Image, float]:
    """把整幅图像等比放进同一画布：内容底边贴脚底基线，水平居中。"""
    alpha = np.array(image)[:, :, 3]
    mask = alpha > ALPHA_FLOOR
    if not mask.any():
        raise SystemExit(f"{label} 里没有找到可见像素")
    rows = np.where(mask.any(axis=1))[0]
    cols = np.where(mask.any(axis=0))[0]
    y0, y1, x0, x1 = int(rows[0]), int(rows[-1]) + 1, int(cols[0]), int(cols[-1]) + 1
    crop = np.array(image).astype(np.float32)[y0:y1, x0:x1]
    crop[:, :, 3] = np.where(mask[y0:y1, x0:x1], crop[:, :, 3], 0)
    content = Image.fromarray(np.clip(crop, 0, 255).astype(np.uint8), "RGBA")

    max_width, max_height = width - CANVAS_PADDING * 2, body_height
    scale = min(max_width / content.width, max_height / content.height)
    target = (max(1, int(round(content.width * scale))), max(1, int(round(content.height * scale))))
    resized = content.resize(target, Image.LANCZOS, reducing_gap=2.0)

    canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    canvas.alpha_composite(resized, (int(round((width - resized.width) / 2)), int(round(baseline - resized.height))))
    log(f"  {label}: 等比适配 缩放 {scale:.3f} · 内容 {resized.width}x{resized.height} · 底边 y={baseline}")
    return canvas, scale


def write_preview(canvases: dict[str, Image.Image], meta: dict, columns: int) -> None:
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    width, height = meta["width"], meta["height"]
    keys = list(canvases.keys())
    rows = max(1, (len(keys) + columns - 1) // columns)
    sheet = Image.new("RGBA", (width * columns, height * rows), (255, 255, 255, 255))
    for index, key in enumerate(keys):
        sheet.alpha_composite(canvases[key], ((index % columns) * width, (index // columns) * height))
    sheet.convert("RGB").save(PREVIEW_DIR / "normalized-sheet.png")

    checks = [Image.new("RGBA", (width, height), (235, 240, 244, 255)) for _ in keys]
    for index, key in enumerate(keys):
        checks[index].alpha_composite(canvases[key])
    stack = Image.new("RGBA", (width, height * len(checks)), (0, 0, 0, 0))
    for index, check in enumerate(checks):
        stack.alpha_composite(check, (0, index * height))
    stack.convert("RGB").save(PREVIEW_DIR / "state-stack.png")


def load_clean_rgba(path: Path) -> np.ndarray:
    """读入透明 PNG 并按合集图相同的规则清理低 alpha 生成噪声。"""
    if not path.exists():
        raise SystemExit(f"找不到状态素材：{path}")
    image = Image.open(path).convert("RGBA")
    data = clean_alpha(np.array(image).astype(np.int16))
    log(f"读取单图素材 {image.size[0]}x{image.size[1]} · {path.name}")
    return data


def write_fallback_module(idle_path: Path, target: Path, width: int = FALLBACK_WIDTH) -> None:
    """写出内置兜底帧：与正式桌宠同一形象的 idle，只在素材目录读不到时使用。"""
    image = Image.open(idle_path).convert("RGBA")
    height = max(1, int(round(image.height * width / image.width)))
    resized = image.resize((width, height), Image.LANCZOS, reducing_gap=2.0)
    buffer = io.BytesIO()
    resized.save(buffer, format="PNG", optimize=True)
    payload = base64.b64encode(buffer.getvalue()).decode("ascii")
    target.write_text(
        "// 由 scripts/companion-assets.py 生成：与正式桌宠同一形象的 idle 兜底帧。\n"
        "// 换素材后重新运行 npm run assets:companion 即可，请不要手工编辑这个文件。\n"
        f"export const companionFallbackIdle = 'data:image/png;base64,{payload}';\n",
        encoding="utf-8",
    )
    log(f"写出 {target.relative_to(ROOT)} · {target.stat().st_size // 1024} KB · {width}x{height}")


def main() -> None:
    parser = argparse.ArgumentParser(description="生成专属角色桌宠状态素材")
    parser.add_argument("--sheet", type=Path, default=DEFAULT_SHEET)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--artwork", type=Path, default=ARTWORK)
    parser.add_argument("--columns", type=int, default=0, help="合集图列数；缺省按素材格数自动判断")
    parser.add_argument("--rows", type=int, default=0, help="合集图行数；缺省按素材格数自动判断")
    parser.add_argument("--skip-extra", action="store_true", help="只生成合集图里的状态，忽略单图素材")
    args = parser.parse_args()

    sheet_path = args.sheet.resolve()
    artwork_dir = args.artwork.resolve()
    out_dir = args.out.resolve()

    data = load_sheet(sheet_path)
    # 排版优先按参数，其次按宽高比猜（5×2 → 2.5，3×2 → 1.5），最后用“切出来的
    # 每一格都得像个人”来兜底：十宫格切失败就退回旧的六格合集排版。
    candidates = [(args.columns, args.rows)] if args.columns and args.rows else (
        [(5, 2), (3, 2)] if data.shape[1] / data.shape[0] > 2.0 else [(3, 2), (5, 2)]
    )
    columns = rows = 0
    figures: list[Figure] | None = None
    for candidate in candidates:
        figures = probe_layout(data, *candidate)
        if figures:
            columns, rows = candidate
            break
    if not figures:
        raise SystemExit("合集图既不是 5 × 2 十宫格，也不是 3 × 2 六格合集，请检查素材或指定 --columns/--rows")

    if columns * rows == len(STATES_TEN):
        states, extras = STATES_TEN, []
        log(f"按 {columns} × {rows} 十宫格素材处理（正式默认素材）")
    else:
        states, columns, rows = STATES_LEGACY_SHEET, 3, 2
        extras = [] if args.skip_extra else EXTRA_STATES
        log("按 3 × 2 六格合集 + 单图状态处理（旧素材包兼容模式）")
    # 站姿 / 坐姿参与体型归一；躺下的姿态（午睡）只做等比适配。
    upright = [figure for figure in figures if figure.key not in FIT_STATES]
    target_body = float(min(figure.body_height for figure in upright))
    log(f"统一体型高度基准 {target_body:.0f}px（来自最矮的站姿，避免放大失真）")

    canvases, meta = build_canvas(upright, data, target_body)
    state_table = {
        key: {"file": f"{key}.png", "label": label, "note": note, "slot": slot}
        for key, label, note, slot in states
    }
    for figure in figures:
        if figure.key not in FIT_STATES:
            continue
        cropped, _y0, _x0 = crop_figure(data, figure)
        canvases[figure.key], _scale = fit_into_canvas(
            cropped, meta["width"], meta["height"], meta["baseline"], meta["bodyHeight"], figure.key
        )

    extra_sources: dict[str, str] = {}
    missing: list[str] = []
    for key, label, note, candidates in extras:
        source_path = next((artwork_dir / name for name in candidates if (artwork_dir / name).exists()), None)
        slot = next((item[3] for item in STATES_TEN if item[0] == key), "")
        if source_path is None:
            missing.append(key)
            log(f"  跳过 {key}：未找到 {' / '.join(candidates)}")
            continue
        image = Image.fromarray(np.clip(load_clean_rgba(source_path), 0, 255).astype(np.uint8), "RGBA")
        canvases[key], _scale = fit_into_canvas(
            image, meta["width"], meta["height"], meta["baseline"], meta["bodyHeight"], key
        )
        state_table[key] = {"file": f"{key}.png", "label": label, "note": note, "slot": slot}
        extra_sources[key] = source_path.name
    if missing:
        log(f"以下状态暂无素材，应用会按相近动作回退：{'、'.join(missing)}")

    write_preview(canvases, meta, columns)

    digest = hashlib.sha256(sheet_path.read_bytes()).hexdigest()
    manifest = {
        "format": "dayhub-companion",
        "version": 1,
        "character": "专属角色桌宠",
        "canvas": {"width": meta["width"], "height": meta["height"]},
        "baseline": meta["baseline"],
        "bodyHeight": meta["bodyHeight"],
        "sheet": {"file": sheet_path.name, "columns": columns, "rows": rows, "figures": len(states)},
        "generatedFrom": sheet_path.name,
        "sourceSha256": digest,
        "extraSources": extra_sources,
        "extraSourceSha256": {
            key: hashlib.sha256((artwork_dir / name).read_bytes()).hexdigest()
            for key, name in extra_sources.items()
        },
        "missing": missing,
        "states": state_table,
    }

    out_dir.mkdir(parents=True, exist_ok=True)
    for key, image in canvases.items():
        target = out_dir / f"{key}.png"
        image.save(target, optimize=True)
        log(f"写出 {target.relative_to(ROOT)} · {target.stat().st_size // 1024} KB")
    for stale in out_dir.glob("*.png"):
        if stale.stem not in canvases:
            stale.unlink()
            log(f"清理旧状态素材 {stale.name}")
    (out_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    log(f"写出 {(out_dir / 'manifest.json').relative_to(ROOT)}")
    write_fallback_module(out_dir / "idle.png", FALLBACK_MODULE)
    log(f"画布 {meta['width']}x{meta['height']} · 脚底基线 y={meta['baseline']} · 预览 {PREVIEW_DIR}")


if __name__ == "__main__":
    main()
