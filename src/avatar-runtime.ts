// Runtime resource lifecycle for Avatar Packs.
//
// This is intentionally below the Avatar registry/resolver contract: it has no
// access to profiles, CurrentState, CompanionDisplay or persistence.  A caller
// supplies a requested pack id plus the infrastructure loader/decoder, and the
// runtime keeps the last decoded visual alive until a newer request is ready.
import type { AvatarPackId } from './avatar.ts';

export interface AvatarRuntimeResource<T> {
  /** The registry Pack that owns the decoded resources. */
  resolvedPackId: AvatarPackId;
  version: string;
  value: T;
}

/** Renderer → main acknowledgement after a Pack is browser-decodable. */
export interface AvatarVisualReady {
  requestedPackId: AvatarPackId;
  resolvedPackId: AvatarPackId;
  version: string;
}

export interface ActiveAvatarVisual<T> extends AvatarRuntimeResource<T> {
  /** The selection that initiated this visual; it is never persisted here. */
  requestedPackId: AvatarPackId;
  generation: number;
}

export type AvatarRuntimeTransition<T> =
  | { kind: 'committed'; generation: number; active: ActiveAvatarVisual<T> }
  | { kind: 'stale'; generation: number; active?: ActiveAvatarVisual<T> }
  | { kind: 'failed'; generation: number; active?: ActiveAvatarVisual<T>; error: unknown };

export interface AvatarRuntimeOptions<T> {
  /** Resolves only registry metadata, so the cache is version-aware before IO. */
  resolve(requestedPackId: AvatarPackId): { id: AvatarPackId; version: string };
  /** Main/infrastructure resource lookup. It must not decide display state. */
  load(requestedPackId: AvatarPackId): Promise<AvatarRuntimeResource<T>>;
  /** Browser-side preparation (for example Image.decode). */
  decode(value: T): Promise<T>;
  /** Optional post-decode identity when availability resolved to another Pack. */
  identify?(value: T, resource: AvatarRuntimeResource<T>): { resolvedPackId: AvatarPackId; version: string };
}

export class AvatarRuntime<T> {
  private readonly cache = new Map<string, Promise<AvatarRuntimeResource<T>>>();
  private generation = 0;
  private active?: ActiveAvatarVisual<T>;
  private readonly options: AvatarRuntimeOptions<T>;

  constructor(options: AvatarRuntimeOptions<T>) { this.options = options; }

  get activeVisual(): ActiveAvatarVisual<T> | undefined { return this.active; }
  get requestedGeneration(): number { return this.generation; }
  get cacheSize(): number { return this.cache.size; }

  private cacheKey(requestedPackId: AvatarPackId): string {
    const pack = this.options.resolve(requestedPackId);
    return `${pack.id}@${pack.version}`;
  }

  /** Lazy, process-lifetime resource lookup. Calling this never changes active visual. */
  loadAvatarPack(requestedPackId: AvatarPackId): Promise<AvatarRuntimeResource<T>> {
    const key = this.cacheKey(requestedPackId);
    let pending = this.cache.get(key);
    if (!pending) {
      pending = this.options.load(requestedPackId).then(async resource => {
        const value = await this.options.decode(resource.value);
        const identity = this.options.identify?.(value, resource) ?? resource;
        return { ...resource, ...identity, value };
      });
      this.cache.set(key, pending);
      // A failed resource is not a valid cache entry: a later request may retry it.
      void pending.catch(() => { if (this.cache.get(key) === pending) this.cache.delete(key); });
    }
    return pending;
  }

  /**
   * Prepare a requested Pack and commit only when it is still the newest
   * request. `commit` is the renderer/main handshake for geometry; returning
   * false means the selection changed while the image was being decoded.
   */
  async request(
    requestedPackId: AvatarPackId,
    commit: (resource: AvatarRuntimeResource<T>) => Promise<boolean> | boolean = () => true,
  ): Promise<AvatarRuntimeTransition<T>> {
    const generation = ++this.generation;
    try {
      const resource = await this.loadAvatarPack(requestedPackId);
      if (generation !== this.generation) return { kind: 'stale', generation, active: this.active };
      const accepted = await commit(resource);
      if (generation !== this.generation || !accepted) return { kind: 'stale', generation, active: this.active };
      this.active = { ...resource, requestedPackId, generation };
      return { kind: 'committed', generation, active: this.active };
    } catch (error) {
      if (generation !== this.generation) return { kind: 'stale', generation, active: this.active };
      return { kind: 'failed', generation, active: this.active, error };
    }
  }
}
