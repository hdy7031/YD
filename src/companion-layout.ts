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
 * collapsed 宽 120–170 / 高 52–68（小/中档），大档只放大一档呼吸感。
 */
export const companionDock = {
  collapsed: {
    small: { width: 180, height: 48 },
    medium: { width: 196, height: 50 },
    large: { width: 212, height: 54 },
  } as Record<CompanionSize, CompanionGeometry>,
  solo: {
    small: { width: 122, height: 46 },
    medium: { width: 136, height: 48 },
    large: { width: 150, height: 52 },
  } as Record<CompanionSize, CompanionGeometry>,
  expanded: {
    small: { width: 214, height: 58 },
    medium: { width: 230, height: 62 },
    large: { width: 246, height: 66 },
  } as Record<CompanionSize, CompanionGeometry>,
  soloExpanded: {
    small: { width: 170, height: 56 },
    medium: { width: 188, height: 60 },
    large: { width: 204, height: 64 },
  } as Record<CompanionSize, CompanionGeometry>,
};

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
    return { width, height, shape: 'rounded' };
  }
  // Avatar Pack supplies the canvas ratio; window policy stays generic.
  const character = companionCharacter.height[size];
  const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : 0.68;
  const width = Math.max(companionCharacter.minWidth, Math.round(character * ratio) + companionFrame.padX * 2);
  const height = companionFrame.padY * 2 + character + companionRail.gap + companionRail.height;
  return { width, height };
}
