# YD 品牌系统

YD / Your Day —— `your day, quietly organized.`
本地日程中枢：本地优先、离线可用、安静陪伴的 Windows 桌面日程产品。

## 1. 名称层级

| 层级 | 内容 | 使用场合 |
| --- | --- | --- |
| 主名 | YD | 应用名、窗口标题、托盘、安装包、快捷方式 |
| 副名 | Your Day | 标题栏、锁屏 / 首屏、副标题 |
| 品牌短句 | your day, quietly organized. | 关于页、说明文档、发行说明 |
| 中文功能描述 | 本地日程中枢 | 侧栏品牌区、设置页与帮助文案 |

## 2. 标志

主形 = **软方徽记（96×96 圆角 22）+ YD 联结字标**。

- 字标由参数推导（笔画宽度 / 字面高度 / 字距），两个尺寸档位共用同一套比例：
  - `large`（≥32px）：笔画 10、字面 62×48；
  - `small`（16–24px）：笔画 13、字面更满，保证小尺寸不糊。
- 徽记内圈有一条 1.1px 的极浅高光描边，只在大尺寸可见，属于「克制的质感」。

### 变体

| 文件 | 用途 |
| --- | --- |
| `exports/svg/yd-mark.svg` | 主标（深鼠尾草底 + 瓷白字标），SVG 主文件 |
| `exports/svg/yd-mark-small.svg` | 小尺寸专用字面（16–24px） |
| `exports/svg/yd-mark-porcelain.svg` | 浅底版（瓷白底 + 深绿字标） |
| `exports/svg/yd-mark-mono.svg` | 单色版（字标挖空，只需一种颜色） |
| `exports/svg/yd-mark-glyph.svg` / `-porcelain.svg` | 纯字标，用于水印与标题栏 |
| `exports/png/yd-16…512.png` | 多尺寸 PNG（≤24 用 small 字面） |
| `exports/png/yd-mono-*.png` | 单色 PNG |
| `exports/yd.ico` | Windows 程序图标（16/24/32/48/64/128/256 七层） |
| `exports/tray-32.png` | 任务栏 / 托盘（32px 光栅） |
| `exports/icon-256.png` / `icon-512.png` | 应用主图标 PNG |
| `explore/directions.png` | 方向探索与尺寸自检图（A 软方徽记 / B 字标优先 / C 圆徽记） |

### 尺寸与底色

- 桌面与安装包：深鼠尾草徽记在任何壁纸、任务栏明暗下都成立。
- 侧栏：浅底（暖雾白 `#FAF9F5 → #F2F0E9`）上用同款深绿徽记，字标为瓷白；纯单色场景用 `-mono` / `-porcelain` 变体。
- 托盘：使用 32px 图层，Windows 会按 DPI 缩放到 16/20/24，笔画仍可辨认。
- 最小可用尺寸 16px；低于 16px 请改用纯字标（`yd-mark-glyph`）。

## 3. 品牌图形语言

- **时间弧**：界面里的大圆环 / 圆弧，只作为极浅氛围层（3–9% 不透明度），不承载信息。
- **秩序线**：1px 暖灰分隔线与标题下的品牌短线（32×2px），用于建立层级。
- **水印**：空状态右下角与侧栏底部的徽记轮廓（4–5% 不透明度），不允许提高对比度。
- 装饰层统一放在会被裁剪的绝对定位容器里（`.page-atmosphere`），不得制造横向滚动。

## 4. 色彩 token

| Token | 值 | 用途 |
| --- | --- | --- |
| `--yd-brand` | `#2F4C3D` | 主色：徽记、主按钮、标题短线 |
| `--yd-brand-deep` | `#22382C` | 主色按下 / 深色文字 |
| `--yd-brand-soft` | `#E7EDE6` | 次按钮、图标底盘 |
| `--yd-sage` | `#7E9A87` | 中线、辅助点缀 |
| `--yd-accent` | `#A9838D` | 低饱和玫瑰灰，仅用于 Ta 与状态点缀 |
| `--yd-canvas` | `#F1EFE9` | 画布（暖雾白） |
| `--yd-surface` | `#FBFAF7` | 卡片纸面 |
| `--yd-line` | `#E3DFD5` | 极浅暖灰线 |
| `--yd-ink` | `#1F2521` | 文本主色（深墨绿灰，不用纯黑） |
| `--yd-muted` | `#6F766E` | 次级文字 |
| `--yd-sidebar` | `#FAF9F5` | 侧栏暖雾白（与标题栏同一浅色体系） |
| `--yd-sidebar-2` | `#F2F0E9` | 侧栏向下略深一档的层次色 |
| `--yd-sidebar-ink` | `#4E5850` | 侧栏正文（深墨绿灰中调） |
| `--yd-sidebar-active` | `rgba(47,76,61,.10)` | 侧栏选中胶囊底色 |

状态语义色（唯一来源 `src/companion-colors.ts`，任何界面同一语义必须同色）：

| 语义 | 颜色 |
| --- | --- |
| 空闲 calm | `#8CBE9E` |
| 即将开始 upcoming | `#D6AE6A` |
| 忙碌 busy | `#DE9A63` |
| 专注 focus | `#8FAED2` |
| 冲突 alert | `#C2726A` |
| 未知 neutral | `#A3ACB0` |

## 5. 字体与字距

- 中文：`Microsoft YaHei UI` / `PingFang SC`；拉丁与数字：`Segoe UI Variable Display / Text`，全部使用系统字体，离线可用。
- 字标 YD：字重 620、字距 `.18em`；副名 Your Day：小写字距 `.26em`，作为陪衬不再抢主名。
- 数字（时间、倒计时、周次）统一 `font-variant-numeric: tabular-nums`。

## 6. 资源重新生成

```text
npx electron scripts/brand-render.cjs
```

会重建 `brand/exports`（SVG / PNG / ICO）与 `brand/explore/directions.png`。
图标使用 Electron 离屏渲染在**真实像素尺寸**下光栅化，因此不需要 GPU，也不会出现“先出大图再缩”的模糊。
几何的唯一来源是 `scripts/brand-mark.mjs`；界面内联的徽记见 `src/ui/brand.ts`，两者坐标一致，改动时需同步。
