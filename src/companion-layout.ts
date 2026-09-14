// Companion window layout contract.
//
// The desk pet always lives in a fixed canvas: a stage for the character and a
// rail for the D / Y status dots. Window sizes are pure constants per mode and
// size, so nothing a character frame, a hover, a reminder or a state switch
// does can ever resize or shift the window. The main process uses these numbers
// to size the BrowserWindow and the renderer uses the same numbers (through CSS
// custom properties) to place the rail, which keeps both sides in sync.
import type { PetPreferences } from './live.ts';

export type CompanionSize = PetPreferences['size'];
export type CompanionMode = PetPreferences['mode'];

export const companionSizes: CompanionSize[] = ['small', 'medium', 'large'];

// Status rail under the character. It is part of the canvas, never an overlay:
// the sprite can never push it out of the window or cover it.
export const companionRail = {
  height: 32,
  gap: 4,
};

// 窗口四周的透明安全区：BrowserWindow 永远比人物本体大一圈，
// 教鞭 / 星星 / 太阳 / 伸懒腰的手臂不会被窗口边缘裁掉。
export const companionFrame = {
  padX: 14,
  padY: 14,
};

export const companionCharacter = {
  // 可见人物高度（DIP）。0.2.20 的新素材细节更多，因此整体收小一档，
  // 默认“中”档落在 150–190 CSS px 的建议区间内；三者都保持等比，
  // 窗口宽高比仍然等于素材画布宽高比。
  height: { small: 148, medium: 172, large: 200 } as Record<CompanionSize, number>,
  // 只保证状态条还能放下；人物本体宽度由素材比例决定，绝不等于窗口宽度。
  minWidth: 124,
};

/**
 * YD Dual Status Dock（Phase 2）：取代 legacy 黄色悬浮球的常驻状态牌。
 *
 * 2026-09-14 重建：字号固定，窗口 = **展开态画布**，默认态在画布内是一块更小的
 * 状态牌。也就是说窗口在 collapsed / hover 之间**从不改变尺寸**：
 *
 *   window   = hover 足迹（下图的宽 × 高）
 *   可见牌面 = window − 4px 阴影画布，右 / 下对齐
 *   collapsed 时向右下收拢，hover 时向左上生长
 *
 * 这样 hover 不会移动窗口、也不会改变指针与窗口的几何关系，从根上消除了
 * "resize 丢掉 mouseleave → 鼠标离开仍然放大"这类问题。尺寸取产品定义值：
 *
 *   Together: collapsed 184×44（牌面 176×36）/ hover 248×54（牌面 240×46）
 *   Solo:     collapsed 124×44（牌面 116×36）/ hover 196×54（牌面 188×46）
 *
 * hover 牌面比默认态宽，是因为第二行辅助信息必须**缩进到主状态内容区下方**并且
 * 完整显示（"还有 1 小时 30 分"），这条约束由 11px 文案反推出来，不随尺寸档变化。
 */
export const companionDock = {
  collapsed: {
    // 中档 = 产品基准 176 牌面（+8 阴影画布 = 184 窗口）。状态文字用 13px：
    // 「上课中 / 教研中 / 通勤中」这类三字状态在 81px 的列里完整显示且留有 6px 余量。
    small: { width: 176, height: 44 },
    medium: { width: 184, height: 44 },
    large: { width: 200, height: 46 },
  } as Record<CompanionSize, CompanionGeometry>,
  solo: {
    small: { width: 112, height: 44 },
    medium: { width: 124, height: 44 },
    large: { width: 132, height: 46 },
  } as Record<CompanionSize, CompanionGeometry>,
  expanded: {
    // 展开态宽度由**第二行文案**决定，而不是尺寸档：三档显示的信息量完全相同，
    // 所以 240px 牌面（含 4px 阴影画布 = 248 窗口）对三档都成立。
    // 这样第二行永远以完整句子出现，不会被 ellipsis 截断，也不会为了 hover 单独换字号。
    // 高度只比默认态高 10px：这是"双行胶囊"，不是 mini 详情页。
    small: { width: 248, height: 54 },
    medium: { width: 248, height: 54 },
    large: { width: 248, height: 56 },
  } as Record<CompanionSize, CompanionGeometry>,
  soloExpanded: {
    small: { width: 180, height: 54 },
    medium: { width: 196, height: 54 },
    large: { width: 212, height: 56 },
  } as Record<CompanionSize, CompanionGeometry>,
  /** 窗口四周留给 CSS 阴影的透明画布（牌面 = 窗口 − 8）。 */
  shadowCanvas: 8,
};

/**
 * 状态牌可见表面的尺寸契约（renderer 与主进程共用）：
 *   default = collapsed − shadowCanvas
 *   hover   = expanded  − shadowCanvas
 */
export function dockSurfaceMetrics(mode: CompanionMode, size: CompanionSize, people = 2): { defaultWidth: number; defaultHeight: number; hoverWidth: number; hoverHeight: number } {
  const collapsed = (people <= 1 ? companionDock.solo : companionDock.collapsed)[size];
  const expanded = (people <= 1 ? companionDock.soloExpanded : companionDock.expanded)[size];
  const pad = companionDock.shadowCanvas;
  return { defaultWidth: collapsed.width - pad, defaultHeight: collapsed.height - pad, hoverWidth: expanded.width - pad, hoverHeight: expanded.height - pad };
}

/**
 * 详情浮层的窗口尺寸：轻量 popover，不是一页 dashboard。
 * 卡片 = 窗口 − shadowCanvas；Solo 与 Together 各自独立配比（Solo 不是砍掉半边）。
 */
export const companionDetail = {
  /** 窗口 = 卡片 + 8px 阴影画布 + 10px 底部指示三角（尾部向下指回 Dock）。 */
  together: { width: 316, height: 152 + 10 },
  solo: { width: 276, height: 136 + 10 },
  shadowCanvas: 8,
  tail: 10,
} as const;

export function detailGeometry(people: number): CompanionGeometry {
  const size = people <= 1 ? companionDetail.solo : companionDetail.together;
  return { width: size.width, height: size.height, shape: 'rounded' };
}

/**
 * 合并式详情（0.3 Dock 收口）：详情不再是第二个 BrowserWindow，而是**同一个**
 * floating Dock 窗口在 detail 状态下的画布。这样详情天然跟随 Dock 的 topmost
 * 语义，不会出现"点开详情后被浏览器盖住"，也不再有第二个窗口与 Dock 抢层级。
 *
 *   detail 画布 = 详情卡 + 10px 间距 + 状态牌 + 四周 4px 阴影画布
 *
 * 牌面在屏幕上的右下角永远不动（见 dockDetailFrame），因此 collapsed → detail
 * → collapsed 的往返里 Dock 不会漂，动画只是画布内的展开。
 */
export const dockDetail = {
  /** 详情卡与状态牌之间的呼吸。 */
  gap: 10,
  /** 画布四周留给 CSS 阴影的透明区（4px/边，与牌面的阴影画布同一尺度）。 */
  pad: 4,
  /** 卡片尺寸：Together 是两张并排的 person card，Solo 是同一张卡的收窄版。 */
  together: { width: 460, height: 236 },
  solo: { width: 340, height: 218 },
} as const;

export function dockDetailPanel(people: number): { width: number; height: number } {
  return people <= 1 ? dockDetail.solo : dockDetail.together;
}

/** 详情画布：窗口矩形 + 状态牌 / 卡片在窗口内的偏移（都由主进程算好后交给渲染层）。 */
export interface DockDetailFrame {
  window: { x: number; y: number; width: number; height: number };
  /**
   * 状态牌命中区（牌面 + 4px 阴影画布）在窗口内的位置。
   *
   * 只给出"贴着哪两条边"以及贴边的距离：这两个数值和默认画布里完全一样，
   * 所以渲染层无论在新窗口还是旧窗口里渲染这一层，牌面的屏幕位置都一致 ——
   * 打开 / 收起详情时不可能看到牌面跳一下。
   */
  dock: { left?: number; top?: number; right?: number; bottom?: number; width: number; height: number };
  /** 详情卡在窗口内的位置。 */
  panel: { left: number; top: number; width: number; height: number };
  /** 卡片在牌面上方还是下方（屏幕边界决定）。 */
  placement: 'above' | 'below';
}

/**
 * 计算 detail 画布：输入当前 Dock 窗口矩形与所在显示器工作区，输出新的窗口矩形
 * 以及牌面 / 卡片在窗口内的偏移。纯函数，主进程与验收脚本共用。
 *
 * 不变量：牌面（collapsed 牌面）在屏幕上的右下角 = 传入 bounds 的右下角 − 4px，
 * 与 collapsed / hover 时的位置完全一致。
 */
export function dockDetailFrame(input: {
  people: number;
  size: CompanionSize;
  bounds: { x: number; y: number; width: number; height: number };
  area: { x: number; y: number; width: number; height: number };
}): DockDetailFrame {
  const surface = dockSurfaceMetrics('orb', input.size, input.people);
  const plate = { width: surface.defaultWidth, height: surface.defaultHeight };
  const pad = dockDetail.pad;
  const canvas = { width: input.bounds.width, height: input.bounds.height };
  // 牌面在默认画布里的偏移（collapsed 与 hover 共用同一个右下角锚点）。
  const plateLeft = canvas.width - pad - plate.width;
  const plateTop = canvas.height - pad - plate.height;
  const plateRect = {
    x: input.bounds.x + plateLeft,
    y: input.bounds.y + plateTop,
    width: plate.width,
    height: plate.height,
  };
  const plateRight = plateRect.x + plate.width;
  const plateBottom = plateRect.y + plate.height;
  const panelSize = dockDetailPanel(input.people);
  const areaRight = input.area.x + input.area.width, areaBottom = input.area.y + input.area.height;
  // 垂直：默认向上（详情在 Dock 上方）；上方放不下时向下展开；两侧都放不下（极端窄的
  // 可用区）时把卡片收回工作区，宁可压住牌面也不出屏。
  const aboveTop = plateRect.y - dockDetail.gap - panelSize.height;
  const belowTop = plateBottom + dockDetail.gap;
  let vertical: 'above' | 'below' | 'free' = 'above';
  let panelY = aboveTop;
  if (aboveTop < input.area.y) {
    if (belowTop + panelSize.height <= areaBottom) { vertical = 'below'; panelY = belowTop; }
    else { vertical = 'free'; panelY = Math.max(input.area.y, Math.min(aboveTop, areaBottom - panelSize.height)); }
  }
  // 水平：卡片默认挂在"牌面右边缘向左"（靠右的 Dock 向左收）；左边放不下时翻到
  // 牌面左边缘向右（靠左的 Dock 向右收），再放不下才允许画布自由生长。
  const canvasLeft = input.bounds.x;
  let horizontal: 'right' | 'left' | 'free' = 'right';
  let panelX = plateRight - panelSize.width;
  if (panelX < input.area.x) {
    const leftAligned = canvasLeft + pad;
    if (leftAligned + panelSize.width + pad <= areaRight) { horizontal = 'left'; panelX = leftAligned; }
    else { horizontal = 'free'; panelX = Math.max(input.area.x, Math.min(panelX, Math.max(input.area.x, areaRight - panelSize.width))); }
  }
  // 画布：与默认画布共享垂直 / 水平各一条边（上或下、左或右），另一条边由卡片撑开。
  const windowTop = vertical === 'below' ? input.bounds.y : vertical === 'above' ? panelY - pad : Math.min(plateRect.y, panelY) - pad;
  const windowBottom = vertical === 'above' ? input.bounds.y + canvas.height : panelY + panelSize.height + pad;
  const windowLeft = horizontal === 'left' ? input.bounds.x : horizontal === 'right' ? panelX - pad : Math.min(plateRect.x, panelX) - pad;
  const windowRight = horizontal === 'right' ? input.bounds.x + canvas.width : panelX + panelSize.width + pad;
  const dock: DockDetailFrame['dock'] = {
    width: plate.width + pad * 2,
    height: plate.height + pad * 2,
    ...(horizontal === 'right' ? { right: pad } : { left: horizontal === 'left' ? plateLeft : plateRect.x - windowLeft }),
    ...(vertical === 'above' ? { bottom: pad } : { top: vertical === 'below' ? plateTop : plateRect.y - windowTop }),
  };
  return {
    window: { x: windowLeft, y: windowTop, width: windowRight - windowLeft, height: windowBottom - windowTop },
    dock,
    panel: { left: panelX - windowLeft, top: panelY - windowTop, width: panelSize.width, height: panelSize.height },
    placement: vertical === 'below' ? 'below' : 'above',
  };
}

export interface CompanionGeometry {
  width: number;
  height: number;
  /** 窗口形状提示：rounded = Dual Status Dock；未设置 = 方角画布（桌宠）。 */
  shape?: 'rounded';
}

// Single source of truth for every companion window size.
export function companionGeometry(mode: CompanionMode, size: CompanionSize, aspect: number, people = 2, expanded = false): CompanionGeometry {
  if (mode === 'orb') {
    // 窗口永远是展开态足迹：默认牌面在画布内收拢，hover 只在画布内生长。
    const { width, height } = (people <= 1 ? companionDock.soloExpanded : companionDock.expanded)[size];
    return { width, height, shape: 'rounded' };
  }
  // Avatar Pack supplies the canvas ratio; window policy stays generic.
  const character = companionCharacter.height[size];
  const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : 0.68;
  const width = Math.max(companionCharacter.minWidth, Math.round(character * ratio) + companionFrame.padX * 2);
  const height = companionFrame.padY * 2 + character + companionRail.gap + companionRail.height;
  return { width, height };
}
