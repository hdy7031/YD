import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_AVATAR_PACK_ID,
  EMBEDDED_AVATAR_ASSET,
  PIXEL_AVATAR_PACK_ID,
  assertAvatarPackManifest,
  builtinAvatarRegistry,
  createAvatarPackRegistry,
  getAvatarPack,
  listAvatarPacks,
  resolveAvatarFrame,
  resolveAvatarPack,
  ydDefaultAvatarPack,
  ydPixelAvatarPack,
  type AvatarPackManifest,
} from '../src/avatar.ts';
import { resolvePetState } from '../src/companion-display.ts';
import { resolveAvatarPickerSelection } from '../src/avatar-picker.ts';
import { stateLabel } from '../src/state/presentation.ts';
import type { PersonStatus } from '../src/live.ts';

const fixturePack = (patch: Partial<AvatarPackManifest> = {}): AvatarPackManifest => ({
  id: 'test-tall',
  version: '7.2.0',
  name: 'Test Tall',
  source: 'builtin',
  assetRoot: 'companion/test-tall',
  canvas: { width: 800, height: 1200 },
  previewState: 'busy_class',
  fallbackState: 'idle',
  frames: {
    idle: { asset: 'still', geometry: { scale: 0.75, offsetX: 11, offsetY: -9 } },
    busy_class: { asset: 'lesson', geometry: { scale: 1.2, offsetX: -7, offsetY: 13 } },
  },
  ...patch,
});

test('4A registry: default pack is stable, unique, validated and safely resolved', () => {
  assert.equal(DEFAULT_AVATAR_PACK_ID, 'yd-default');
  assert.ok(getAvatarPack(DEFAULT_AVATAR_PACK_ID));
  assert.equal(getAvatarPack(DEFAULT_AVATAR_PACK_ID)?.version, '1.0.0');
  assert.doesNotThrow(() => assertAvatarPackManifest(getAvatarPack(DEFAULT_AVATAR_PACK_ID)!));
  const first = listAvatarPacks().map(pack => pack.id);
  const second = listAvatarPacks().map(pack => pack.id);
  assert.deepEqual(first, second);
  assert.equal(new Set(first).size, first.length);
  assert.equal(getAvatarPack('unknown'), undefined);
  assert.equal(resolveAvatarPack('unknown').id, DEFAULT_AVATAR_PACK_ID);
  assert.throws(() => createAvatarPackRegistry([ydDefaultAvatarPack, { ...ydDefaultAvatarPack }]), /duplicated/);
});

test('4A manifest validation rejects invalid identity, canvas, states, assets and geometry', () => {
  const invalid = fixturePack({
    id: '',
    version: '',
    assetRoot: '../escape',
    canvas: { width: 0, height: Number.NaN },
    fallbackState: 'unknown' as 'idle',
    previewState: 'unknown' as 'idle',
    frames: { idle: { asset: '', geometry: { scale: 0, offsetX: Number.NaN, offsetY: Infinity } } },
  });
  assert.throws(() => assertAvatarPackManifest(invalid), /id must not be empty.*version must not be empty.*assetRoot.*canvas width.*canvas height.*fallbackState.*previewState.*asset.*scale.*offsetX.*offsetY/s);
  assert.throws(() => assertAvatarPackManifest(fixturePack({ frames: { busy_class: fixturePack().frames.busy_class } })), /fallback frame is missing/);
});

test('4A frame resolver follows exact, same-pack, default-pack and embedded order', () => {
  const second = fixturePack();
  const registry = createAvatarPackRegistry([ydDefaultAvatarPack, second]);
  const exact = resolveAvatarFrame(second.id, 'busy_class', { registry });
  assert.equal(exact.asset, 'lesson');
  assert.equal(exact.resolvedPackId, second.id);
  assert.equal(exact.resolvedState, 'busy_class');
  assert.equal(exact.fallback, 'none');

  const missing = resolveAvatarFrame(second.id, 'reminder', { registry });
  assert.equal(missing.asset, 'still');
  assert.equal(missing.resolvedPackId, second.id);
  assert.equal(missing.resolvedState, 'idle');
  assert.equal(missing.fallback, 'pack-state');

  const unknown = resolveAvatarFrame('missing-pack', 'busy_class', { registry });
  assert.equal(unknown.resolvedPackId, DEFAULT_AVATAR_PACK_ID);
  assert.equal(unknown.resolvedState, 'busy_class');
  assert.equal(unknown.fallback, 'default-pack');

  const damagedSelected = resolveAvatarFrame(second.id, 'busy_class', {
    registry,
    hasAsset: (packId, asset) => packId === DEFAULT_AVATAR_PACK_ID && asset === 'busy_class',
  });
  assert.equal(damagedSelected.resolvedPackId, DEFAULT_AVATAR_PACK_ID);
  assert.equal(damagedSelected.resolvedState, 'busy_class');
  assert.equal(damagedSelected.fallback, 'default-pack');

  const sparseDefault: AvatarPackManifest = {
    ...ydDefaultAvatarPack,
    frames: { idle: ydDefaultAvatarPack.frames.idle },
  };
  const sparseRegistry = createAvatarPackRegistry([sparseDefault]);
  const defaultIdle = resolveAvatarFrame(DEFAULT_AVATAR_PACK_ID, 'reminder', { registry: sparseRegistry });
  assert.equal(defaultIdle.resolvedState, 'idle');
  assert.equal(defaultIdle.fallback, 'pack-state');

  const catastrophic = resolveAvatarFrame(second.id, 'reminder', { registry, hasAsset: () => false });
  assert.equal(catastrophic.asset, EMBEDDED_AVATAR_ASSET);
  assert.equal(catastrophic.fallback, 'embedded');
});

test('4A geometry is pack-specific and a missing frame keeps same-pack idle geometry', () => {
  const second = fixturePack();
  const registry = createAvatarPackRegistry([ydDefaultAvatarPack, second]);
  const defaultClass = resolveAvatarFrame(DEFAULT_AVATAR_PACK_ID, 'busy_class', { registry });
  const secondClass = resolveAvatarFrame(second.id, 'busy_class', { registry });
  const secondMissing = resolveAvatarFrame(second.id, 'reminder', { registry });
  assert.deepEqual(defaultClass.geometry, { scale: 1, offsetX: 0, offsetY: 0 });
  assert.deepEqual(secondClass.geometry, { scale: 1.2, offsetX: -7, offsetY: 13 });
  assert.deepEqual(secondMissing.geometry, { scale: 0.75, offsetX: 11, offsetY: -9 });
  assert.notDeepEqual(secondMissing.geometry, defaultClass.geometry);
  assert.deepEqual(second.canvas, { width: 800, height: 1200 });
  assert.deepEqual(getAvatarPack(DEFAULT_AVATAR_PACK_ID, builtinAvatarRegistry)?.canvas, { width: 412, height: 411 });
});

test('4A regression: reminder selects an Avatar visual without changing class CurrentState', () => {
  const current = { personId: 'partner', kind: 'class', label: 'Algorithms', source: 'schedule', startAt: 1, endAt: 2, priority: 80 } as const;
  const person = {
    person: 'partner', alias: 'Y', code: 'BUSY_CLASS', current, routine: null,
    today: [], next: undefined, conflict: false, research: false, tentative: false,
  } as unknown as PersonStatus;
  const display = resolvePetState({ people: [person], subjectId: 'partner', pending: 1, now: 10, reminderSince: 10 });
  const avatar = resolveAvatarFrame(DEFAULT_AVATAR_PACK_ID, display.state);
  assert.equal(display.state, 'reminder');
  assert.equal(avatar.asset, 'reminder');
  assert.equal(current.kind, 'class');
  assert.equal(stateLabel(current), '上课中');
});

test('4C2 production registry includes an independent transparent yd-pixel pack', () => {
  assert.equal(PIXEL_AVATAR_PACK_ID, 'yd-pixel');
  assert.deepEqual(listAvatarPacks().map(pack => pack.id), ['yd-default', 'yd-pixel']);
  assert.deepEqual(getAvatarPack(PIXEL_AVATAR_PACK_ID), ydPixelAvatarPack);
  assert.deepEqual(ydPixelAvatarPack.canvas, { width: 401, height: 398 });
  assert.notEqual(ydPixelAvatarPack.assetRoot, ydDefaultAvatarPack.assetRoot);
  assert.notDeepEqual(ydPixelAvatarPack.frames.reminder?.geometry, ydDefaultAvatarPack.frames.reminder?.geometry);
  for (const [state, frame] of Object.entries(ydPixelAvatarPack.frames)) {
    assert.ok(frame, `${state} frame missing`);
    const file = path.join(process.cwd(), 'src', 'ui', 'assets', ...ydPixelAvatarPack.assetRoot.split('/'), `${frame.asset}.png`);
    const bytes = fs.readFileSync(file);
    assert.ok(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `${state} is not PNG`);
    assert.equal(bytes.readUInt32BE(16), 401, `${state} width`);
    assert.equal(bytes.readUInt32BE(20), 398, `${state} height`);
    assert.equal(bytes[25], 6, `${state} must be RGBA`);
  }
});

test('4C2 removed-pack Picker stays safe without rewriting the persisted selection', () => {
  const profile = { avatar: { packId: 'removed-pack', source: 'user' as const } };
  const before = structuredClone(profile);
  assert.deepEqual(resolveAvatarPickerSelection(profile), {
    persistedPackId: 'removed-pack',
    previewPackId: DEFAULT_AVATAR_PACK_ID,
    unavailable: true,
  });
  assert.deepEqual(profile, before);
});
