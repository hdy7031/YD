import { DEFAULT_AVATAR_PACK_ID, getAvatarPack, type AvatarPackId } from './avatar.ts';
import { getProfileById } from './people.ts';
import type { AvatarSelection, PersonId, State } from './types.ts';

export function isAvatarSelection(value: unknown): value is AvatarSelection {
  if (!value || typeof value !== 'object') return false;
  const selection = value as AvatarSelection;
  return typeof selection.packId === 'string' && selection.packId.trim().length > 0
    && (selection.source === 'default' || selection.source === 'user');
}

export function assertAvatarSelection(value: unknown, context = 'Avatar 选择'): asserts value is AvatarSelection {
  if (!isAvatarSelection(value)) throw new Error(`${context}无效`);
}

export function setAvatarPack(state: State, personId: PersonId, packId: AvatarPackId, now: number): void {
  const profile = getProfileById(state, personId);
  if (!profile) throw new Error('个人档案不存在');
  if (typeof packId !== 'string' || !packId.trim()) throw new Error('Avatar Pack 编号不能为空');
  if (!getAvatarPack(packId)) throw new Error('Avatar Pack 不存在');
  profile.avatar = { packId, source: 'user' };
  profile.updatedAt = now;
}

export function resetAvatarPack(state: State, personId: PersonId, now: number): void {
  const profile = getProfileById(state, personId);
  if (!profile) throw new Error('个人档案不存在');
  profile.avatar = { packId: DEFAULT_AVATAR_PACK_ID, source: 'default' };
  profile.updatedAt = now;
}
