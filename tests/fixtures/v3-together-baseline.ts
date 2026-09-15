// 门禁用的**最小双人工作区**（v3 形态）：只有两个档案 + 合成学期待，业务集合全空。
//
// Phase 5A 起，生产 fresh install 是 Solo（只有一个 self），因此需要双人的门禁必须在启动前
// 显式种下这份数据。它刻意不携带课程 / 待办 / 会议 / 通知 / 提醒：
//   * 每个门禁自己 `importSchedule` 或创建它要用的业务记录，fixture 不会偷偷影响
//     pending / 需要处理 / 提醒计数这类断言；
//   * 学期起始日与合成课表一致（Alex 2027-03-01、Sam 2027-02-22 暂定），但节次用平台的中性
//     占位作息（08:00–17:40 八节）：虚拟时钟跑在 2027-03 的门禁因此仍落在学期内，
//     而且"第 4 节 = 10:55–11:40"这类节次算术与旧的默认工作区完全一致；
//   * 保持在 v3（Phase 2A 之前）：没有 routine / avatar / manualOverrides，
//     由 app 启动时的正式迁移补齐，顺带覆盖"老库升级"路径。
import { PLACEHOLDER_PERIODS, epoch } from '../../src/core.ts';
import { ROUTINE_DOMAIN_VERSION } from '../../src/migration.ts';
import { effectiveRole } from '../../src/people.ts';
import type { Profile, State } from '../../src/types.ts';
import { syntheticSchedule } from './synthetic.ts';

export const togetherBaselineNow = epoch('2027-02-22T00:00');

export function v3TogetherBaseline(now = togetherBaselineNow): State {
  const schedule = syntheticSchedule();
  const profiles: Profile[] = schedule.profiles.map((raw, index) => {
    const incoming = structuredClone(raw) as Omit<Profile, 'updatedAt' | 'routine' | 'avatar'> & { updatedAt?: number };
    delete (incoming as { routine?: unknown }).routine;
    delete (incoming as { avatar?: unknown }).avatar;
    return {
      ...incoming,
      role: effectiveRole({ id: incoming.id }, index),
      // 不沿用课表包里的"某所学校"时间表：门禁用平台中性占位作息。
      periods: structuredClone(PLACEHOLDER_PERIODS),
      // 与旧默认工作区一致：中性 20 周学期，门禁可以自由写入 1—20 周的课程。
      weeks: 20,
      updatedAt: now,
    };
  });
  const state: State = {
    version: 1,
    profiles,
    courses: [], exceptions: [], events: [], tasks: [], notices: [], reminders: [], manualOverrides: [],
    settings: { domainVersion: ROUTINE_DOMAIN_VERSION - 1, launch: false, setup: true, trayResident: true },
    lastTick: now,
    // 与真实数据库一致：收件箱版本由 app 首次写入，fixture 直接带上避免 pack 时补写差异。
    inboxVersion: 1,
  };
  // v5（Phase 3C）之前没有临时状态：fixture 固定表示 v3 形态，由启动迁移补齐。
  delete (state as { manualOverrides?: unknown }).manualOverrides;
  return state;
}
