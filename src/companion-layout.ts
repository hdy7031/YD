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

export const companionOrb = {
  size: { small: 98, medium: 102, large: 108 } as Record<CompanionSize, number>,
};

export interface CompanionGeometry {
  width: number;
  height: number;
}

// Single source of truth for every companion window size.
export function companionGeometry(mode: CompanionMode, size: CompanionSize, aspect: number): CompanionGeometry {
  if (mode === 'orb') {
    const value = companionOrb.size[size];
    return { width: value, height: value };
  }
  // Avatar Pack supplies the canvas ratio; window policy stays generic.
  const character = companionCharacter.height[size];
  const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : 0.68;
  const width = Math.max(companionCharacter.minWidth, Math.round(character * ratio) + companionFrame.padX * 2);
  const height = companionFrame.padY * 2 + character + companionRail.gap + companionRail.height;
  return { width, height };
}
