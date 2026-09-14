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
 *   Together: collapsed 176×44（+8 给中文字形余量）/ hover 220×50
 *   Solo:     collapsed 124×44 / hover 196×50
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
    small: { width: 204, height: 54 },
    medium: { width: 220, height: 54 },
    large: { width: 240, height: 56 },
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
