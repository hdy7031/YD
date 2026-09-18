// Companion window layout contract.
//
// The desk pet always lives in a fixed canvas: a stage for the character and a
// rail for the D / Y status dots. Window sizes are pure constants per mode and
// size, so nothing a character frame, a hover, a reminder or a state switch
// does can ever resize or shift the window. The main process uses these numbers
// to size the BrowserWindow and the renderer uses the same numbers (through CSS
// custom properties) to place the rail, which keeps both sides in sync.
import type { AvatarFrameGeometry, AvatarVisualBounds } from './avatar.ts';
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

/**
 * Map the pack's alpha-content bounds into a contain-fit companion stage.
 * The returned rectangle is local to the stage and is used only for pointer
 * hit testing; the rendered image remains the original full transparent canvas.
 */
export function companionInteractionRect(input: {
  container: { width: number; height: number };
  canvas: { width: number; height: number };
  visualBounds: AvatarVisualBounds;
  geometry?: AvatarFrameGeometry;
}): { left: number; top: number; width: number; height: number } | undefined {
  const { container, canvas, visualBounds } = input;
  if (!(container.width > 0 && container.height > 0 && canvas.width > 0 && canvas.height > 0)) return undefined;
  const scale = Math.min(container.width / canvas.width, container.height / canvas.height);
  const drawnWidth = canvas.width * scale;
  const drawnHeight = canvas.height * scale;
  const imageLeft = (container.width - drawnWidth) / 2;
  // The production image uses object-position: center bottom.
  const imageTop = container.height - drawnHeight;
  const frameScale = input.geometry?.scale ?? 1;
  const offsetX = input.geometry?.offsetX ?? 0;
  const offsetY = input.geometry?.offsetY ?? 0;
  const originX = container.width / 2;
  const originY = container.height;
  const left = originX + (imageLeft + visualBounds.x * scale - originX) * frameScale + offsetX;
  const top = originY + (imageTop + visualBounds.y * scale - originY) * frameScale + offsetY;
  return {
    left,
    top,
    width: visualBounds.width * scale * frameScale,
    height: visualBounds.height * scale * frameScale,
  };
}

export const companionCharacter = {
  // 可见人物高度（DIP）。0.2.20 的新素材细节更多，因此整体收小一档，
  // 默认“中”档落在 150–190 CSS px 的建议区间内；三者都保持等比，
  // 窗口宽高比仍然等于素材画布宽高比。
  height: { small: 148, medium: 172, large: 200 } as Record<CompanionSize, number>,
  // 只保证状态条还能放下；人物本体宽度由素材比例决定，绝不等于窗口宽度。
  minWidth: 124,
};

/**
 * YD Dual Status Dock 的尺寸契约。
 *
 * 2026-09-15 重建：牌面宽度**由内容决定** —— 渲染层测量真实的文字宽度后回报，
 * 主进程照此定窗口尺寸。因此「今天下午有课」这类稍长状态不会被省略号吞掉，
 * 左右两侧也不再强求 50/50。
 *
 *   window   = 牌面 + 4px 阴影画布（四周），牌面右 / 下对齐
 *   牌面高度 = 54–60（产品口径，三档 54 / 56 / 58）
 *   牌面宽度 = max(最小宽度, 默认态内容宽度, hover 内容宽度)，上限见 maxWidth
 *
 * 牌面右下角在屏幕上是固定的，所以 hover、状态变化、测量结果更新都只向左 / 上生长；
 * 窗口在 collapsed / hover 之间仍然**不改变尺寸**，不会把指针与窗口的几何关系搅乱。
 */
export const companionDock = {
  /** 牌面高度（可见胶囊，DIP）。 */
  height: { small: 54, medium: 56, large: 58 } as Record<CompanionSize, number>,
  /** Together 的最小牌面宽度：三字状态 + 两枚人名首字母也要像一块状态牌。 */
  minWidth: { small: 172, medium: 180, large: 188 } as Record<CompanionSize, number>,
  /** Solo 是收窄的一等形态，不是砍掉半边。 */
  soloMinWidth: { small: 150, medium: 158, large: 166 } as Record<CompanionSize, number>,
  /** 兜底上限：只有自定义超长状态才用得上（先缩字号，最后才允许 ellipsis）。 */
  maxWidth: 620,
  /** 超过这个宽度就切到 14.5px 的状态字号（第二层降级）。 */
  compactAt: 430,
  /** 超长文本第二层降级后的状态字号。 */
  compactStatus: 14.5,
  /**
   * 每个尺寸档的排版：首字母是人物视觉锚点（受控 serif，明显高于状态词），
   * 状态词与状态点是一组，左右内边距取产品口径 18–22。
   */
  type: {
    small: { letter: 20, status: 15, padding: 18 },
    medium: { letter: 22, status: 16, padding: 20 },
    large: { letter: 24, status: 16.5, padding: 22 },
  } as Record<CompanionSize, { letter: number; status: number; padding: number }>,
  /** 窗口四周留给 CSS 阴影的透明画布（牌面 = 窗口 − 8）。 */
  shadowCanvas: 8,
};

/** 渲染层测量出来的自然宽度（DIP）。 */
export interface DockMeasure { collapsed: number; hover: number }

export interface DockSurfaceMetrics {
  /** 默认态牌面 */
  defaultWidth: number;
  defaultHeight: number;
  /** 展开（hover）态牌面：高度与默认态相同，宽度不小于默认态。 */
  hoverWidth: number;
  hoverHeight: number;
  /** 窗口尺寸（= 牌面 + 阴影画布） */
  canvasWidth: number;
  canvasHeight: number;
}

/**
 * 状态牌可见表面的尺寸契约（renderer 与主进程共用）。
 * measure 为渲染层测得的自然宽度；缺省时退回最小宽度（首帧、无内容时）。
 */
export function dockSurfaceMetrics(size: CompanionSize, people = 2, measure?: DockMeasure): DockSurfaceMetrics {
  const height = companionDock.height[size];
  const minWidth = (people <= 1 ? companionDock.soloMinWidth : companionDock.minWidth)[size];
  const clamp = (value: number | undefined) => Number.isFinite(value) && (value as number) > 0
    ? Math.max(minWidth, Math.min(companionDock.maxWidth, Math.ceil(value as number)))
    : minWidth;
  const defaultWidth = clamp(measure?.collapsed);
  const hoverWidth = Math.max(defaultWidth, clamp(measure?.hover));
  const pad = companionDock.shadowCanvas;
  return {
    defaultWidth,
    defaultHeight: height,
    hoverWidth,
    hoverHeight: height,
    canvasWidth: Math.max(defaultWidth, hoverWidth) + pad,
    canvasHeight: height + pad,
  };
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
  /** 当前可见牌面尺寸（由 dockSurfaceMetrics 决定，随内容测量结果变化）。 */
  plate: { width: number; height: number };
  bounds: { x: number; y: number; width: number; height: number };
  area: { x: number; y: number; width: number; height: number };
}): DockDetailFrame {
  const plate = input.plate;
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
  // 牌面可能比卡片还宽（长状态 + 窄卡片），因此两条边都要保证画布**装得下牌面**。
  const windowTop = vertical === 'below' ? input.bounds.y
    : vertical === 'above' ? Math.min(panelY - pad, plateRect.y - pad)
    : Math.min(plateRect.y, panelY) - pad;
  const windowBottom = vertical === 'above' ? input.bounds.y + canvas.height
    : Math.max(panelY + panelSize.height, plateBottom) + pad;
  const windowLeft = horizontal === 'left' ? input.bounds.x
    : horizontal === 'right' ? Math.min(panelX - pad, plateRect.x - pad)
    : Math.min(plateRect.x, panelX) - pad;
  const windowRight = horizontal === 'right' ? input.bounds.x + canvas.width
    : Math.max(panelX + panelSize.width, plateRight) + pad;
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
export function companionGeometry(mode: CompanionMode, size: CompanionSize, aspect: number, people = 2, expanded = false, measure?: DockMeasure): CompanionGeometry {
  if (mode === 'orb') {
    // 窗口 = 牌面（按渲染层测得的自然宽度）+ 阴影画布；collapsed 与 hover 共用同一尺寸，
    // 所以 hover 不会改变窗口、也不会改变指针与窗口的几何关系。
    const metrics = dockSurfaceMetrics(size, people, measure);
    return { width: metrics.canvasWidth, height: metrics.canvasHeight, shape: 'rounded' };
  }
  // Avatar Pack supplies the canvas ratio; window policy stays generic.
  const character = companionCharacter.height[size];
  const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : 0.68;
  const width = Math.max(companionCharacter.minWidth, Math.round(character * ratio) + companionFrame.padX * 2);
  const height = companionFrame.padY * 2 + character + companionRail.gap + companionRail.height;
  return { width, height };
}
