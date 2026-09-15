// 界面外壳的人员视图模型。
//
// 导航、「所属课表」选项、课程所属文案都从**当前活跃人物**派生：
// Solo 只有本人页（即使数据库里保留着一个 inactive companion），Together 才有同行者页；
// 不存在"点进去是空白"的固定 Ta 页。活跃边界来自 people.ts 的 activeProfiles，
// 这里只做纯派生，方便在 Solo / Together / retained companion 三种数据下单独测试。
import { activeCompanionProfile, activeProfiles, effectiveRole } from '../people.ts';
import type { PersonId, Profile, State } from '../types.ts';

type PeopleState = Pick<State, 'profiles'> & { settings?: State['settings'] };

export type TabKind = 'today' | 'person' | 'courses' | 'tasks' | 'inbox' | 'reminders' | 'settings';
export interface ShellTab { key: string; kind: TabKind; label: string; personId?: PersonId }

// 页面宽度策略沿用既有视觉（同行者页仍然是 width-partner）。
export const tabWidthPolicy: Record<TabKind, string> = {
  today: 'width-adaptive', person: 'width-partner', courses: 'width-fluid', tasks: 'width-adaptive',
  inbox: 'width-adaptive', reminders: 'width-constrained', settings: 'width-constrained',
};

/**
 * 同行者的默认 UI 称呼。领域层（role / id）永远是身份真相；
 * 「TA」只是没有用户自定义名称时的展示 fallback。
 * 0.2.x 的默认档案名就是「Ta」，迁移会把旧称呼统一成它，因此它不算用户设置。
 */
export const COMPANION_FALLBACK_LABEL = 'TA';

/** 同行者展示名：用户设置的档案名称优先，空名 / 历史默认「Ta」回退到 TA。 */
export function companionDisplayName(profile: Pick<Profile, 'name'> | undefined): string {
  const name = profile?.name?.trim() ?? '';
  return !name || name === 'Ta' || name === 'TA' ? COMPANION_FALLBACK_LABEL : name;
}

/** 安排归属文案：本人永远是「我的安排」，同行者用档案名称（默认 TA）。 */
export function courseTableLabel(profile: Pick<Profile, 'id' | 'role' | 'name'>, index = 0): string {
  return effectiveRole(profile, index) === 'self' ? '我的安排' : `${companionDisplayName(profile)}的安排`;
}

export function profileLabelFor(state: Pick<State, 'profiles'>, personId?: PersonId): string {
  if (!personId) return '未选择';
  const index = state.profiles.findIndex(profile => profile.id === personId);
  return index < 0 ? personId : courseTableLabel(state.profiles[index], index);
}

/** 「所属课表」等人员选项也只列当前活跃人物：Solo 下不会出现被停用的 companion。 */
export function personOptions(state: PeopleState): { value: PersonId; label: string }[] {
  const active = activeProfiles(state);
  return active.map((profile, index) => ({ value: profile.id, label: courseTableLabel(profile, index) }));
}

/** 导航：本人页永远存在，同行者页只在**当前使用方式为双人**且同行者存在时出现。 */
export function shellTabs(state: PeopleState): ShellTab[] {
  const tabs: ShellTab[] = [{ key: 'today', kind: 'today', label: '我的安排' }];
  const companion = activeCompanionProfile(state);
  if (companion) tabs.push({ key: companion.id, kind: 'person', label: `${companionDisplayName(companion)}的安排`, personId: companion.id });
  tabs.push(
    { key: 'courses', kind: 'courses', label: '课表管理' },
    { key: 'tasks', kind: 'tasks', label: '事项与会议' },
    { key: 'inbox', kind: 'inbox', label: '通知收件箱' },
    { key: 'reminders', kind: 'reminders', label: '未处理提醒' },
    { key: 'settings', kind: 'settings', label: '设置与备份' },
  );
  return tabs;
}

/** 键盘导航沿用「第 N 个标签页」的位置语义（Solo 下自然少一页）。 */
export function tabShortcuts(tabs: ShellTab[]): Record<string, string> {
  return Object.fromEntries(tabs.slice(0, 5).map((tab, index) => [String(index + 1), tab.key]));
}
