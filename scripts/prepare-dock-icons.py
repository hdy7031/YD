"""把用户确认的语义图标母版切分成 Dock / 详情面板用的独立生产资源。

素材：``brand/source/dock-icons-master.png``（Asset 03，7 枚，透明底）

语义映射（只属于 UI 表现层，不写进领域模型）：

    calendar  日程 / 课程 / 下一项安排      meeting  会议 / 活动（多人）
    task      待办 / 工作                    reading  阅读 / 轻休闲（书 + 咖啡）
    commute   通勤（列车）                  meal     用餐
    sleep     睡眠 / 夜间 / 午休

切分规则：按透明度自动找出两行七列的真实 visual bounds，逐枚裁切后缩放到同一块
64×64 透明画布（最长边占画布 86%），因此每枚图标的视觉重量一致。
脚本会检查 alpha、边缘留白与非透明背景，任何一枚不合格都会失败。

运行：python scripts/prepare-dock-icons.py
"""
from __future__ import annotations

import sys

import numpy as np
from PIL import Image

import brand_paths as bp

CANVAS = 64
# 最长边占画布比例：留出 7% 的四周呼吸，缩小到 16–20 CSS px 时不会贴边。
CONTENT_FRACTION = 0.86
ALPHA_FLOOR = 16
# 与母版实际排布一致（第一排 4 枚，第二排 3 枚）。
ICON_NAMES = ["calendar", "meeting", "task", "reading", "commute", "meal", "sleep"]
ROW_SIZES = (4, 3)


def bands(profile: np.ndarray, threshold: float, gap: int) -> list[tuple[int, int]]:
    on = profile > threshold
    runs: list[tuple[int, int]] = []
    start: int | None = None
    for index, value in enumerate(on):
        if value and start is None:
            start = index
        if not value and start is not None:
            runs.append((start, index - 1))
            start = None
    if start is not None:
        runs.append((start, len(on) - 1))
    merged: list[tuple[int, int]] = []
    for run in runs:
        if merged and run[0] - merged[-1][1] <= gap:
            merged[-1] = (merged[-1][0], run[1])
        else:
            merged.append(run)
    return merged


def slice_icons(sheet: Image.Image) -> list[tuple[str, tuple[int, int, int, int]]]:
    mask = np.asarray(sheet)[..., 3] > ALPHA_FLOOR
    rows = bands(mask.mean(axis=1), 0.002, 24)
    if len(rows) != len(ROW_SIZES):
        raise SystemExit(f"图标母版应该有 {len(ROW_SIZES)} 行，实际 {len(rows)} 行")
    found: list[tuple[str, tuple[int, int, int, int]]] = []
    for (top, bottom), expected in zip(rows, ROW_SIZES):
        columns = bands(mask[top:bottom + 1].mean(axis=0), 0.002, 26)
        if len(columns) != expected:
            raise SystemExit(f"母版该行应该有 {expected} 枚图标，实际 {len(columns)} 枚")
        for left, right in columns:
            block = mask[top:bottom + 1, left:right + 1]
            ys, xs = np.where(block)
            found.append((
                ICON_NAMES[len(found)],
                (left + int(xs.min()), top + int(ys.min()), left + int(xs.max()) + 1, top + int(ys.max()) + 1),
            ))
    return found


def normalize(sheet: Image.Image, box: tuple[int, int, int, int]) -> Image.Image:
    icon = sheet.crop(box)
    scale = (CANVAS * CONTENT_FRACTION) / max(icon.size)
    scaled = icon.resize((max(1, round(icon.width * scale)), max(1, round(icon.height * scale))), Image.LANCZOS)
    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    canvas.alpha_composite(scaled, ((CANVAS - scaled.width) // 2, (CANVAS - scaled.height) // 2))
    return canvas


def verify(name: str, icon: Image.Image, box: tuple[int, int, int, int]) -> list[str]:
    problems: list[str] = []
    alpha = np.asarray(icon)[..., 3]
    corners = [int(alpha[0, 0]), int(alpha[0, -1]), int(alpha[-1, 0]), int(alpha[-1, -1])]
    if max(corners) > 8:
        problems.append(f"{name}: 画布四角不透明 {corners}（母版可能带不透明底）")
    if int(alpha.max()) < 200:
        problems.append(f"{name}: alpha 峰值只有 {int(alpha.max())}，图标过淡")
    opaque = float((alpha > 250).mean())
    if opaque > 0.9:
        problems.append(f"{name}: 几乎整块画布不透明（{opaque:.2f}），疑似带了背景")
    width, height = box[2] - box[0], box[3] - box[1]
    if min(width, height) < 120:
        problems.append(f"{name}: 切分区域过小 {width}x{height}，可能被邻图裁切")
    return problems


def write_contact_sheet(icons: list[tuple[str, Image.Image]]) -> None:
    scale = 3
    cell = CANVAS * scale
    sheet = Image.new("RGB", (len(icons) * (cell + 16) + 16, cell * 2 + 48), (247, 248, 246))
    dark = Image.new("RGB", (sheet.width, cell + 24), (32, 38, 42))
    for index, (name, icon) in enumerate(icons):
        blown = icon.resize((cell, cell), Image.NEAREST)
        sheet.paste(blown, (16 + index * (cell + 16), 24), blown)
        dark.paste(blown, (16 + index * (cell + 16), 12), blown)
    sheet.paste(dark, (0, cell + 24))
    bp.EXPLORE.mkdir(parents=True, exist_ok=True)
    sheet.save(bp.EXPLORE / "dock-icons.png")


def main() -> int:
    if not bp.DOCK_ICONS_MASTER.exists():
        raise SystemExit(f"缺少图标母版：{bp.DOCK_ICONS_MASTER}")
    sheet = Image.open(bp.DOCK_ICONS_MASTER).convert("RGBA")
    entries = slice_icons(sheet)
    bp.DOCK_ICONS.mkdir(parents=True, exist_ok=True)

    problems: list[str] = []
    icons: list[tuple[str, Image.Image]] = []
    print("语义图标切分：")
    for name, box in entries:
        icon = normalize(sheet, box)
        problems += verify(name, icon, box)
        icon.save(bp.DOCK_ICONS / f"{name}.png", optimize=True)
        icons.append((name, icon))
        print(f"  {name:<9} visual bounds {box[2] - box[0]:>3}x{box[3] - box[1]:<3} → {CANVAS}x{CANVAS}  {bp.DOCK_ICONS.relative_to(bp.ROOT)}\\{name}.png")
    write_contact_sheet(icons)
    print("  目检图 brand/explore/dock-icons.png")
    if problems:
        print("自检未通过：")
        for item in problems:
            print("  -", item)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
