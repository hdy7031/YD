import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_AVATAR_PACK_ID, resolveAvatarFrame } from '../src/avatar.ts';
import { apply, epoch, validateState } from '../src/core.ts';
import { togetherWorkspace } from './helpers/workspaces.ts';
import { snapshot } from '../src/live.ts';
import { resolvePetInstance } from '../src/pet-instance.ts';
import type { State } from '../src/types.ts';

const now = epoch('2027-03-01T10:00');

test('Avatar commands independently set and reset self and companion selections', () => {
  const base = togetherWorkspace(now);
  const selfId = base.profiles.find(profile => profile.role === 'self')!.id;
  const companionId = base.profiles.find(profile => profile.role === 'companion')!.id;

  const selfSet = apply(base, { type: 'avatarSet', personId: selfId, packId: DEFAULT_AVATAR_PACK_ID }, now + 1);
  assert.deepEqual(selfSet.profiles.find(profile => profile.id === selfId)!.avatar, { packId: DEFAULT_AVATAR_PACK_ID, source: 'user' });
  assert.deepEqual(selfSet.profiles.find(profile => profile.id === companionId)!.avatar, base.profiles.find(profile => profile.id === companionId)!.avatar);

  const companionSet = apply(selfSet, { type: 'avatarSet', personId: companionId, packId: DEFAULT_AVATAR_PACK_ID }, now + 2);
  assert.deepEqual(companionSet.profiles.find(profile => profile.id === companionId)!.avatar, { packId: DEFAULT_AVATAR_PACK_ID, source: 'user' });
  assert.deepEqual(apply(companionSet, { type: 'avatarReset', personId: selfId }, now + 3).profiles.find(profile => profile.id === selfId)!.avatar,
    { packId: DEFAULT_AVATAR_PACK_ID, source: 'default' });
  assert.deepEqual(apply(companionSet, { type: 'avatarReset', personId: companionId }, now + 4).profiles.find(profile => profile.id === companionId)!.avatar,
    { packId: DEFAULT_AVATAR_PACK_ID, source: 'default' });
});

test('Avatar commands reject unknown people, empty pack ids and unknown packs; companion remains authorized', () => {
  const state = togetherWorkspace(now);
  const companionId = state.profiles.find(profile => profile.role === 'companion')!.id;
  assert.doesNotThrow(() => apply(state, { type: 'avatarSet', personId: companionId, packId: DEFAULT_AVATAR_PACK_ID }, now));
  assert.throws(() => apply(state, { type: 'avatarSet', personId: 'ghost', packId: DEFAULT_AVATAR_PACK_ID }, now), /档案不存在/);
  assert.throws(() => apply(state, { type: 'avatarSet', personId: companionId, packId: '' }, now), /不能为空/);
  assert.throws(() => apply(state, { type: 'avatarSet', personId: companionId, packId: 'missing-pack' }, now), /不存在/);
  assert.throws(() => apply(state, { type: 'avatarReset', personId: 'ghost' }, now), /档案不存在/);
});

test('generic Profile save cannot bypass Avatar command registry validation', () => {
  const state = togetherWorkspace(now);
  const self = state.profiles.find(profile => profile.role === 'self')!;
  const saved = apply(state, { type: 'save', entity: 'profiles', value: { ...self, name: 'Alex', avatar: { packId: 'missing-pack', source: 'user' } } }, now + 1);
  assert.equal(saved.profiles.find(profile => profile.id === self.id)!.name, 'Alex');
  assert.deepEqual(saved.profiles.find(profile => profile.id === self.id)!.avatar, self.avatar);
});

test('Solo can add a companion with the registered default Avatar', () => {
  const state = togetherWorkspace(now);
  const self = state.profiles.find(profile => profile.role === 'self')!;
  state.profiles = [self];
  const added = apply(state, { type: 'save', entity: 'profiles', value: {
    ...self, id: 'guest', role: 'companion', name: 'Guest', shortAlias: 'D', avatar: { packId: 'missing-pack', source: 'user' },
  } }, now + 1);
  assert.equal(added.profiles.length, 2);
  assert.deepEqual(added.profiles.find(profile => profile.id === 'guest')!.avatar, { packId: DEFAULT_AVATAR_PACK_ID, source: 'default' });
  assert.doesNotThrow(() => validateState(added));
});

test('PetInstance uses role-based subject selection and survives profile reordering', () => {
  const together = togetherWorkspace(now);
  const self = together.profiles.find(profile => profile.role === 'self')!;
  const companion = together.profiles.find(profile => profile.role === 'companion')!;
  self.avatar = { packId: 'self-pack', source: 'user' };
  companion.avatar = { packId: 'companion-pack', source: 'user' };
  assert.deepEqual(resolvePetInstance(together), { subjectId: companion.id, avatarPackId: 'companion-pack' });
  together.profiles.reverse();
  assert.deepEqual(resolvePetInstance(together), { subjectId: companion.id, avatarPackId: 'companion-pack' });

  const solo = structuredClone(together);
  solo.profiles = [self];
  assert.deepEqual(resolvePetInstance(solo), { subjectId: self.id, avatarPackId: 'self-pack' });
});

test('missing Avatar is defensive-defaulted; unknown persisted pack remains selected and resolves safely', () => {
  const state = togetherWorkspace(now);
  const companion = state.profiles.find(profile => profile.role === 'companion')!;
  delete companion.avatar;
  assert.equal(resolvePetInstance(state).avatarPackId, DEFAULT_AVATAR_PACK_ID);

  companion.avatar = { packId: 'removed-pack', source: 'user' };
  assert.doesNotThrow(() => validateState(state));
  const before = structuredClone(state);
  const instance = resolvePetInstance(state);
  assert.equal(instance.avatarPackId, 'removed-pack');
  const frame = resolveAvatarFrame(instance.avatarPackId, 'busy_class');
  assert.equal(frame.resolvedPackId, DEFAULT_AVATAR_PACK_ID);
  assert.equal(frame.fallback, 'default-pack');
  assert.deepEqual(state, before, 'runtime fallback must not rewrite persisted selection');
});

test('Avatar mutation does not alter CurrentState, schedules, routines or manual overrides', () => {
  const state = togetherWorkspace(now);
  const self = state.profiles.find(profile => profile.role === 'self')!;
  state.courses.push({ id: 'class-1', person: self.id, title: '算法', place: 'A1', notes: '', weekday: 1, first: 3, last: 3, weeks: [1], reminders: [], checklist: [], createdAt:now, updatedAt: now });
  const beforeLive = snapshot(state, now);
  const beforeCollections = structuredClone({ courses: state.courses, routines: state.profiles.map(profile => profile.routine), manualOverrides: state.manualOverrides });
  const changed = apply(state, { type: 'avatarSet', personId: self.id, packId: DEFAULT_AVATAR_PACK_ID }, now + 1);
  const afterLive = snapshot(changed, now);
  assert.deepEqual(afterLive.people.find(person => person.person === self.id)!.current, beforeLive.people.find(person => person.person === self.id)!.current);
  assert.deepEqual({ courses: changed.courses, routines: changed.profiles.map(profile => profile.routine), manualOverrides: changed.manualOverrides }, beforeCollections);
});
