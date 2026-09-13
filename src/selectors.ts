import { occurrences, epoch, dateOf, addDays } from './core.ts';
import type { State, Reminder, Task } from './types.ts';
// Only reminders in the explicit due state belong in the unhandled inbox.
export const isPendingReminder=(r:Reminder)=>r.status==='due';
export const pendingReminders=(s:State)=>s.reminders.filter(isPendingReminder).sort((a,b)=>b.due-a.due);
export const openTasks=(tasks:Task[])=>tasks.filter(t=>!t.done);
export const overdueTasks=(tasks:Task[],now:number)=>openTasks(tasks).filter(t=>!!t.due&&epoch(t.due)<now);
export const reviewNotices=(s:State)=>s.notices.filter(n=>['UNPARSED','NEEDS_REVIEW','FAILED'].includes(n.parseStatus??'UNPARSED'));
export function attentionSummary(s:State,now:number){
  const notices=reviewNotices(s).length,reminders=pendingReminders(s).length,overdue=overdueTasks(s.tasks,now).length;
  return {notices,reminders,overdue,total:notices+reminders+overdue};
}
export const emptyScheduleText=(total:number)=>total?'当前教学周没有课程（已按周次及调停课筛选）':'尚未录入课表';

// Course colour carries course identity, so it must never depend on list order,
// the visible week or a reschedule: the same course is always the same colour
// everywhere it appears (weekly grid, today, TA 的安排).
export const courseTones=['sea','blue','violet','rose','amber'] as const;
export function courseTone(course:{id?:string;title?:string;person?:string}){
  const key=course.id||`${course.person??''}:${course.title??''}`;
  let hash=0;
  for(let i=0;i<key.length;i++)hash=(hash*31+key.charCodeAt(i))>>>0;
  return courseTones[hash%courseTones.length];
}

// Split cross-midnight occurrences for the week grid without changing occurrence identity.
export function scheduleDays(s:State,monday:string,person:string){
  const from=epoch(monday),to=epoch(addDays(monday,7));
  return occurrences(s,from,to,person).filter(o=>o.kind==='course').flatMap(o=>{
    const result=[];
    for(let day=dateOf(Math.max(o.start,from));epoch(day)<Math.min(o.end,to);day=addDays(day,1)){
      const start=Math.max(o.start,epoch(day)),end=Math.min(o.end,epoch(addDays(day,1)));
      const clock=(t:number)=>new Date(t+8*3600000).toISOString().slice(11,16);
      result.push({...o,segmentId:o.id+':'+day,day,startClock:clock(start),endClock:end===epoch(addDays(day,1))?'24:00':clock(end)});
    }
    return result;
  });
}
