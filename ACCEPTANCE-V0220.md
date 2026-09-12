# YD 0.2.20 验收记录（桌宠十态、时间作息与稳定落点）

日期：2026-09-11 · 版本：`0.2.19 → 0.2.20` · 数据目录：`%APPDATA%\事务助手`（未改动、未迁移）

## 1. 交付物

| 项目 | 值 |
| --- | --- |
| 安装包 | `release\YD-Setup-0.2.20.exe`（128,507,627 字节，22:14:19，含十宫格素材 / 自绘菜单 / 放大图标） |
| SHA256 | `7D7236E13B1774501B747063C3178A0C60401BC9A1C3D55A5E0BFE3CFBD0CC4E` |
| 可执行文件版本 | `release\win-unpacked\YD.exe` · ProductVersion `0.2.20.0` · FileVersion `0.2.20` |
| app.asar | 41,444,568 字节，内含 `dist/assets/companion/custom/*` 十态素材（已有 10 / 缺 0） |
| 版本来源 | `package.json` / `package-lock.json` 均为 `0.2.20`（About 页展示品牌信息，不含独立版本号字段） |

## 2. 状态系统最终结构

```
src/companion-display.ts     显示态、时间计划、优先级解析、提醒时间线（主进程与渲染层共用）
src/companion-assets.ts      主进程读取素材清单 → data URL，缺帧只标记 missing
src/companion-frame.ts       共享契约 + 逐级回退（asset → fallbacks → idle → 内置 idle）
src/companion-layout.ts      窗口画布常量 + petSpriteTuning（每个姿态的 scale / offset）
src/companion-fallback-idle.ts  由脚本生成的同形象 idle 兜底帧
src/ui/companion.ts          桌宠窗口组件（PetStage → PetSprite）、设置页
src/ui/companion-custom.ts   帧解析、150ms 交叉淡入、拖动冻结
scripts/companion-assets.py  5×2 十宫格 / 旧 3×2 六格 → 十张独立透明 PNG
tests/companion.test.ts      状态、边界、优先级、迁移、素材回退、无猫检查
verify-v0220.cjs             真实 Electron + 虚拟时钟运行验收
verify-v0220-packaged.cjs    打包版素材 / 状态栏 / 拖动 / 设置页验收
```

## 3. 十态与素材映射

| 显示态 | 素材键 | 素材文件 | 触发 |
| --- | --- | --- | --- |
| `idle` | `idle` | idle.png | 双方空闲时的默认循环 |
| `upcoming` | `relaxed` | relaxed.png | 下一项 30 分钟内开始 |
| `busy_class` | `busy_class` | busy_class.png | Ta 正在上课 |
| `busy_work` | `busy_work` | busy_work.png | 教研 / 会议 / 活动进行中 |
| `reminder` | `reminder` | reminder.png | 有到时间未处理的提醒 |
| `gentle` | `happy` | happy.png | 刚下课 3 分钟内的轻庆祝 |
| `night_sleep` | `night_sleep` | night_sleep.png | 23:30–07:30（夜间自动睡觉开关开启） |
| `eating` | `eating` | eating.png | 11:30–12:00 |
| `nap` | `nap` | nap.png | 12:30–14:00 |
| `wake_up` | `wake_up` | wake_up.png | 07:30–07:50 |

## 4. 四段时间表（本机 LOCAL TIME，左闭右开）

| 状态 | 区间 | 边界行为 |
| --- | --- | --- |
| `night_sleep` | `[23:30,24:00) ∪ [00:00,07:30)` | 23:29 普通 → 23:30 睡觉；00:00 仍睡觉 |
| `wake_up` | `[07:30,07:50)` 与 `[14:00,14:20)` | 07:29 睡觉 → 07:30 刚睡醒 → 07:50 恢复；14:00 午睡结束同样先“刚睡醒” → 14:20 恢复 |
| `eating` | `[11:30,12:00)` | 11:29 普通 → 11:30 吃饭 → 12:00 恢复 |
| `nap` | `[12:30,14:00)` | 12:29 普通 → 12:30 午睡 → 14:00 交给刚睡醒 |

边界断言已逐分钟覆盖：`tests/companion.test.ts`（单元）与 `verify-v0220.cjs`（真实运行时 + 虚拟时钟）。

## 4.1 桌宠右键菜单（0.2.20 重做）

原生菜单无法沿用 YD 的字体、间距与配色，因此改成与主界面同一套语言的自绘菜单窗口（`#menu`）：

| 行 | 行为 |
| --- | --- |
| 打开 YD / 查看双方状态 | 与托盘、菜单栏入口一致 |
| 显示为桌宠 / 显示为悬浮球 | 单选，勾选当前样式，点一下即切换并重建窗口尺寸 |
| 暂停气泡提醒 1 小时（暂停中显示“恢复气泡提醒 · 已暂停”） | 动作行，不做勾选，避免“勾上=已暂停”的歧义 |
| 桌宠设置 | 打开设置页「桌面陪伴」 |
| 隐藏桌宠（右侧显示 Ctrl+Alt+Y） | 与托盘菜单、全局快捷键共用同一个开关 |
| 退出 YD | 危险操作，用告警色并走原有退出确认 |

- 菜单尺寸由 `src/companion-menu.ts` 的 `companionMenuMetrics` 决定（238×315），主进程与渲染层共用，
  不会出现“算的高度和渲染高度不一致”的错位；贴桌宠右侧展开，贴边自动翻到左侧。
- 关闭方式：点任意一行、点菜单外（窗口失焦）、按 Esc、桌宠被拖动或隐藏。

## 4.2 全局快捷键

- `Ctrl+Alt+Y`：一键隐藏 / 显示桌宠（托盘菜单、右键菜单、快捷键三处同一实现）。
- 注册失败（被其它程序占用）时不会假装可用：日志记 warning，菜单右侧不显示快捷键提示。
- 退出时 `globalShortcut.unregisterAll()`，不会残留系统级热键。

## 4.3 气泡功能评估（删除小猫后是否还有用）

结论：**仍然有用，保留**。理由是它与小猫桌宠没有依赖关系：

- 气泡是**唯一在桌面层**呈现「到时间提醒」的通道：主窗口收起后，托盘只提供悬停提示与菜单，
  系统通知又依赖 Windows 通知权限；气泡挂在桌宠窗口上，两种样式（桌宠 / 悬浮球）都能用。
- 触发链路与形象无关：`bubbleEvents()` 按提醒时间产生事件，主进程投递给气泡窗口；
  删除小猫只影响“画谁”，不影响“要不要提醒”。
- 本轮只改了表达方式：暂停 / 恢复仍是一小时的动作，不再画勾选；暂停时设置页与菜单都会说清楚。

## 4.4 任务栏与托盘图标放大

母版里的图标只占画布 76%、托盘字标只占 53–58%，Windows 按整张画布排布，所以 YD 看起来比相邻应用小一圈。
`scripts/brand-raster-exports.py` 现在先按 alpha≥24 取内容外接框（忽略个位数 alpha 的柔光），再补很小的安全边距：

| 资源 | 之前内容占比 | 现在 |
| --- | --- | --- |
| 任务栏 / 桌面 / 安装包图标（yd.ico、icon-256/512、yd-16…512） | 0.76 | 0.91–0.94 |
| 托盘字标（tray-16 / 24 / 32） | 0.53–0.58 | 0.88–0.94 |

`dist/icon.png` 与 `dist/tray.png` 在 `npm run build` 时从同一份导出复制，界面内外不会再出现两个版本。

## 5. 状态优先级

1. 短暂用户交互反馈 / 一次性动画（点击、拖动冻结换帧、提醒轻提示）
2. 业务临时状态：上课 / 教研 / 会议 / 活动 / 刚下课庆祝
3. 到点未处理的提醒（保持窗口内始终置顶）
4. 时间计划状态：`night_sleep` / `wake_up` / `eating` / `nap`
5. 普通 `upcoming` / `idle`

夜间睡觉不会被空闲或普通装饰状态顶掉；进行中的安排与到点提醒仍然优先（验收已覆盖）。

## 6. 小猫桌宠删除清单

- `src/ui/companion.ts`：删除小猫 SVG 形象 `PetArt`、`busy` 徽章、`.pet-labels` 分支与三选一模式里的「小猫桌宠」。
- `src/companion-layout.ts`：删除 `companionCat` 画布常量与 `mode==='pet'` 几何分支。
- `src/companion-assets.ts`：文案与逻辑不再“回退到小猫桌宠”，缺帧只标记 missing。
- `src/live.ts` / `src/core.ts`：`PetPreferences.mode` 收敛为 `'custom' | 'orb'`，旧 `'pet'` 配置由 `migrateLive` 迁移到默认形象；设置命令里的 `'pet'` 请求统一落到默认形象。
- `src/main.ts`：删除“素材不可用 → 切回小猫”分支与 0.2.15 的自动切换分支。
- `src/ui/style.css`：删除 `.pet-art` / `.pet-art.animated` / `.pet-labels` / `.pet-count` / `breathe` / `blink` 规则。
- 测试与脚本：`tests/companion.test.ts` 新增“没有猫的形象、几何或素材”断言；`runtime-audit.cjs`、`ui-catalog.cjs`、`verify-*` 同步更新；`README.md`、`DESKPET_IMAGE_PROMPT.md` 改写。
- 旧的 `sleeping.png` 素材由脚本清理，改为 `night_sleep.png`。

## 7. 素材处理

- 正式素材 `artwork/companion/custom/character-sheet.png`（1983×793 透明 PNG，5 列 × 2 行）已接入；
  旧的 0.2.15 六格合集、设定图与 `sleeping.png` 移入 `artwork/companion/legacy-0215/` 留档，不再参与生成。
- `scripts/companion-assets.py` 的拆分方式：先按列切片，再在“上下两排贴在一起”的水平接缝带里取
  覆盖像素最少的一行作为切分线（十宫格同一列的脚跟与头发常常挨在一起，纯连通域会把两格连成一团），
  最后做连通域找主体与装饰。切分线最多损失一两个像素，肉眼不可见。
- 归一化：站姿 / 坐姿按“头发顶 → 脚底”统一体型（基准 373px，来自最矮的一格，不放大失真）；
  躺下的午睡姿态不参与体型归一，改为整体等比放进同一画布；输出统一画布 **412×411**、
  脚底基线 **y=397**、共享水平锚点的十张独立透明 PNG + `manifest.json` + 同一形象 idle 兜底帧（200×200）。
- 运行期不再切图：`npm run build` 只把 `src/ui/assets` 复制到 `dist/assets`，桌宠窗口启动后一次性解码全部素材。
- 素材缺失时逐级回退（缺帧 → 相近动作 → idle → 内置 idle），不会再回到已删除的小猫。

## 8. 换动作不跳动的做法

- 窗口是固定画布：`透明安全区 28 + 可见人物 + 间隙 4 + 状态条 32`（小 / 中 / 大 = 212 / 236 / 264 DIP）。
- `PetStage` 固定尺寸，`PetSprite` 使用 `object-fit: contain` + `object-position: center bottom`（底边中点锚点）。
- 每个姿态只允许很小的 `scale / offsetX / offsetY`，集中在 `src/companion-layout.ts` 的 `petSpriteTuning`；
  睡觉 / 午睡这类横向姿态只做 -2 ~ -3px 的落点修正，不会带跑窗口。
- 切换为 150ms 交叉淡入 + `.985 → 1` 轻微缩放；`prefers-reduced-motion` 下取消动画；
  拖动期间冻结换帧，松手后补上最新姿态。

## 9. 运行与测试结果

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 单元测试 | `npm test` | 108 通过 / 0 失败（含 4 段时间边界逐分钟断言、优先级、迁移、素材回退、无猫检查） |
| 类型检查 | `npx tsc --noEmit` | 通过 |
| 构建 | `npm run build` | `Build complete` |
| 运行审计 | `npx electron runtime-audit.cjs` | 全部通过（五窗口、桌宠姿态与素材、无猫残留、拖动、气泡、提醒不完成待办） |
| 桌宠专项 | `npx electron verify-v0220.cjs` | 全部通过（见下） |
| 打包版验收 | `node verify-v0220-packaged.cjs` | 27 项通过（打包版素材：已有 10，缺失 无） |

`verify-v0220.cjs` 关键结论：

- 十态素材清单「已有 + 缺失 = 10」，渲染层已解码随包素材，无猫素材 / 无猫文案。
- 仓库内素材解析结果：`missing: []`，十个显示态都能直接拿到自己的素材帧。
- 虚拟时钟下逐点验证：07:29 睡觉 / 07:30 刚睡醒 / 07:49 刚睡醒 / 07:50 恢复；
  11:29 普通 / 11:30 吃饭 / 11:59 吃饭 / 12:00 恢复；12:29 普通 / 12:30 午睡 / 13:59 午睡 / 14:00 恢复；
  23:29 普通 / 23:30 睡觉 / 23:59 睡觉 / 次日 00:00 睡觉。
- 优先级：进行中的会议压过午睡（`state=busy_work`、`scheduled=nap`），会议结束后回到午睡；
  到时间提醒压过时间状态（`state=reminder`、`base=nap`）且确认提醒不会完成待办，处理完回到午睡。
- 固定画布：换姿态时窗口外框位置与尺寸完全不变，`contain` + 底边中点锚点，切换动画 120–180ms。
- 右键菜单：独立自绘窗口、8 行 3 分隔、勾选当前样式、隐藏行显示 `Ctrl+Alt+Y`、瓷白卡片样式、
  高度与模型一致；从菜单切到悬浮球再切回桌宠、隐藏后重新显示、Esc 收起全部通过。
- 全局快捷键 `Ctrl+Alt+Y` 已注册（`globalShortcut.isRegistered` 断言通过）。

## 10. 仍存在的真实风险 / 限制

1. 时间状态按**本机时区**判断（用户明确要求）。机器时区不是北京时间时，桌宠作息跟随系统本地时间，
   而应用内其它时间文案仍按北京时间显示。
2. 像素风格素材按需求只做预留，本轮没有引入任何主题切换 UI。
3. 午睡是唯一的横向姿态：它按“整体等比放进画布 + 底边对齐”处理，宽度比站姿更宽，
   视觉重心更低；这是原始素材的构图决定的，不是缩放失真。
4. 本轮未改动安装好的桌面程序：只生成并验证了 `release\YD-Setup-0.2.20.exe`，
   是否覆盖安装由用户决定。
