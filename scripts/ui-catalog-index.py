"""Turn catalog.json + raw screenshots into a web-GPT friendly bundle.

Outputs (inside deliverables/ui-catalog-0.2.16):
  catalog.md / catalog.json / catalog.csv   - annotated, machine readable index
  web/shots/<id>.png                        - downscaled, transparency flattened
  web/contact-sheets/sheet-NN.png           - numbered 3x3 contact sheets
  README.md                                 - what each file is for
No judgement is added: every entry keeps only the capture path, the data
precondition and the visible UI elements.
"""
from __future__ import annotations

import csv
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "deliverables" / "ui-catalog-0.2.16"
WEB = OUT / "web"
WEB_SHOTS = WEB / "shots"
SHEETS = WEB / "contact-sheets"
MAX_WIDTH = 1400
TILE_W, TILE_H = 620, 400
PER_SHEET = 9

# Capture phases, in reading order. Purely structural grouping of the ids.
GROUPS = [
    ("A", "首次使用与基础页面（空数据）", ["01", "02", "03", "04", "05", "06", "07", "08", "09"]),
    ("B", "课表导入", ["09b"]),
    ("C", "我的安排", ["10", "11", "12", "13", "14", "15"]),
    ("D", "Ta 的课表", ["16", "17"]),
    ("E", "课表管理", ["18", "19", "20", "21", "22"]),
    ("F", "事项与会议", ["23", "24", "25", "26"]),
    ("G", "通知收件箱", ["27", "28", "29", "30", "31", "32", "33", "34", "35", "36", "37", "38", "39", "40"]),
    ("H", "未处理提醒、气泡与迷你面板", ["41", "42", "43", "44", "45", "46"]),
    ("I", "桌宠显示态与显示模式", ["47", "48", "49", "50", "51", "52", "53", "54", "55", "56", "57"]),
    ("J", "设置与备份", ["58", "59", "60", "61", "62", "63"]),
    ("K", "响应式宽度", ["64", "65", "66", "67", "68"]),
    ("L", "原生菜单（系统级浮层）", ["69", "70"]),
]


def font(size: int):
    for name in ["msyh.ttc", "msyhbd.ttc", "simhei.ttf", "arial.ttf"]:
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def checkerboard(size: tuple[int, int], cell: int = 12) -> Image.Image:
    image = Image.new("RGB", size, (255, 255, 255))
    draw = ImageDraw.Draw(image)
    for y in range(0, size[1], cell):
        for x in range(0, size[0], cell):
            if (x // cell + y // cell) % 2:
                draw.rectangle([x, y, x + cell - 1, y + cell - 1], fill=(233, 237, 241))
    return image


def flatten(source: Path, target: Path) -> Image.Image:
    image = Image.open(source).convert("RGBA")
    if image.width > MAX_WIDTH:
        ratio = MAX_WIDTH / image.width
        image = image.resize((MAX_WIDTH, max(1, round(image.height * ratio))), Image.LANCZOS)
    background = checkerboard(image.size)
    background.paste(image, (0, 0), image)
    target.parent.mkdir(parents=True, exist_ok=True)
    background.save(target)
    return background


def group_of(shot_id: str) -> tuple[str, str]:
    for key, title, prefixes in GROUPS:
        for prefix in prefixes:
            if shot_id == prefix or shot_id.startswith(prefix + "-"):
                return key, title
    return "Z", "其它"


def main() -> None:
    data = json.loads((OUT / "catalog.json").read_text(encoding="utf-8"))
    shots = data["shots"]
    WEB_SHOTS.mkdir(parents=True, exist_ok=True)
    SHEETS.mkdir(parents=True, exist_ok=True)

    prepared: list[dict] = []
    for shot in shots:
        shot_id = shot["id"]
        image_path = shot.get("file")
        if not image_path:
            prepared.append({**shot, "web": None, "thumb": None})
            continue
        source = OUT / image_path
        if not source.exists() and shot.get("raw"):
            source = OUT / shot["raw"]
        target = WEB_SHOTS / f"{shot_id}.png"
        image = flatten(source, target) if source.exists() else None
        prepared.append({**shot, "web": f"web/shots/{shot_id}.png" if image else None, "thumb": image})

    # ---- contact sheets: 3 x 3 tiles, each labelled with its capture id ----
    label_font = font(22)
    title_font = font(15)
    sheets = [prepared[i : i + PER_SHEET] for i in range(0, len(prepared), PER_SHEET)]
    sheet_index: list[dict] = []
    for number, chunk in enumerate(sheets, start=1):
        width = TILE_W * 3
        height = (TILE_H + 46) * 3
        sheet = checkerboard((width, height), 16)
        draw = ImageDraw.Draw(sheet)
        for index, shot in enumerate(chunk):
            column, row = index % 3, index // 3
            x, y = column * TILE_W, row * (TILE_H + 46)
            draw.rectangle([x, y, x + TILE_W - 1, y + TILE_H + 45], outline=(198, 206, 214))
            draw.text((x + 12, y + 10), f"#{shot['id']}", font=label_font, fill=(28, 40, 52))
            draw.text((x + 12, y + 34), shot["title"][:52], font=title_font, fill=(90, 102, 114))
            thumb = shot.get("thumb")
            if thumb:
                copy = thumb.copy()
                copy.thumbnail((TILE_W - 24, TILE_H - 16), Image.LANCZOS)
                sheet.paste(copy, (x + (TILE_W - copy.width) // 2, y + 58 + (TILE_H - 16 - copy.height) // 2))
            else:
                draw.text((x + 12, y + 70), "（原生浮层，见单张截图）", font=title_font, fill=(150, 120, 120))
        target = SHEETS / f"sheet-{number:02d}.png"
        sheet.save(target)
        sheet_index.append({"sheet": f"web/contact-sheets/sheet-{number:02d}.png", "ids": [s["id"] for s in chunk]})

    # ---- annotated markdown ----
    lines = [
        f"# 事务助手 {data['app']['version']} · 界面与功能截图目录",
        "",
        f"- 生成时间：{data['generatedAt']}",
        f"- 设备：Windows，缩放 {data['display']['dpr']}×，屏幕 {data['display']['size']['width']}×{data['display']['size']['height']}",
        f"- 截图数量：{len(prepared)} 张（面板截图按 1320×880 / 920×820 / 750×760 / 1920×900 四种窗口宽度采集）",
        f"- 数据：隔离数据库 `{data['data']}`，导入真实课表后补充待办、会议、调休、通知与到时提醒",
        "- 每张图的字段：进入路径（点什么会出现）、数据前提、画面元素、图片文件",
        "",
    ]
    current = None
    for shot in prepared:
        key, title = group_of(shot["id"])
        if key != current:
            current = key
            lines += ["", f"## {key}. {title}", ""]
        lines.append(f"### {shot['id']} · {shot['title']}")
        lines.append("")
        if shot.get("web"):
            lines.append(f"![{shot['id']}]({shot['web']})")
            lines.append("")
        lines.append(f"- 进入路径：{shot.get('entry', '—')}")
        lines.append(f"- 数据前提：{shot.get('precondition', '—')}")
        lines.append(f"- 画面元素：{'；'.join(shot.get('elements', []))}")
        lines.append(f"- 采集窗口：{shot.get('surface', 'panel')} · {shot.get('size', ['—'])[0]}×{shot.get('size', ['—'])[-1]} · 缩放 {shot.get('dpr', data['display']['dpr'])}×")
        if shot.get("note"):
            lines.append(f"- 说明：{shot['note']}")
        if shot.get("full"):
            lines.append(f"- 整屏原图：{shot['full']}")
        if not shot.get("file"):
            lines.append("- 图片：本机无法自动捕获该原生浮层的时间点，元素清单来自界面定义")
        lines.append("")
    (OUT / "catalog.md").write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")

    # ---- csv ----
    with (OUT / "catalog.csv").open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["id", "分组", "标题", "进入路径", "数据前提", "画面元素", "采集窗口", "图片", "说明"])
        for shot in prepared:
            key, title = group_of(shot["id"])
            writer.writerow([
                shot["id"],
                f"{key}.{title}",
                shot["title"],
                shot.get("entry", ""),
                shot.get("precondition", ""),
                "；".join(shot.get("elements", [])),
                f"{shot.get('surface', 'panel')} {shot.get('size', ['—'])[0]}×{shot.get('size', ['—'])[-1]}",
                shot.get("web") or "",
                shot.get("note", ""),
            ])

    index = {
        "app": data["app"],
        "generatedAt": data["generatedAt"],
        "display": data["display"],
        "count": len(prepared),
        "contactSheets": sheet_index,
        "shots": [
            {k: v for k, v in shot.items() if k not in ("thumb",)}
            for shot in prepared
        ],
    }
    (WEB / "catalog.json").write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (WEB / "catalog.csv").write_text((OUT / "catalog.csv").read_text(encoding="utf-8-sig"), encoding="utf-8")
    (WEB / "catalog.md").write_text((OUT / "catalog.md").read_text(encoding="utf-8"), encoding="utf-8")

    readme = [
        f"# 事务助手 {data['app']['version']} 界面目录（供网页端 GPT 审阅）",
        "",
        "## 上传顺序建议",
        "",
        "1. 先上传 `catalog.md`（纯文字：每屏的进入路径、数据前提、画面元素）。",
        f"2. 再上传 `web/contact-sheets/sheet-01.png` … `sheet-{len(sheets):02d}.png`（每张 9 屏，图上有 `#编号` 与标题，可与文字逐条对应）。",
        "3. 需要放大看细节时，按编号上传 `web/shots/<编号>.png`。",
        "",
        f"- 最小上传集（约 7 MB）：`catalog.md` + {len(sheets)} 张联系表，已覆盖全部 {len(prepared)} 屏。",
        "- 整包：`ui-catalog-0.2.16-web.zip`（含单屏图，约 40 MB）；原始分辨率原图在 `shots/` 与 `shots-transparent/`。",
        f"- 截图总计：{len(prepared)} 张；联系表：{len(sheets)} 张。",
        f"- 数据来源：隔离数据库，未使用正式数据；采集时设备缩放 {data['display']['dpr']}×。",
        "- `shots/` 与 `shots-transparent/` 是未压缩原图；`web/` 下的图片已按宽度 1400px 压缩并把透明背景铺成棋盘格，便于审阅。",
        "",
        "## 文件",
        "",
        "| 文件 | 内容 |",
        "| --- | --- |",
        "| `catalog.md` | 全量文字注释（分组，含相对图片链接） |",
        "| `catalog.csv` | 同上，表格形式 |",
        "| `catalog.json` | 同上，结构化数据（含联系表分组） |",
        "| `web/contact-sheets/sheet-NN.png` | 每张 9 屏的联系表，带编号与标题 |",
        "| `web/shots/<id>.png` | 单屏截图（宽度 ≤1400px） |",
        "| `shots/<id>.png` | 单屏截图原始分辨率 |",
        "| `shots-transparent/<id>.png` | 桌宠 / 气泡 / 迷你面板 / 悬停提示的透明窗口原图 |",
    ]
    (OUT / "README.md").write_text("\n".join(readme).rstrip() + "\n", encoding="utf-8")

    print(json.dumps({"shots": len(prepared), "sheets": len(sheets), "out": str(OUT)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
