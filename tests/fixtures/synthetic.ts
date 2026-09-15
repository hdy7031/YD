// 合成课表 fixture 的加载器。
//
// v0.3 Phase 0 起，正式测试不再读取开发者私人课表（ingest/），
// 统一从这里取得完全虚构的人物、课程与学期。
// 人物 Alex / Sam 与 legacy id 'me' / 'partner' 的对应关系会在
// v0.3 Phase 1 的 Person 迁移中解除，本文件是唯一的测试入口。
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { apply, epoch } from '../../src/core.ts';
import { togetherWorkspace } from '../helpers/workspaces.ts';
import { migrateLive } from '../../src/live.ts';
import type { SchedulePackage, State } from '../../src/types.ts';

export const syntheticScheduleFile = fileURLToPath(new URL('./synthetic-schedule.json', import.meta.url));
/** 学期锚点：Alex 2027-03-01（周一）起 16 周；Sam 2027-02-22（周一）起 20 周暂定。 */
export const syntheticTermStart = epoch('2027-03-01T00:00');

export function syntheticSchedule(): SchedulePackage {
  return JSON.parse(fs.readFileSync(syntheticScheduleFile, 'utf8')) as SchedulePackage;
}

// 用与产品相同的命令构建状态：先建空状态，再导入合成课表，最后跑一次 live 迁移，
// 因此 fixture 与真实升级路径共享同一套不变量。
export function syntheticState(now = epoch('2027-02-22T00:00')): State {
  return migrateLive(apply(togetherWorkspace(now), { type: 'importSchedule', value: syntheticSchedule() }, now));
}
