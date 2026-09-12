import type { Reminder } from './types.ts';
// Scheduling owns when/what; the host owns delivery. No transport data in Reminder.
export interface ReminderDelivery { deliver(reminders:Reminder[],summary:boolean):void }
export class DesktopDelivery implements ReminderDelivery {
  private notify:(title:string,body:string)=>void;
  constructor(notify:(title:string,body:string)=>void){this.notify=notify;}
  deliver(reminders:Reminder[],summary:boolean){if(!reminders.length)return;if(summary||reminders.length>1)this.notify('YD · 待处理提醒',`${reminders.length} 项提醒已到时间，请打开查看。`);else this.notify(reminders[0].title,'安排已到提醒时间，点击查看并处理。');}
}
