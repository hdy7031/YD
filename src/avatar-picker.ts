import { DEFAULT_AVATAR_PACK_ID, getAvatarPack, type AvatarPackId } from './avatar.ts';
import type { Profile } from './types.ts';

export interface AvatarPickerSelection {
  persistedPackId: AvatarPackId;
  previewPackId: AvatarPackId;
  unavailable: boolean;
}

/** Pure UI projection: it never repairs or writes an unavailable selection. */
export function resolveAvatarPickerSelection(profile: Pick<Profile, 'avatar'>): AvatarPickerSelection {
  const persistedPackId = profile.avatar?.packId ?? DEFAULT_AVATAR_PACK_ID;
  const available = getAvatarPack(persistedPackId);
  return {
    persistedPackId,
    previewPackId: available?.id ?? DEFAULT_AVATAR_PACK_ID,
    unavailable: !available,
  };
}
