import React from 'react';

const h = React.createElement;

// 0.2.18 起主图标是定稿位图（金底 squircle + 近白 YD 合体字标），界面不再自己画字形，
// 直接引用同一批素材，保证「界面 / 任务栏 / 托盘 / 安装包」四处完全一致：
//   assets/gen/01-app-icon-transparent.png  完整徽记（底砖 + 字标）
//   assets/gen/03-tray-mark.png             只有字标（深金、透明底）
// 位图来自 brand/source/yd-app-icon-master.png，图标再由 scripts/brand-raster-exports.py 导出。
const asset = (name: string) => `assets/gen/${name}`;

export const YD_COLORS = {
  gold: '#F5C948',
  goldDeep: '#8A6A16',
  brand: '#C89010',
  porcelain: '#FBFAFA',
  rose: '#A2848C',
};

interface MarkProps {
  className?: string;
  title?: string;
  tile?: string;
  glyph?: string;
  hairline?: boolean;
}

/** 完整徽记：金底软方 + 近白字标（侧栏品牌区、关于页、安装向导使用）。 */
export function BrandMark({ className = '', title = 'YD' }: MarkProps) {
  return h('img', { className, src: asset('01-app-icon-transparent.png'), alt: title, draggable: false });
}

interface GlyphProps {
  className?: string;
  title?: string;
  color?: string;
}

/** 只要字标：用于标题栏等单色场合（当前为深金版素材）。 */
export function BrandGlyph({ className = '', title = 'YD' }: GlyphProps) {
  return h('img', { className, src: asset('03-tray-mark.png'), alt: title, draggable: false });
}
