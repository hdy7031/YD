const { contextBridge } = require('electron');
const now = Date.now();
const date = new Date(now + 8 * 3600000).toISOString().slice(0, 10);
const monday = new Date(Date.parse(date + 'T00:00:00+08:00') - (((new Date(date + 'T12:00:00Z').getUTCDay() || 7) - 1) * 86400000) + 8 * 3600000).toISOString().slice(0, 10);
const stamp = time => date + 'T' + time;
const periods = [{start:'08:00',end:'08:45'},{start:'08:55',end:'09:40'},{start:'10:00',end:'10:45'},{start:'10:55',end:'11:40'},{start:'14:00',end:'14:45'},{start:'14:55',end:'15:40'},{start:'16:00',end:'16:45'},{start:'16:55',end:'17:40'}];
let state = {
  version: 1,
  profiles: [
    {id:'me',name:'我',startDate:monday,weeks:20,periods,updatedAt:now},
    {id:'partner',name:'Ta',startDate:monday,weeks:20,periods,updatedAt:now}
  ],
  courses: [
    {id:'audit-course',person:'me',title:'界面验收课程',place:'教学楼 201',notes:'检查编辑、复制与删除入口',weekday:new Date(date+'T12:00:00Z').getUTCDay()||7,first:1,last:2,weeks:[1],reminders:[10],checklist:[{id:'check-1',text:'带上课堂资料',done:false}],updatedAt:now}
  ],
  exceptions: [],
  events: [{id:'audit-event',title:'界面验收会议',start:stamp('21:00'),end:stamp('23:59'),place:'线上',notes:'检查会议操作',reminders:[30],checklist:[],updatedAt:now}],
  tasks: [{id:'audit-task',title:'检查待办按钮',due:stamp('23:50'),notes:'用于隔离界面验收',done:false,checklist:[{id:'check-2',text:'核对反馈',done:false}],reminders:[0],updatedAt:now}],
  notices: [{id:'audit-notice',title:'学院群测试通知',text:'请核对活动时间与报名要求。',originalText:'请核对活动时间与报名要求。',state:'inbox',updatedAt:now}],
  reminders: [{id:'audit-reminder',target:'tasks:audit-task',title:'检查待办按钮',due:now-60000,status:'fired',firedAt:now-60000}],
  settings: {launch:false,setup:false},
  lastTick: now
};
const clone = value => structuredClone(value);
const listeners = new Set();
function change(command) {
  if (command.type === 'save') {
    const list = state[command.entity], index = list.findIndex(item => item.id === command.value.id);
    if (index < 0) list.push(clone(command.value)); else list[index] = clone(command.value);
  } else if (command.type === 'delete') {
    state[command.entity] = state[command.entity].filter(item => item.id !== command.id);
  } else if (command.type === 'settings') {
    state.settings = {...state.settings,...Object.fromEntries(Object.entries(command).filter(([key]) => key !== 'type'))};
  } else if (command.type === 'convert') {
    if (!state.tasks.some(item => item.sourceId === command.noticeId)) state.tasks.push({...clone(command.task),sourceId:command.noticeId});
  } else if (command.type === 'ack' || command.type === 'snooze') {
    state.reminders = state.reminders.filter(item => item.id !== command.id);
  } else if (command.type === 'importSchedule') {
    const people = new Set(command.value.profiles.map(profile => profile.id));
    state.profiles = state.profiles.map(profile => command.value.profiles.find(item => item.id === profile.id) || profile);
    state.courses = state.courses.filter(course => !people.has(course.person)).concat(command.value.courses);
  }
  for (const listener of listeners) listener();
  return Promise.resolve(clone(state));
}
contextBridge.exposeInMainWorld('dayhub',{
  live:async()=>({now:Date.now(),source:'北京时间 · 测试时钟',people:[],pending:1,preferences:{mode:'custom',size:'medium',animate:false,bubbles:true,duration:8,pausedUntil:0}}),
  onLive:()=>()=>{},onSettings:()=>()=>{},window:async()=>{},pointer:async()=>{},bubble:async()=>{},presence:async()=>{},
  get: async () => clone(state),
  change,
  chooseSchedule: async () => ({format:'dayhub-schedule',version:1,termName:'2026 秋季',profiles:[{id:'me',name:'我',startDate:monday,weeks:20,periods}],courses:[{id:'import-course',person:'me',title:'导入预览课程',place:'A101',notes:'',weekday:1,first:1,last:2,weeks:[1,2],reminders:[10],checklist:[]}]}),
  importImage: async () => null,
  pasteImage: async () => null,
  image: async () => '',
  ocr: async () => '',
  backup: async () => 'C:\\隔离测试\\YD备份.dayhub',
  restore: async () => clone(state),
  testNotification: async () => '测试通知已提交。',
  toggle: async () => {},
  beginDrag: async () => {},
  drag: async () => {},
  endDrag: async () => {},
  subscribe(callback){listeners.add(callback);return()=>listeners.delete(callback);},
  onError: () => () => {}
});
