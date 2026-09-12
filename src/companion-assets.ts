// Custom companion asset resolver (main process).
//
// The renderer never guesses a path: this module locates the asset directory
// next to the packaged application, validates the manifest, and hands finished
// data URLs to every companion window. There is exactly one character: when a
// frame is missing it falls back to a neighbouring frame, then to idle; when the
// whole bundle is unreadable the renderer shows the built-in idle frame of the
// same character (see companion-fallback-idle.ts).
import fs from 'node:fs';
import path from 'node:path';
import type { CompanionAssets, CompanionAssetManifest } from './companion-frame.ts';
import { companionDisplayAssets } from './companion-display.ts';

export const companionAssetDir = ['assets', 'companion', 'custom'];
// 0.2.20 的十态素材：白天六态 + 夜间睡觉 / 吃饭 / 午睡 / 刚睡醒。
// 需求来自统一的 display 映射表，避免这里和状态机各写一份名单。
export const companionRequiredStates = [...new Set(
  Object.values(companionDisplayAssets).map(entry => entry.asset),
)];

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const maxAssetBytes = 4 * 1024 * 1024;

export type CompanionManifest = CompanionAssetManifest;
export { companionFrame } from './companion-frame.ts';
export type { CompanionAssets } from './companion-frame.ts';

function readManifest(file: string): CompanionManifest {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as CompanionManifest;
  if (raw?.format !== 'dayhub-companion' || raw.version !== 1) throw new Error('素材清单格式不受支持');
  if (!raw.canvas || !Number.isFinite(raw.canvas.width) || !Number.isFinite(raw.canvas.height) || raw.canvas.width <= 0 || raw.canvas.height <= 0) throw new Error('素材画布尺寸无效');
  if (!raw.states || typeof raw.states !== 'object') throw new Error('素材清单缺少状态表');
  return raw;
}

function readImage(file: string): string {
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size === 0) throw new Error('素材文件为空');
  if (stat.size > maxAssetBytes) throw new Error('素材文件过大');
  const bytes = fs.readFileSync(file);
  if (!bytes.subarray(0, 4).equals(pngSignature)) throw new Error('素材不是 PNG 图片');
  return 'data:image/png;base64,' + bytes.toString('base64');
}

export function resolveCompanionAssets(baseDir: string): CompanionAssets {
  const dir = path.join(baseDir, ...companionAssetDir);
  const empty = (reason: string): CompanionAssets => ({
    available: false,
    reason,
    source: dir,
    manifest: null,
    images: {},
    missing: [...companionRequiredStates],
    aspect: 1,
  });

  let manifest: CompanionManifest;
  try {
    manifest = readManifest(path.join(dir, 'manifest.json'));
  } catch (error) {
    return empty(`桌宠素材不可用，已使用内置的专属角色待机帧（${error instanceof Error ? error.message : String(error)}）`);
  }

  const images: Record<string, string> = {};
  const missing: string[] = [];
  for (const [key, entry] of Object.entries(manifest.states)) {
    const name = typeof entry?.file === 'string' ? entry.file : '';
    if (!name || name.includes('/') || name.includes('\\') || !name.toLowerCase().endsWith('.png')) {
      missing.push(key);
      continue;
    }
    try {
      images[key] = readImage(path.join(dir, name));
    } catch {
      missing.push(key);
    }
  }
  for (const key of companionRequiredStates) if (!images[key] && !missing.includes(key)) missing.push(key);

  const available = !!images.idle;
  // 面向用户的一句话，不暴露“接入 / 状态数 / fixture”这类工程说法。
  const reason = available
    ? missing.length
      ? `专属角色 · ${missing.join('、')}动作素材缺失，暂用相近动作代替`
      : '专属角色 · 会根据当前状态自动切换动作'
    : '专属角色素材不可用，已使用内置的专属角色待机帧';

  return {
    available,
    reason,
    source: dir,
    manifest,
    images,
    missing,
    aspect: available ? manifest.canvas.width / manifest.canvas.height : 1,
  };
}
