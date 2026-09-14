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
 * 字号固定，窗口按 1–2 行状态取尺寸；单人工作区把两行折成一行，
 * 但窗口尺寸不随状态或行数变化（拖动与热区必须稳定）。
 * 具体像素按实际字体与 DPI 取整，落在产品定义的建议区间内：
 * 默认与 hover 共用同一外框；hover 只在固定画布内显露第二行信息。
 */
export const companionDock = {
  collapsed: {
    small: { width: 248, height: 54 },
    medium: { width: 276, height: 58 },
    large: { width: 304, height: 62 },
  } as Record<CompanionSize, CompanionGeometry>,
  solo: {
    small: { width: 148, height: 54 },
    medium: { width: 164, height: 58 },
    large: { width: 180, height: 62 },
  } as Record<CompanionSize, CompanionGeometry>,
  expanded: {
    small: { width: 248, height: 54 },
    medium: { width: 276, height: 58 },
    large: { width: 304, height: 62 },
  } as Record<CompanionSize, CompanionGeometry>,
  soloExpanded: {
    small: { width: 148, height: 54 },
    medium: { width: 164, height: 58 },
    large: { width: 180, height: 62 },
  } as Record<CompanionSize, CompanionGeometry>,
  /**
   * Hover 时可见牌面向上的生长量（参考稿里 hover 的牌面比默认高约 1.4×）。
   * 窗口尺寸 = 默认牌面 + 生长量 + 8px 阴影画布，**窗口本身永远不变**：
   * 生长完全发生在画布内部，底边固定，因此不会产生几何漂移。
   */
  grow: { small: 18, medium: 20, large: 22 } as Record<CompanionSize, number>,
  soloGrow: { small: 11, medium: 12, large: 14 } as Record<CompanionSize, number>,
};

/**
 * 状态牌可见表面的尺寸契约（renderer 与主进程共用）：
 *   default = 窗口 − 4px 边距
 *   hover   = default + grow
 */
export function dockSurfaceMetrics(mode: CompanionMode, size: CompanionSize, people = 2): { defaultHeight: number; hoverHeight: number } {
  const family = people <= 1 ? companionDock.solo : companionDock.collapsed;
  const grow = people <= 1 ? companionDock.soloGrow[size] : companionDock.grow[size];
  const defaultHeight = family[size].height - 8;
  return { defaultHeight, hoverHeight: defaultHeight + grow };
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
    const family = people <= 1
      ? (expanded ? companionDock.soloExpanded : companionDock.solo)
      : (expanded ? companionDock.expanded : companionDock.collapsed);
    const { width, height } = family[size];
    // 窗口高度始终按 hover 状态预留：可见的默认牌面更矮，多出来的部分是透明画布。
    const grow = people <= 1 ? companionDock.soloGrow[size] : companionDock.grow[size];
    return { width, height: height + grow, shape: 'rounded' };
  }
  // Avatar Pack supplies the canvas ratio; window policy stays generic.
  const character = companionCharacter.height[size];
  const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : 0.68;
  const width = Math.max(companionCharacter.minWidth, Math.round(character * ratio) + companionFrame.padX * 2);
  const height = companionFrame.padY * 2 + character + companionRail.gap + companionRail.height;
  return { width, height };
}
