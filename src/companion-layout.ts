// Companion window layout contract.
//
// The desk pet always lives in a fixed canvas: a stage for the character and a
// rail for the D / Y status dots. Window sizes are pure constants per mode and
// size, so nothing a character frame, a hover, a reminder or a state switch
// does can ever resize or shift the window. The main process uses these numbers
// to size the BrowserWindow and the renderer uses the same numbers (through CSS
// custom properties) to place the rail, which keeps both sides in sync.
import type { PetPreferences } from './live.ts';
import type { CompanionDisplayState } from './companion-display.ts';

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

// 每个姿态的落点微调：集中在这里配置，组件与 CSS 里不出现各自的魔法数字。
// 基准锚点是“bottom center”（脚底 / 桌面落点）。十宫格素材在
// scripts/companion-assets.py 里已经统一了画布、体型与脚底基线，所以默认全部是
// 1 / 0 / 0：任何非零值都会让换动作时人物离地或左右挪一点。
// 只有将来某张素材确实没法在流水线里对齐时，才在这里给单个状态加很小的补偿。
export interface PetSpriteTuning {
  // 相对素材画布的等比缩放。
  scale: number;
  // 相对底边中点的像素偏移（正值向右 / 向下）。
  offsetX: number;
  offsetY: number;
}

export const petSpriteTuning: Record<CompanionDisplayState, PetSpriteTuning> = {
  idle: { scale: 1, offsetX: 0, offsetY: 0 },
  upcoming: { scale: 1, offsetX: 0, offsetY: 0 },
  busy_class: { scale: 1, offsetX: 0, offsetY: 0 },
  busy_work: { scale: 1, offsetX: 0, offsetY: 0 },
  reminder: { scale: 1, offsetX: 0, offsetY: 0 },
  gentle: { scale: 1, offsetX: 0, offsetY: 0 },
  night_sleep: { scale: 1, offsetX: 0, offsetY: 0 },
  eating: { scale: 1, offsetX: 0, offsetY: 0 },
  nap: { scale: 1, offsetX: 0, offsetY: 0 },
  wake_up: { scale: 1, offsetX: 0, offsetY: 0 },
};

export function petSpriteFor(state?: string): PetSpriteTuning {
  if (state && state in petSpriteTuning) return petSpriteTuning[state as CompanionDisplayState];
  return petSpriteTuning.idle;
}

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
  // 唯一默认桌宠：固定素材比例 + 四周透明安全区。
  const character = companionCharacter.height[size];
  const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : 0.68;
  const width = Math.max(companionCharacter.minWidth, Math.round(character * ratio) + companionFrame.padX * 2);
  const height = companionFrame.padY * 2 + character + companionRail.gap + companionRail.height;
  return { width, height };
}
