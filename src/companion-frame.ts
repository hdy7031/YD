// Environment-neutral loaded-asset contract.
// The main process performs IO; renderer windows resolve Avatar frames against
// these already-loaded data URLs without importing Node APIs.
import { companionFallbackIdle } from './companion-fallback-idle.ts';
import { DEFAULT_AVATAR_PACK_ID, EMBEDDED_AVATAR_ASSET, resolveAvatarFrame, type AvatarPackId, type AvatarPackManifest, type ResolvedAvatarFrame } from './avatar.ts';
import type { CompanionDisplayState } from './companion-visual.ts';

export interface CompanionAssetManifest {
  format: string;
  version: number;
  character?: string;
  canvas: { width: number; height: number };
  baseline?: number;
  bodyHeight?: number;
  states: Record<string, { file: string; label?: string; note?: string }>;
}

export interface LoadedAvatarPack {
  id: AvatarPackId;
  source: string;
  manifest: CompanionAssetManifest | null;
  images: Record<string, string>;
  missing: string[];
}

export interface CompanionAssets {
  requestedPackId: AvatarPackId;
  resolvedPackId: AvatarPackId;
  pack: AvatarPackManifest;
  packs: Record<AvatarPackId, LoadedAvatarPack>;
  available: boolean;
  // Human readable status for logs and the settings page.
  reason: string;
  // 只在该说的话才说（Phase 5B1 UI 收口）：正常可用时是 null，界面不再重复解释
  // "专属角色会跟随状态切换动作"这类永久说明；素材缺失 / 回退时才给出可操作提示。
  notice: string | null;
  source: string;
  manifest: CompanionAssetManifest | null;
  // state key -> data URL
  images: Record<string, string>;
  missing: string[];
  // Canvas aspect ratio, used to size the transparent window without distortion.
  aspect: number;
}

export interface ResolvedCompanionFrame extends ResolvedAvatarFrame {
  url: string;
}

/** Unified renderer entry: Avatar resolver first, data URL lookup second. */
export function resolveCompanionFrame(assets: CompanionAssets | null, state: CompanionDisplayState): ResolvedCompanionFrame {
  const requestedPackId = assets?.requestedPackId ?? DEFAULT_AVATAR_PACK_ID;
  const frame = resolveAvatarFrame(requestedPackId, state, {
    hasAsset: (packId, asset) => !!assets?.packs[packId]?.images[asset],
  });
  const url = frame.asset === EMBEDDED_AVATAR_ASSET
    ? companionFallbackIdle
    : assets?.packs[frame.resolvedPackId]?.images[frame.asset] ?? companionFallbackIdle;
  return { ...frame, url };
}
