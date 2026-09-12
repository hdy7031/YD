# YD 品牌素材提示词（0.2.18 · 金底主图标母版）· 已完成接入

> **状态（2026-09-11）**：11 张素材已由你在聊天里按顺序交付并全部落盘到
> `src/ui/assets/gen/`，接入与出包已完成，验收记录见 `ACCEPTANCE-V0218.md`。
> 本文件保留作为母版参数与后续补图的提示词来源。
>
> | 素材 | 落盘文件 | 接入位置 |
> | --- | --- | --- |
> | 透明底主图标 | `01-app-icon-transparent.png` | 侧栏品牌锚点、`brand/exports` 图标源 |
> | 深金托盘字标 | `03-tray-mark.png` | 标题栏字标、关于页、`tray-32.png` 源 |
> | 纯白托盘字标 | `03b-tray-mark-white.png` | 深色任务栏备用 |
> | 背景纹样 | `04-bg-monogram-pattern.png` | 侧栏水印（`mask` 渐隐 + multiply） |
> | 首页氛围层 | `05-hero-atmosphere.png` | `.page-atmosphere` 右上角 |
> | lockup | `06-lockups.png` | 品牌参考（文档/外部物料） |
> | 标语 | `07-tagline.png` | 品牌参考（文档/外部物料） |
> | 空状态线描 | `08-empty-today.png` | 「今日日程」空状态插图 |
> | Ta 标识 | `09-mark-ta.png` | 品牌备用点缀 |
> | 卡片微纹样 | `10-card-watermark.png` | 「接下来」卡片右上角（≤4%） |
> | 关于页封面 | `11-cover-about.png` | 设置页「关于」区块封面 |

主图标定稿（黄底版）：`brand/source/yd-app-icon-master.png`
（上一版绿底母版留档在 `brand/source/yd-app-icon-master-green-v1.png`）。

下面每一项素材都以这张图为参考图派生：生图时把母版一起上传，提示词只写「保留什么、改什么」。

## 0. 母版实测参数（提示词里直接引用）

| 项目 | 值 |
| --- | --- |
| 画布 | 1254×1254，白底（需要透明见第 12 项） |
| 底砖 | squircle，砖边长 ≈ 958px ≈ 画布 76%，四周留白 ≈ 12% |
| 圆角 | ≈ 砖边长 21%（约 200px），无描边 |
| 底砖金 | 自上而下柔和渐变：顶部 `#FDD965` → 中部 `#FBCF51` → 底部 `#F6C747`（均值 ≈ `#FAD154`） |
| 字标色 | 近白 `#FBFAFA`（落纸后与 `#FCFCFB` 等效） |
| 笔画 | 圆头、等宽，粗细 ≈ 砖边长 10%（958px 砖 ≈ 96px 笔画） |
| 字形 | Y 与 D **共用一条竖笔**：左臂自左上斜下汇入竖笔，右臂自右上折下接入同一竖笔；D 的圆弧贴竖笔右侧展开，底部回勾一段短横 |

由母版派生的界面用色（接入时会把 `src/ui/style.css` 的 token 对齐到这组）：

| 角色 | 色值 | 用途 |
| --- | --- | --- |
| 品牌金 | `#F5C948` | 品牌点缀、状态点、选中态、进度轨 |
| 品牌金浅 | `#FBE6A8` | 浅底强调、hover |
| 品牌深金 | `#8A6A16` | 需要文字的场合（≥4.5:1 对比） |
| 冷雾白画布 | `#F0F3F2` | 界面底（**保持不变，不铺暖黄底**） |
| 纯白卡片 | `#FFFFFF` | 内容面 |
| 文字深石墨 | `#1B201E` | 正文与标题 |
| 玫瑰灰 | `#A2848C` | 仅「Ta」相关小面积点缀 |

## 通用要求（每条提示词都带上）

- **参考图**：`yd-app-icon-master.png` 作为唯一参考，字形结构不得改动。
- **不变量**：squircle 形状与圆角比例、金底渐变方向与色值、近白字标、
  Y 与 D 共用竖笔的字形、笔画粗细与圆头语言。
- **可变量**：载体（带底砖 / 只留字标）、尺寸、是否单色、透明度、构图角度。
- **禁止**：把金色铺成大面积底色、高饱和橙色、奶油/米黄纸感、紫金渐变的"土豪金"、
  霓虹光效、AI 光晕、写实 3D、投影、卡通、情侣/少女风、教育/医疗/炒股软件感、
  除 YD 外的任何文字、水印、边框、样机。

---

## 上传顺序（生成完按这个顺序贴进聊天框即可）

我按序号落盘到 `src/ui/assets/gen/`，不需要你保存到本地。不想生成的项，直接说「跳过 N」。

| # | 文件 | 内容 |
| --- | --- | --- |
| 1 | `01-app-icon-transparent.png` | 透明底主图标 |
| 2 | `03-tray-mark.png` | 托盘字标 · 深金 |
| 3 | `03b-tray-mark-white.png` | 托盘字标 · 纯白 |
| 4 | `04-bg-monogram-pattern.png` | 主区背景水印纹样 |
| 5 | `05-hero-atmosphere.png` | 首页氛围层 |
| 6 | `06-lockups.png` | 品牌锁定组合 |
| 7 | `07-tagline.png` | 标语艺术字（可跳过） |
| 8 | `08-empty-today.png` | 空状态线描 |
| 9 | `09-mark-ta.png` | Ta 抽象标识 |
| 10 | `10-card-watermark.png` | 卡片微纹样（可跳过） |
| 11 | `11-cover-about.png` | 关于页封面（可跳过） |

---

## 1. 透明底主图标

> English: Same image as the reference, but with the white background removed: identical
> squircle tile, identical gold gradient (#FDD965 at the top, #FBCF51 in the middle, #F6C747 at
> the bottom), identical near-white #FBFAFA YD ligature with round caps and the same stroke
> weight (about 10% of the tile side). Transparent outside the tile, crisp clean edges, no halo,
> no shadow, no extra elements.

> 中文：只把白底抠透明，底砖、金色渐变、字标形状与笔画比例全部保持原样，边缘干净无光晕。

## 2 / 3. 托盘字标（16 / 20 / 24px）

- 用途：右下角托盘、最小化驻留。**只取母版里的字标，不要底砖。** 512×512，透明底。

> English: Using the reference icon's monogram only (no tile): extract the exact YD ligature —
> Y and D sharing one vertical stem — and redraw it as a single flat color mark, stroke weight
> about 11% of the image side so it stays legible at 16–24px, round caps and joins, centered
> with generous padding, fully transparent background, no tile, no outline, no shadow, no glow,
> no text. Produce two versions: (a) deep gold #8A6A16 for light taskbars, (b) pure white for
> dark taskbars.

> 中文：只取母版 YD 字标（不带底砖），单一颜色、笔画约画面 11%、透明底居中留白，出两版：
> 深金 `#8A6A16`（浅色任务栏）与纯白（深色任务栏）。

## 4. 主区背景水印纹样（可平铺）

- 2048×2048 无缝平铺，冷雾白底，接入不透明度 4%–6%。

> English: Using the reference icon's monogram as the only motif, build a seamless tileable
> pattern: the YD ligature repeated on a 6×6 grid with generous negative space, single ink color
> #8A6A16 at 5% opacity on a cool off-white #F0F3F2 ground, perfectly flat, same stroke weight
> ratio as the reference, no tile squares, no shadow, no noise, no gradient, no text, tileable.

> 中文：只用母版 YD 字标做母题，冷雾白 `#F0F3F2` 底上 5% 不透明度的深金 `#8A6A16` 无缝平铺，
> 6×6 网格、大量留白、纯平面无噪点。

## 5. 首页氛围层（时间弧 + 轻雾）

- 1600×1200，透明底。

> English: Using the reference icon only for color and stroke language: two concentric 1px
> hairline arcs drawn from the upper-right corner as if a large clock face were partially
> off-canvas — inner arc #F5C948 at 12% opacity, outer arc #8A6A16 at 8% opacity — plus an almost
> invisible horizontal mist fading from transparent to a 5% gold tint across the lower half.
> Transparent background, crisp geometry, no glow, no blur, no gradient stroke, no texture, no text.

> 中文：沿用母版的金与细线语言：两条 1px 同心弧从右上角出画（内 #F5C948 12%、外 #8A6A16 8%），
> 下半部叠一层几乎看不见的 5% 金调轻雾，透明底。

## 6. 品牌锁定组合 lockup

- 2400×900 与 1600×1600，透明底，文字用 `#1B201E`，图形用母版字标。

> English: Using the reference icon's YD monogram shape as the graphic half, compose three
> minimal lockups on transparency: (a) the monogram alone in #C79A16; (b) monogram + the line
> "Your Day" in a neutral grotesque sans at 60% of the mark height, letter-spaced +0.22em,
> color #1B201E; (c) monogram + "your day, quietly organized." on one line at 42% height,
> +0.16em, #1B201E. Keep the monogram's proportions exactly; no italics, no script, no gradient,
> no shadow, no box, no extra words.

> 中文：用母版字标做图形部分，三款锁定组合：① 字标单独；② 字标 + "Your Day"；
> ③ 字标 + "your day, quietly organized."（全小写、宽字距、#1B201E）。字形比例不改。

## 7. 标语艺术字（可跳过）

> English: A restrained one-line typographic treatment of "your day, quietly organized." in a
> single weight neutral grotesque sans, all lowercase, generous tracking, pure #1B201E on
> transparency; match the visual weight of the reference icon's stroke language; no flourish,
> no underline, no script, no gradient, no glow, no icon, no box.

> 中文：产品语的一极简单行排版：单一字重、全小写、宽字距、纯 #1B201E、透明底，无装饰。

## 8. 空状态线描（今日无安排）

- 800×600，透明底，沿用母版笔画语言。

> English: A minimal single-weight line drawing in the reference icon's stroke language
> (round caps, even weight, geometry-first): one rounded calendar outline with one thin timeline
> thread passing through it and coming to rest on a small filled dot. Stroke weight about 10% of
> the drawing's short side, color #C79A16 at 40% opacity, one accent dot #A2848C at 60%,
> transparent background, flat, no fill, no shadow, no text, no numbers, no people.

> 中文：母版笔画语言的空日程单线稿：圆角日历轮廓 + 一条细时间线停在小圆点上；
> 线 #C79A16 40%、小点 #A2848C 60%，透明底、纯平面、无文字无数字。

## 9.「Ta」的抽象标识

- 512×512，透明底，与母版同一套笔画语言，只换颜色。

> English: One abstract form in the reference icon's stroke language — a soft open circle with a
> quiet orbit line — drawn with round caps, stroke weight matching the reference (about 10% of
> the frame), single color low-saturation rose grey #A2848C, centered on transparency with
> generous padding, flat, no face, no person, no heart, no couple imagery, no text.

> 中文：同笔画语言的抽象开口圆与轨道线，圆头、粗细对齐母版，单色玫瑰灰 #A2848C，透明底居中留白。

## 10. 卡片微纹样（可跳过）

> English: Take the reference icon's monogram, scale it up so it bleeds off one corner, keep only
> three or four of its strokes visible in that corner, single ink color #C79A16, fully
> transparent background, no tile, no repetition, flat, no glow, no shadow.

> 中文：把母版字标放大到出血，只留角落三四笔，单色 #C79A16、透明底。

## 11. 关于页 / 设置页封面（可跳过）

> English: An editorial still life built around the reference icon: the exact YD squircle tile
> resting at a slight angle on a cool off-white #F0F3F2 surface, one 1px hairline arc drawn
> beside it, one folded paper edge for depth, soft daylight, minimal shadow. Keep the tile
> geometry, the gold gradient and the #FBFAFA monogram unchanged; no props, no text, no extra logos.

> 中文：以母版底砖为主角的静物式封面：略倾斜放在 #F0F3F2 纸面上，旁边一条 1px 细弧线 +
> 一处折纸边，柔光极浅影；底砖、金色渐变与字标必须与母版一致，无道具无文字。

---

## 我拿到图之后的接入清单

1. 主图标：用母版导出 `brand/exports/yd.ico`（16/20/24/32/48/64/128/256）、`icon-256.png`、
   `icon-512.png`、`tray-32.png`；`package.json` 的 `win.icon` 已指向 `brand/exports/yd.ico`。
2. 界面：把 `bg-monogram-pattern`（≤6%）、`hero-atmosphere`（≤12%）、`empty-today`、
   `card-watermark`（≤4%）接进对应容器；`src/ui/brand.ts` 换成母版字形。
3. 配色：`src/ui/style.css` 的品牌 token 对齐到金系（`#F5C948` / `#FBE6A8` / `#8A6A16`），
   画布保持冷雾白，**不铺暖黄底**。
4. 全接完跑一遍截图验收，再出 `YD-Setup-0.2.18.exe` 并覆盖安装。
