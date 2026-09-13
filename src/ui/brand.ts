import React from 'react';

const h = React.createElement;

// 主窗口使用用户确认的灰绿 YD 合体字标。完整渐变版用于关于页，
// 单色版用于标题栏和小尺寸场景，避免缩小时渐变细节发灰。
const asset = (name: string) => `assets/gen/${name}`;

export const YD_COLORS = {
  gold: '#86A8A2',
  goldDeep: '#365653',
  brand: '#466C6A',
  porcelain: '#F3F6F7',
  rose: '#B48FA5',
};

interface MarkProps {
  className?: string;
  title?: string;
  tile?: string;
  glyph?: string;
  hairline?: boolean;
}

/** 完整渐变字标：用于关于页等有足够显示面积的场景。 */
export function BrandMark({ className = '', title = 'YD' }: MarkProps) {
  return h('img', { className, src: asset('yd-logo-gradient.png'), alt: title, draggable: false });
}

interface GlyphProps {
  className?: string;
  title?: string;
  color?: string;
}

/** 单色字标：用于标题栏和小尺寸场景。 */
export function BrandGlyph({ className = '', title = 'YD' }: GlyphProps) {
  return h('img', { className, src: asset('yd-logo-mono.png'), alt: title, draggable: false });
}
