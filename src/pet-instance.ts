import { DEFAULT_AVATAR_PACK_ID, type AvatarPackId } from './avatar.ts';
import { resolvePetSubject } from './people.ts';
import type { PersonId, State } from './types.ts';

export interface PetInstance {
  subjectId: PersonId;
  avatarPackId: AvatarPackId;
}

/** Pure runtime projection: identity comes only from resolvePetSubject. */
export function resolvePetInstance(state: Pick<State, 'profiles'>): PetInstance {
  const subject = resolvePetSubject(state);
  const selected = subject.avatar?.packId;
  return {
    subjectId: subject.id,
    avatarPackId: typeof selected === 'string' && selected.trim() ? selected : DEFAULT_AVATAR_PACK_ID,
  };
}
