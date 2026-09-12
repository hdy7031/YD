import { build } from 'esbuild';
import { mkdir, copyFile, writeFile, cp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const at=(value)=>join(root,value);
await mkdir(at('dist'), { recursive: true });
await mkdir(at('.build-cache'), { recursive: true });
// 图标来自 brand/ 的同一份几何（生成脚本 scripts/brand-render.cjs），
// 构建只负责把已渲染好的多尺寸资源搬进 dist，避免每次构建都重新光栅化。
for (const [from,to] of [['brand/exports/tray-32.png','dist/tray.png'],['brand/exports/icon-256.png','dist/icon.png']]) {
  await copyFile(at(from),at(to));
}
const stage=at('.build-cache/dayhub-build');
try {
  await rm(stage,{recursive:true,force:true});
  await mkdir(stage,{recursive:true});
  const shared={absWorkingDir:root};
  await build({ ...shared, entryPoints: [at('src/main.ts')], outfile: join(stage,'main.cjs'), platform: 'node', target: 'node24', bundle: true, external: ['electron', 'sql.js'], format: 'cjs' });
  await build({ ...shared, entryPoints: [at('src/ui/app.ts')], outfile: join(stage,'ui.js'), platform: 'browser', target: 'chrome140', bundle: true, minify: true });
  for (const name of ['main.cjs','ui.js']) await copyFile(join(stage,name),at('dist/'+name));
  for (const [from,to] of [['src/preload.cjs','dist/preload.cjs'],['src/ui/index.html','dist/index.html'],['src/ui/style.css','dist/style.css'],['src/ui/presence-orb.css','dist/presence-orb.css']]) await copyFile(at(from),at(to));
  await rm(at('dist/assets'),{recursive:true,force:true});
  await cp(at('src/ui/assets'),at('dist/assets'),{recursive:true});
  console.log('Build complete');
} finally {
  await rm(stage,{recursive:true,force:true});
}
