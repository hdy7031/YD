// Avatar asset loader (main process).
//
// The renderer never guesses a path: this module locates the asset directory
// next to the packaged application, validates the manifest, and hands finished
// data URLs to every companion window. Pack/state fallback decisions stay in
// avatar.resolveAvatarFrame; this infrastructure layer only reports which
// logical assets were actually readable.
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_AVATAR_PACK_ID, getAvatarPack, resolveAvatarFrame, resolveAvatarPack, type AvatarPackManifest } from './avatar.ts';
import type { CompanionAssets, CompanionAssetManifest, LoadedAvatarPack } from './companion-frame.ts';

const assetsFor = (pack: AvatarPackManifest): string[] => [...new Set(Object.values(pack.frames).flatMap(value => value ? [value.asset] : []))];
// Compatibility export for existing diagnostics: explicitly the yd-default
// asset list, never the global truth for every Avatar Pack.
export const companionRequiredStates = assetsFor(resolveAvatarPack(DEFAULT_AVATAR_PACK_ID));

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const maxAssetBytes = 4 * 1024 * 1024;

export type CompanionManifest = CompanionAssetManifest;
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

function loadAvatarPack(baseDir: string, pack: AvatarPackManifest): LoadedAvatarPack {
  const dir = path.join(baseDir, 'assets', ...pack.assetRoot.split('/'));
  const required = assetsFor(pack);
  let manifest: CompanionManifest;
  try {
    manifest = readManifest(path.join(dir, 'manifest.json'));
  } catch {
    return { id: pack.id, source: dir, manifest: null, images: {}, missing: required };
  }

  const images: Record<string, string> = {};
  const missing: string[] = [];
  for (const key of required) {
    const entry = manifest.states[key];
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
  for (const key of required) if (!images[key] && !missing.includes(key)) missing.push(key);
  return { id: pack.id, source: dir, manifest, images, missing };
}

export function resolveCompanionAssets(baseDir: string, packId: string = DEFAULT_AVATAR_PACK_ID): CompanionAssets {
  const requested = getAvatarPack(packId);
  const resolved = resolveAvatarPack(packId);
  const packManifests = requested && requested.id !== DEFAULT_AVATAR_PACK_ID
    ? [requested, resolveAvatarPack(DEFAULT_AVATAR_PACK_ID)]
    : [resolved];
  const packs: Record<string, LoadedAvatarPack> = {};
  for (const pack of packManifests) packs[pack.id] = loadAvatarPack(baseDir, pack);
  const primary = packs[resolved.id];
  const hasAsset = (candidatePackId: string, asset: string) => !!packs[candidatePackId]?.images[asset];
  const preview = resolveAvatarFrame(packId, resolved.previewState, { hasAsset });
  const available = preview.fallback !== 'embedded';
  const usedDefault = preview.fallback === 'default-pack';

  // 面向用户的一句话，不暴露“接入 / 状态数 / fixture”这类工程说法。
  const reason = available
    ? usedDefault
      ? '所选角色素材不可用，已使用 YD 默认角色'
      : primary.missing.length
      ? `专属角色 · ${primary.missing.join('、')}动作素材缺失，暂用待机动作代替`
      : '专属角色 · 会根据当前状态自动切换动作'
    : '专属角色素材不可用，已使用内置的专属角色待机帧';

  return {
    requestedPackId: packId,
    resolvedPackId: resolved.id,
    pack: resolved,
    packs,
    available,
    reason,
    source: primary.source,
    manifest: primary.manifest,
    // Compatibility projection for existing diagnostics and settings.
    images: primary.images,
    missing: primary.missing,
    aspect: resolved.canvas.width / resolved.canvas.height,
  };
}
