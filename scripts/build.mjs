import { build } from 'esbuild';
import { mkdir, copyFile, writeFile, cp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { BRAND, DIST_COPIES } from './brand-paths.mjs';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const at=(value)=>join(root,value);
// 产品版本在构建时注入，保证开发态（脚本直接跑 dist/main.cjs）与打包态
// 显示同一个版本号，不再出现 About 页停留在 Electron 版本的情况。
const pkg=JSON.parse(readFileSync(at('package.json'),'utf8'));
await mkdir(at('dist'), { recursive: true });
await mkdir(at('.build-cache'), { recursive: true });
// 图标来自 brand/ 的同一份几何（生成脚本 scripts/brand-render.cjs），
// 构建只负责把已渲染好的多尺寸资源搬进 dist，避免每次构建都重新光栅化。
// 路径来自品牌资源单一来源 scripts/brand-paths.mjs，不要在这里写死。
for (const [from,to] of DIST_COPIES) {
  await copyFile(at(from),at(join('dist',to)));
}
if (!BRAND.tray || !BRAND.appIconPng) throw new Error('品牌资源路径缺失');
const stage=at('.build-cache/dayhub-build');
try {
  await rm(stage,{recursive:true,force:true});
  await mkdir(stage,{recursive:true});
  const shared={absWorkingDir:root};
  await build({ ...shared, entryPoints: [at('src/main.ts')], outfile: join(stage,'main.cjs'), platform: 'node', target: 'node24', bundle: true, external: ['electron', 'sql.js'], format: 'cjs', define: { __YD_VERSION__: JSON.stringify(pkg.version) } });
  await build({ ...shared, entryPoints: [at('src/ui/app.ts')], outfile: join(stage,'ui.js'), platform: 'browser', target: 'chrome140', bundle: true, minify: true });
  for (const name of ['main.cjs','ui.js']) await copyFile(join(stage,name),at('dist/'+name));
  for (const [from,to] of [['src/preload.cjs','dist/preload.cjs'],['src/ui/index.html','dist/index.html'],['src/ui/style.css','dist/style.css'],['src/ui/presence-orb.css','dist/presence-orb.css']]) await copyFile(at(from),at(to));
  await rm(at('dist/assets'),{recursive:true,force:true});
  await cp(at('src/ui/assets'),at('dist/assets'),{recursive:true});
  console.log('Build complete');
} finally {
  await rm(stage,{recursive:true,force:true});
}
