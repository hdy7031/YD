// v2 → v3 迁移用的合成 legacy fixture。
//
// 它表示"Phase 1A 之后、Phase 1B 之前"的一份旧工作区：档案已经有角色、domainVersion = 2，
// 但仍然带着 v0.2 时代的历史形态：
//   * 会议没有 person（v3 才引入归属）；
//   * 课程缺少 activity；
//   * 同行者使用旧的显示称呼、没有 tentative，学期是 v0.2 时代的暂定学期。
//
// 这里复刻的是**既有迁移规则的条件**（见 src/migration.ts 的 LEGACY_V2_RULES），
// 不是任何真实用户数据：人物、课程、日期都来自 tests/fixtures 的合成课表，
// 只把被规则检查的字段改成旧的形状。
import { validateState } from '../../src/core.ts';
import { getCompanionProfile, getSelfProfile } from '../../src/people.ts';
import { identityRoleMigration, LEGACY_V2_RULES } from '../../src/migration.ts';
import type { State } from '../../src/types.ts';
import { v020Synthetic } from './v020-synthetic.ts';

export function v2LegacySynthetic(): State {
  const state = identityRoleMigration(v020Synthetic());
  const companion = getCompanionProfile(state)!;
  const self = getSelfProfile(state)!;

  // 旧称呼 + 旧暂定学期（规则输入）。
  companion.name = LEGACY_V2_RULES.companionNames[2];
  companion.tentative = undefined;
  companion.startDate = LEGACY_V2_RULES.tentativeTerm.startDate;
  companion.weeks = LEGACY_V2_RULES.tentativeTerm.weeks;

  // 课程 activity 缺省：一条命中 v0.2 教研规则，一条是普通课程。
  const companionCourse = state.courses.find(course => course.person === companion.id)!;
  companionCourse.title = LEGACY_V2_RULES.researchCourseTitle;
  delete companionCourse.activity;
  const selfCourse = state.courses.find(course => course.person === self.id)!;
  delete selfCourse.activity;

  // v2 没有会议归属，也没有 domainVersion 3。
  for(const event of state.events) delete event.person;
  state.settings.domainVersion = 2;
  return validateState(state);
}
