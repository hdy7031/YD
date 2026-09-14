// YD 品牌资源契约校验（npm run assets:check）。
//
// 目的：让"品牌资源单一来源"可被机械检查，而不是靠人记得住。
// 覆盖 docs/brand-assets.md 里声明的每一条硬性约定。
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRAND, DIST_COPIES, LEGACY_BRAND } from './brand-paths.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const at = (p) => join(root, p);
const pkg = JSON.parse(readFileSync(at('package.json'), 'utf8'));
const problems = [];
const check = (name, ok, detail = '') => {
  if (!ok) problems.push(`${name}${detail ? ' — ' + detail : ''}`);
};

// 1) package.json 的 electron-builder 路径必须与单一来源一致
const win = pkg.build?.win ?? {};
const nsis = pkg.build?.nsis ?? {};
check('build.win.icon 指向品牌单一来源', win.icon === BRAND.appIcon, `实际 ${win.icon}`);
check('nsis.installerIcon 与 App Icon 一致', nsis.installerIcon === BRAND.appIcon, `实际 ${nsis.installerIcon}`);
check('nsis.uninstallerIcon 与 App Icon 一致', nsis.uninstallerIcon === BRAND.appIcon, `实际 ${nsis.uninstallerIcon}`);
check('nsis.installerHeader 指向品牌单一来源', nsis.installerHeader === BRAND.installerHeader, `实际 ${nsis.installerHeader}`);
check('nsis.installerSidebar 指向品牌单一来源', nsis.installerSidebar === BRAND.installerSidebar, `实际 ${nsis.installerSidebar}`);
check('nsis.uninstallerSidebar 指向品牌单一来源', nsis.uninstallerSidebar === BRAND.installerSidebar, `实际 ${nsis.uninstallerSidebar}`);

// 2) 所有登记的资源都存在
for (const [key, rel] of Object.entries(BRAND)) {
  check(`品牌资源存在：${key}`, existsSync(at(rel)), rel);
}

// 3) 构建复制来源存在
for (const [from] of DIST_COPIES) {
  check(`构建复制来源存在：${from}`, existsSync(at(from)));
}

// 3b) 若 dist 已构建，目标必须存在且与来源逐字节一致。
// （历史上出现过目标写错目录：资源被复制到仓库根而不是 dist/。）
if (existsSync(at('dist'))) {
  for (const [from, to] of DIST_COPIES) {
    const target = `dist/${to}`;
    if (!existsSync(at(target))) {
      check(`构建目标存在：${target}`, false, `缺失；源 ${from}`);
      continue;
    }
    const same = readFileSync(at(from)).equals(readFileSync(at(target)));
    check(`构建目标与来源一致：${target}`, same, `源 ${from} 大小 ${statSync(at(from)).size}，目标 ${statSync(at(target)).size}`);
  }
}

// 4) 安装器品牌图必须是 24 位 BMP（NSIS 2 不支持 alpha）
for (const rel of [BRAND.installerHeader, BRAND.installerSidebar]) {
  if (!existsSync(at(rel))) continue;
  const head = readFileSync(at(rel)).subarray(0, 30);
  const bits = head.readUInt16LE(28);
  check(`安装器品牌图是 24 位 BMP：${rel}`, head.subarray(0, 2).toString() === 'BM' && bits === 24, `magic=${head.subarray(0, 2).toString()} bpp=${bits}`);
}

// 5) 历史资源不得被 src / scripts / package.json 引用
const legacyNames = LEGACY_BRAND.map((p) => p.split('/').pop()).filter((n, i, a) => a.indexOf(n) === i);
const sources = [];
function walk(dir, depth = 0) {
  if (depth > 4) return;
  for (const entry of readdirSync(at(dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', 'release', 'test-data', '.build-cache', '.git'].includes(entry.name)) continue;
      if (rel.startsWith('brand/legacy') || rel.startsWith('brand/source/legacy')) continue;
      walk(rel, depth + 1);
    } else if (/\.(ts|tsx|cjs|mjs|js|py|json)$/.test(entry.name)) {
      sources.push(rel);
    }
  }
}
walk('src');
walk('scripts');
sources.push('package.json');
for (const file of sources) {
  const text = readFileSync(at(file), 'utf8');
  const content = file.replace(/\\/g, '/');
  for (const name of legacyNames) {
    // brand-paths.mjs 自身要登记 legacy 清单，跳过
    if (content.endsWith('scripts/brand-paths.mjs')) continue;
    if (text.includes(name)) problems.push(`历史资源仍被引用：${file} 提到 ${name}`);
  }
}

if (problems.length) {
  console.error('品牌资源契约校验未通过：');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
console.log(`品牌资源契约校验通过（${Object.keys(BRAND).length} 项资源、${DIST_COPIES.length} 条构建复制、${LEGACY_BRAND.length} 条历史留档）`);
