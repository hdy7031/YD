// YD 品牌主形：软方徽记 + “YD”几何字标。
// 画布固定 96×96，所有尺寸都从同一份几何缩放，避免某个尺寸单独手改后失真。
// 小尺寸（16 / 20 / 24）使用更粗的笔画与更满的字面，否则缩到托盘尺寸会糊成一团。
export const BRAND = {
  name: 'YD',
  sub: 'Your Day',
  line: 'your day, quietly organized.',
  cn: '本地日程中枢',
  color: {
    brand: '#2F4C3D',
    brandDeep: '#253B30',
    brandSoft: '#E7EDE6',
    sage: '#7E9A87',
    porcelain: '#F5F2EA',
    ink: '#1F2521',
    accent: '#A9838D',
  },
};

// 字标由参数推导，而不是手写坐标：改动笔画或字面后自动重新居中，
// 大小两个档位共用同一套比例关系。
const PARAMS = {
  // 正常尺寸：笔画 10，字面约 62×48。
  large: { stroke: 10, cap: 38, yWidth: 24, gap: 2 },
  // 小尺寸：笔画 13、字面更满，16px 下才不至于糊成一团。
  small: { stroke: 13, cap: 44, yWidth: 28, gap: 1.5 },
};

function geometry(scale) {
  const p = PARAMS[scale] ?? PARAMS.large;
  const top = 48 - p.cap / 2, bottom = 48 + p.cap / 2, half = p.stroke / 2;
  const yLeft = 0, yRight = yLeft + p.yWidth, apex = (yLeft + yRight) / 2;
  const dStem = yRight + p.stroke + p.gap, bowl = p.cap / 2;
  const left = yLeft - half, right = dStem + bowl + half;
  const shift = 48 - (left + right) / 2;
  return {
    stroke: p.stroke,
    y: { left: yLeft + shift, right: yRight + shift, apex: apex + shift, top, joint: top + p.cap * 0.42, bottom },
    d: { stem: dStem + shift, top, bottom, bowl },
  };
}

const VARIANTS = { large: geometry('large'), small: geometry('small') };

function glyphPaths(v) {
  const r = v.d.bowl;
  return [
    `M ${v.y.left} ${v.y.top} L ${v.y.apex} ${v.y.joint} L ${v.y.right} ${v.y.top}`,
    `M ${v.y.apex} ${v.y.joint} L ${v.y.apex} ${v.y.bottom}`,
    `M ${v.d.stem} ${v.d.top} L ${v.d.stem} ${v.d.bottom}`,
    `M ${v.d.stem} ${v.d.top} A ${r} ${r} 0 0 1 ${v.d.stem} ${v.d.bottom}`,
  ];
}

function tilePath(radius) {
  return `M ${radius} 0 H ${96 - radius} A ${radius} ${radius} 0 0 1 96 ${radius} V ${96 - radius} A ${radius} ${radius} 0 0 1 ${96 - radius} 96 H ${radius} A ${radius} ${radius} 0 0 1 0 ${96 - radius} V ${radius} A ${radius} ${radius} 0 0 1 ${radius} 0 Z`;
}

/**
 * 生成一枚 SVG 标记。
 * tile=false 时只输出字标（用于需要极简或单色的场合）。
 */
export function markSvg({
  scale = 'large',
  tile = true,
  tileColor = BRAND.color.brand,
  glyphColor = BRAND.color.porcelain,
  hairline = true,
  radius = 22,
  label = 'YD',
} = {}) {
  const v = VARIANTS[scale] ?? VARIANTS.large;
  const stroke = {
    fill: 'none',
    stroke: glyphColor,
    'stroke-width': v.stroke,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  };
  const parts = [];
  if (tile) {
    parts.push(`<path d="${tilePath(radius)}" fill="${tileColor}"/>`);
    if (hairline) parts.push(`<path d="${tilePath(radius - 1.1)}" fill="none" stroke="rgba(255,255,255,.16)" stroke-width="1.1"/>`);
  }
  for (const d of glyphPaths(v)) parts.push(`<path d="${d}" ${Object.entries(stroke).map(([k, val]) => `${k}="${val}"`).join(' ')}/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96" role="img" aria-label="${label}">${parts.join('')}</svg>`;
}

// 单色版：徽记挖空字标，用于深底 / 浅底 / 印刷等只用一种颜色的场合。
export function markMonoSvg({ scale = 'large', color = BRAND.color.brand, radius = 22 } = {}) {
  const v = VARIANTS[scale] ?? VARIANTS.large;
  // 单色版：整块徽记用同一颜色，字标挖空成透明（深底 / 浅底 / 印刷都只需要一种颜色）。
  const mask = [`<rect width="96" height="96" fill="#000"/>`, `<path d="${tilePath(radius)}" fill="#fff"/>`];
  for (const d of glyphPaths(v)) mask.push(`<path d="${d}" fill="none" stroke="#000" stroke-width="${v.stroke}" stroke-linecap="round" stroke-linejoin="round"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96" role="img" aria-label="YD"><defs><mask id="m">${mask.join('')}</mask></defs><rect width="96" height="96" fill="${color}" mask="url(#m)"/></svg>`;
}

// 探索方向 A：主方案（软方徽记 + YD 联结字标）。
export function directionA({ tileColor = BRAND.color.brand } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 200" width="240" height="200">
  <rect width="240" height="200" rx="18" fill="#F3F1EC"/>
  <g transform="translate(24 26) scale(0.95)">${markSvg({ tileColor }).replace(/^<svg[^>]*>|<\/svg>$/g, '')}</g>
  <text x="140" y="72" font-family="Segoe UI Variable Display, Segoe UI, Microsoft YaHei UI, sans-serif" font-size="46" font-weight="600" letter-spacing="2" fill="#1F2521">YD</text>
  <text x="142" y="96" font-family="Segoe UI, Microsoft YaHei UI, sans-serif" font-size="13" letter-spacing="5" fill="#7A837A">YOUR DAY</text>
  <text x="142" y="122" font-family="Segoe UI, Microsoft YaHei UI, sans-serif" font-size="11" letter-spacing="1" fill="#9AA097">本地日程中枢</text>
  </svg>`;
}

// 探索方向 B：字标优先，不套徽记，靠字距与一条“日线”建立识别。
export function directionB() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 200" width="240" height="200">
  <rect width="240" height="200" rx="18" fill="#FAF9F5"/>
  <text x="26" y="104" font-family="Segoe UI Variable Display, Segoe UI, Microsoft YaHei UI, sans-serif" font-size="76" font-weight="500" letter-spacing="-2" fill="#2F4C3D">YD</text>
  <path d="M28 124 H132" stroke="#7E9A87" stroke-width="2" stroke-linecap="round"/>
  <circle cx="132" cy="124" r="3.6" fill="#2F4C3D"/>
  <text x="28" y="150" font-family="Segoe UI, Microsoft YaHei UI, sans-serif" font-size="12" letter-spacing="6" fill="#8A9089">YOUR DAY</text>
  <text x="28" y="172" font-family="Segoe UI, Microsoft YaHei UI, sans-serif" font-size="11" letter-spacing="1" fill="#A6ABA4">your day, quietly organized.</text>
  </svg>`;
}

// 探索方向 C：圆徽记，字标被“日弧”半包，适合做圆形头像位与次级标识。
export function directionC() {
  const v = VARIANTS.large;
  const r = (v.d.bottom - v.d.top) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 200" width="240" height="200">
  <rect width="240" height="200" rx="18" fill="#F6F3EC"/>
  <circle cx="66" cy="100" r="46" fill="#2F4C3D"/>
  <circle cx="66" cy="100" r="41" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="1.2"/>
  <g transform="translate(42.5 76) scale(0.5)">
    ${glyphPaths(v).map((d) => `<path d="${d}" fill="none" stroke="#F5F2EA" stroke-width="${v.stroke}" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}
  </g>
  <path d="M 40 100 A 30 30 0 0 1 92 100" fill="none" stroke="rgba(245,242,234,.45)" stroke-width="1.4" stroke-linecap="round"/>
  <text x="132" y="96" font-family="Segoe UI Variable Display, Segoe UI, Microsoft YaHei UI, sans-serif" font-size="30" font-weight="600" letter-spacing="1.5" fill="#22372C">Your Day</text>
  <text x="133" y="120" font-family="Segoe UI, Microsoft YaHei UI, sans-serif" font-size="11" letter-spacing="1" fill="#8A9089">your day, quietly organized.</text>
  <g transform="translate(132 132)"><path d="${tilePath(22)}" fill="#E7EDE6" transform="scale(0.28)"/>${pathScaled(glyphPaths(v), 0.28, BRAND.color.brand, v.stroke).join('')}</g>
  </svg>`;
}

function pathScaled(paths, s, color, strokeWidth) {
  return paths.map((d) => `<path d="${d}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" transform="scale(${s})"/>`);
}
