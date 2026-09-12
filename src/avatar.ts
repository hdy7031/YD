// Avatar Pack contract, builtin registry and deterministic frame resolver.
//
// This layer only consumes a CompanionDisplayState that has already been
// decided by companion-display.ts. It never reads schedules, routines, manual
// overrides, reminders or the clock.
import { companionVisualStates, isCompanionDisplayState, type CompanionDisplayState } from './companion-visual.ts';

export type AvatarPackId = string;
export type AvatarPackSource = 'builtin';

export interface AvatarFrameGeometry {
  /** Relative scale inside the fixed companion stage. */
  scale: number;
  /** Pixel offset from the bottom-centre anchor (positive = right/down). */
  offsetX: number;
  offsetY: number;
}

export interface AvatarFrameSpec {
  /** Logical asset key. Disk/package paths belong to the asset loader. */
  asset: string;
  geometry: AvatarFrameGeometry;
}

export interface AvatarPackManifest {
  id: AvatarPackId;
  version: string;
  name: string;
  source: AvatarPackSource;
  /** Logical path below the packaged assets directory. */
  assetRoot: string;
  canvas: { width: number; height: number };
  previewState: CompanionDisplayState;
  fallbackState: CompanionDisplayState;
  frames: Partial<Record<CompanionDisplayState, AvatarFrameSpec>>;
}

export type AvatarFrameFallback = 'none' | 'pack-state' | 'default-pack' | 'embedded';

export interface ResolvedAvatarFrame {
  requestedPackId: AvatarPackId;
  resolvedPackId: AvatarPackId;
  requestedState: CompanionDisplayState;
  resolvedState: CompanionDisplayState;
  asset: string;
  geometry: AvatarFrameGeometry;
  fallback: AvatarFrameFallback;
}

export type AvatarPackRegistry = ReadonlyMap<AvatarPackId, AvatarPackManifest>;

const unitGeometry = (): AvatarFrameGeometry => ({ scale: 1, offsetX: 0, offsetY: 0 });
const frame = (asset: string): AvatarFrameSpec => ({ asset, geometry: unitGeometry() });

export const DEFAULT_AVATAR_PACK_ID = 'yd-default';
export const EMBEDDED_AVATAR_ASSET = 'companion-fallback-idle';

// The existing ten-pose character, with the exact canvas and geometry used
// before Phase 4A. Only its ownership moved: visuals did not change.
export const ydDefaultAvatarPack: AvatarPackManifest = {
  id: DEFAULT_AVATAR_PACK_ID,
  version: '1.0.0',
  name: 'YD 默认角色',
  source: 'builtin',
  assetRoot: 'companion/custom',
  canvas: { width: 412, height: 411 },
  previewState: 'idle',
  fallbackState: 'idle',
  frames: {
    idle: frame('idle'),
    upcoming: frame('relaxed'),
    busy_class: frame('busy_class'),
    busy_work: frame('busy_work'),
    reminder: frame('reminder'),
    gentle: frame('happy'),
    night_sleep: frame('night_sleep'),
    eating: frame('eating'),
    nap: frame('nap'),
    wake_up: frame('wake_up'),
  },
};

const logicalPath = (value: string): boolean => {
  if (!value || value.startsWith('/') || value.startsWith('\\') || /^[A-Za-z]:/.test(value)) return false;
  return !value.split(/[\\/]/).some(part => part === '..' || part === '');
};

export function avatarPackValidationErrors(manifest: AvatarPackManifest): string[] {
  const errors: string[] = [];
  if (!manifest || typeof manifest !== 'object') return ['manifest must be an object'];
  if (typeof manifest.id !== 'string' || !manifest.id.trim()) errors.push('id must not be empty');
  if (typeof manifest.version !== 'string' || !manifest.version.trim()) errors.push('version must not be empty');
  if (typeof manifest.name !== 'string' || !manifest.name.trim()) errors.push('name must not be empty');
  if (manifest.source !== 'builtin') errors.push('source must be builtin');
  if (typeof manifest.assetRoot !== 'string' || !logicalPath(manifest.assetRoot)) errors.push('assetRoot must be a safe logical path');
  if (!Number.isFinite(manifest.canvas?.width) || manifest.canvas.width <= 0) errors.push('canvas width must be positive');
  if (!Number.isFinite(manifest.canvas?.height) || manifest.canvas.height <= 0) errors.push('canvas height must be positive');
  if (!isCompanionDisplayState(manifest.fallbackState)) errors.push('fallbackState is invalid');
  if (!isCompanionDisplayState(manifest.previewState)) errors.push('previewState is invalid');
  const frameEntries = manifest.frames && typeof manifest.frames === 'object' ? Object.entries(manifest.frames) : [];
  for (const [state, value] of frameEntries) {
    if (!isCompanionDisplayState(state)) { errors.push(`frame state ${state} is invalid`); continue; }
    if (!value || typeof value !== 'object') { errors.push(`frame ${state} is invalid`); continue; }
    const spec = value as AvatarFrameSpec;
    if (typeof spec.asset !== 'string' || !spec.asset.trim() || spec.asset.includes('/') || spec.asset.includes('\\')) errors.push(`frame ${state} asset must be a logical key`);
    if (!Number.isFinite(spec.geometry?.scale) || spec.geometry.scale <= 0) errors.push(`frame ${state} scale must be positive`);
    if (!Number.isFinite(spec.geometry?.offsetX)) errors.push(`frame ${state} offsetX must be finite`);
    if (!Number.isFinite(spec.geometry?.offsetY)) errors.push(`frame ${state} offsetY must be finite`);
  }
  if (isCompanionDisplayState(manifest.fallbackState) && !manifest.frames?.[manifest.fallbackState]) errors.push('fallback frame is missing');
  if (isCompanionDisplayState(manifest.previewState) && isCompanionDisplayState(manifest.fallbackState)
    && !manifest.frames?.[manifest.previewState] && !manifest.frames?.[manifest.fallbackState]) errors.push('preview frame cannot resolve safely');
  return errors;
}

export function assertAvatarPackManifest(manifest: AvatarPackManifest): void {
  const errors = avatarPackValidationErrors(manifest);
  if (errors.length) throw new Error(`Avatar Pack ${manifest?.id || '<unknown>'} invalid: ${errors.join('; ')}`);
}

function freezeManifest(manifest: AvatarPackManifest): AvatarPackManifest {
  const frames: AvatarPackManifest['frames'] = {};
  for (const state of companionVisualStates) {
    const spec = manifest.frames[state];
    if (spec) frames[state] = Object.freeze({ ...spec, geometry: Object.freeze({ ...spec.geometry }) });
  }
  return Object.freeze({ ...manifest, canvas: Object.freeze({ ...manifest.canvas }), frames: Object.freeze(frames) });
}

export function createAvatarPackRegistry(manifests: readonly AvatarPackManifest[]): AvatarPackRegistry {
  const registry = new Map<AvatarPackId, AvatarPackManifest>();
  for (const candidate of manifests) {
    assertAvatarPackManifest(candidate);
    if (registry.has(candidate.id)) throw new Error(`Avatar Pack id duplicated: ${candidate.id}`);
    registry.set(candidate.id, freezeManifest(candidate));
  }
  if (!registry.has(DEFAULT_AVATAR_PACK_ID)) throw new Error(`Default Avatar Pack missing: ${DEFAULT_AVATAR_PACK_ID}`);
  return registry;
}

export const builtinAvatarRegistry = createAvatarPackRegistry([ydDefaultAvatarPack]);

export function listAvatarPacks(registry: AvatarPackRegistry = builtinAvatarRegistry): readonly AvatarPackManifest[] {
  return Object.freeze([...registry.values()]);
}

export function getAvatarPack(id: AvatarPackId, registry: AvatarPackRegistry = builtinAvatarRegistry): AvatarPackManifest | undefined {
  return registry.get(id);
}

export function resolveAvatarPack(id: AvatarPackId, registry: AvatarPackRegistry = builtinAvatarRegistry): AvatarPackManifest {
  return registry.get(id) ?? registry.get(DEFAULT_AVATAR_PACK_ID)!;
}

export interface ResolveAvatarFrameOptions {
  registry?: AvatarPackRegistry;
  /** Runtime availability hook. Omit for contract-only resolution. */
  hasAsset?(packId: AvatarPackId, asset: string): boolean;
}

export function resolveAvatarFrame(
  packId: AvatarPackId,
  displayState: CompanionDisplayState,
  options: ResolveAvatarFrameOptions = {},
): ResolvedAvatarFrame {
  const registry = options.registry ?? builtinAvatarRegistry;
  const requested = registry.get(packId);
  const fallbackPack = registry.get(DEFAULT_AVATAR_PACK_ID);
  if (!fallbackPack) throw new Error(`Default Avatar Pack missing: ${DEFAULT_AVATAR_PACK_ID}`);
  const available = options.hasAsset ?? (() => true);
  const resolvedState = isCompanionDisplayState(displayState) ? displayState : fallbackPack.fallbackState;

  const candidate = (
    pack: AvatarPackManifest,
    state: CompanionDisplayState,
    fallback: AvatarFrameFallback,
  ): ResolvedAvatarFrame | undefined => {
    const spec = pack.frames[state];
    if (!spec || !available(pack.id, spec.asset)) return undefined;
    return {
      requestedPackId: packId,
      resolvedPackId: pack.id,
      requestedState: displayState,
      resolvedState: state,
      asset: spec.asset,
      geometry: spec.geometry,
      fallback,
    };
  };

  if (requested) {
    const exact = candidate(requested, resolvedState, 'none');
    if (exact) return exact;
    if (requested.fallbackState !== resolvedState) {
      const samePack = candidate(requested, requested.fallbackState, 'pack-state');
      if (samePack) return samePack;
    }
  }

  if (!requested || requested.id !== fallbackPack.id) {
    const defaultExact = candidate(fallbackPack, resolvedState, 'default-pack');
    if (defaultExact) return defaultExact;
    if (fallbackPack.fallbackState !== resolvedState) {
      const defaultFallback = candidate(fallbackPack, fallbackPack.fallbackState, 'default-pack');
      if (defaultFallback) return defaultFallback;
    }
  }

  const embeddedFrame = fallbackPack.frames[fallbackPack.fallbackState];
  return {
    requestedPackId: packId,
    resolvedPackId: fallbackPack.id,
    requestedState: displayState,
    resolvedState: fallbackPack.fallbackState,
    asset: EMBEDDED_AVATAR_ASSET,
    geometry: embeddedFrame?.geometry ?? unitGeometry(),
    fallback: 'embedded',
  };
}
