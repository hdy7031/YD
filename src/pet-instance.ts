import { DEFAULT_AVATAR_PACK_ID, type AvatarPackId } from './avatar.ts';
import { resolvePetSubject } from './people.ts';
import type { PersonId, State } from './types.ts';

export interface PetInstance {
  subjectId: PersonId;
  avatarPackId: AvatarPackId;
}

/**
 * Pure runtime projection: identity comes only from resolvePetSubject.
 * PetInstance 不持久化 —— 主体 / 状态 / 形象都从 State 现算，所以切换主体
 * （settings.petSubjectRole）在下一个投影里立刻生效，不需要重启。
 */
export function resolvePetInstance(state: Pick<State, 'profiles'> & { settings?: State['settings'] }): PetInstance {
  const subject = resolvePetSubject(state);
  const selected = subject.avatar?.packId;
  return {
    subjectId: subject.id,
    avatarPackId: typeof selected === 'string' && selected.trim() ? selected : DEFAULT_AVATAR_PACK_ID,
  };
}
