// 把多尺寸 PNG 打包成 Windows ICO。Vista 之后的 ICO 允许直接内嵌 PNG 数据，
// 因此这里不做 BMP 转换，保证 256px 图层不丢精度、也不被二次重采样。
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function packIco(entries) {
  const count = entries.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);
  const dir = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  entries.forEach((entry, index) => {
    const base = index * 16;
    dir.writeUInt8(entry.size >= 256 ? 0 : entry.size, base);
    dir.writeUInt8(entry.size >= 256 ? 0 : entry.size, base + 1);
    dir.writeUInt8(0, base + 2);
    dir.writeUInt8(0, base + 3);
    dir.writeUInt16LE(1, base + 4);
    dir.writeUInt16LE(32, base + 6);
    dir.writeUInt32LE(entry.data.length, base + 8);
    dir.writeUInt32LE(offset, base + 12);
    offset += entry.data.length;
  });
  return Buffer.concat([header, dir, ...entries.map((entry) => entry.data)]);
}

export function packIcoFromFiles(files) {
  return packIco(files.map((file) => ({ size: Number(/(\d+)\.png$/i.exec(file)?.[1] ?? 0), data: readFileSync(file) })));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = process.argv[2];
  const files = process.argv.slice(3);
  writeFileSync(out, packIcoFromFiles(files));
  console.log(`ICO ${out} · ${files.length} 层`);
}
