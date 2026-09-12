const { contextBridge } = require('electron');

const now = Date.now();
const date = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(new Date());
const weekday = new Date(`${date}T12:00:00Z`).getUTCDay() || 7;
const monday = new Date(Date.parse(`${date}T12:00:00Z`) - (weekday - 1) * 86400000).toISOString().slice(0, 10);
const addDays = days => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const hour = String(new Date(now + 8 * 3600000).getUTCHours()).padStart(2, '0');
const minute = String(new Date(now + 8 * 3600000).getUTCMinutes()).padStart(2, '0');
const periods = [
  { start: '08:00', end: '08:45' }, { start: '08:55', end: '09:40' },
  { start: '10:00', end: '10:45' }, { start: '10:55', end: '11:40' },
  { start: '14:00', end: '14:45' }, { start: '14:55', end: '15:40' },
  { start: '16:00', end: '16:45' }, { start: '16:55', end: '17:40' }
];
const blankDraft = () => ({ schemaVersion: 1, type: 'UNKNOWN', title: '', date: '', startTime: '', endTime: '', location: '', note: '', reminderMinutes: null, confidence: 0, warnings: [], missingFields: [], courseId: '', operation: 'CANCEL', newDate: '', first: null, last: null, correction: false });
const eventDraft = { ...blankDraft(), type: 'EVENT', title: '新生大会', date: addDays(1), startTime: '15:00', location: '信息楼报告厅', reminderMinutes: 10, confidence: 0.83, warnings: ['活动结束时间未填写，系统不会推测持续时长。'] };
const todoDraft = { ...blankDraft(), type: 'TODO', title: '提交课程评估表', date: addDays(1), startTime: '18:00', reminderMinutes: 120, confidence: 0.78 };
const generalDraft = { ...blankDraft(), type: 'GENERAL_NOTICE', title: '图书馆开放时间调整', confidence: 0.72 };
const schedule = {
  format: 'dayhub-schedule', version: 1, termName: '2026 秋季演示课表',
  profiles: [
    { id: 'me', name: '我', shortAlias: 'D', startDate: monday, weeks: 16, periods },
    { id: 'partner', name: 'Ta', shortAlias: 'Y', startDate: monday, weeks: 20, periods, tentative: true }
  ],
  courses: [
    { id: 'demo-me-1', person: 'me', title: '产品界面评审', place: '信息楼 302', notes: '演示课程卡片、准备清单与单次调整', activity: 'teaching', weekday, first: 1, last: 2, weeks: [1,2,3,4], reminders: [10], checklist: [{id:'c1',text:'准备界面截图',done:true},{id:'c2',text:'记录可用性问题',done:false}], updatedAt: now },
    { id: 'demo-me-2', person: 'me', title: '交互设计工作坊', place: '创新中心', notes: '', activity: 'research', weekday, first: 5, last: 6, weeks: [1,3,5,7], reminders: [10], checklist: [], updatedAt: now },
    { id: 'demo-me-3', person: 'me', title: '数据结构基础', place: '教学楼 A204', notes: '', activity: 'teaching', weekday: weekday === 7 ? 1 : weekday + 1, first: 3, last: 4, weeks: [1,2,3,4], reminders: [10], checklist: [], updatedAt: now },
    { id: 'demo-partner-1', person: 'partner', title: '高二语文', place: '教学楼 105', notes: '', activity: 'teaching', weekday, first: 1, last: 2, weeks: [1,2,3,4], reminders: [5], checklist: [], updatedAt: now },
    { id: 'demo-partner-2', person: 'partner', title: '年级教研', place: '教研室', notes: '', activity: 'research', weekday, first: 5, last: 5, weeks: [1,2,3,4], reminders: [5], checklist: [], updatedAt: now },
    { id: 'demo-partner-3', person: 'partner', title: '班会', place: '教学楼 105', notes: '', activity: 'teaching', weekday: weekday === 7 ? 1 : weekday + 1, first: 7, last: 8, weeks: [1,2,3,4], reminders: [5], checklist: [], updatedAt: now }
  ]
};

let state = {
  version: 1,
  profiles: schedule.profiles.map(profile => ({ ...profile, updatedAt: now })),
  courses: schedule.courses,
  exceptions: [{ id: 'demo-exception', courseId: 'demo-me-2', date, cancelled: false, start: `${date}T15:10`, end: `${date}T15:55`, place: '创新中心 B 区', updatedAt: now }],
  events: [
    { id: 'demo-event-1', title: '版本评估会议', start: `${date}T13:00`, end: `${date}T14:00`, place: '线上会议室', notes: '记录当前版本的证据、限制与待验证项。', reminders: [30], checklist: [{id:'e1',text:'准备会议材料',done:false}], updatedAt: now },
    { id: 'demo-event-2', title: '无结束时间的活动', start: `${addDays(1)}T19:30`, end: null, place: '校园报告厅', notes: '用于展示不推测活动时长。', reminders: [20], checklist: [], updatedAt: now }
  ],
  tasks: [
    { id:'demo-task-1', title:'整理产品评估问题清单', due:`${date}T${hour}:${minute}`, notes:'用于演示逾期状态、提醒与检查清单。', done:false, checklist:[{id:'t1',text:'核对通知流程',done:true},{id:'t2',text:'补充响应式截图',done:false}], reminders:[0], updatedAt:now },
    { id:'demo-task-2', title:'复核课程导入结果', due:`${addDays(1)}T18:00`, notes:'确认人员、周次和节次。', done:false, checklist:[], reminders:[120], updatedAt:now },
    { id:'demo-task-3', title:'已完成的示例事项', due:`${date}T09:00`, notes:'展示完成态。', done:true, checklist:[], reminders:[], updatedAt:now }
  ],
  notices: [
    { id:'notice-event', title:'新生大会', text:'明天下午3点在信息楼报告厅进行新生大会，请提前10分钟到场。', originalText:'明天下午3点在信息楼报告厅进行新生大会，请提前10分钟到场。', state:'inbox', sourceType:'MANUAL', createdAt:now-4000, updatedAt:now-4000, parseStatus:'NEEDS_REVIEW', detectedType:'EVENT', parsedData:eventDraft, confidence:.83 },
    { id:'notice-todo', title:'提交课程评估表', text:'请在本周五18点前提交课程评估表。', originalText:'请在本周五18点前提交课程评估表。', state:'inbox', sourceType:'CLIPBOARD', createdAt:now-3000, updatedAt:now-3000, parseStatus:'NEEDS_REVIEW', detectedType:'TODO', parsedData:todoDraft, confidence:.78 },
    { id:'notice-general', title:'图书馆开放时间调整', text:'通知：图书馆本周开放时间调整，详见校内公告。', originalText:'通知：图书馆本周开放时间调整，详见校内公告。', state:'archived', sourceType:'MANUAL', createdAt:now-2000, updatedAt:now-2000, parseStatus:'CONFIRMED', detectedType:'GENERAL_NOTICE', parsedData:generalDraft, confidence:.72, targetEntityType:'notice', processedAt:now-1500 },
    { id:'notice-ignored', title:'原始通知', text:'一条不需要处理的重复通知', originalText:'一条不需要处理的重复通知', state:'inbox', sourceType:'MANUAL', createdAt:now-1000, updatedAt:now-1000, parseStatus:'IGNORED' }
  ],
  reminders: [{ id:'demo-reminder', target:'tasks:demo-task-1', title:'整理产品评估问题清单', due:now-60000, status:'fired', firedAt:now-60000, createdAt:now-120000, updatedAt:now-60000 }],
  settings: { launch:false, setup:false, liveVersion:5, pet:{ mode:'custom', size:'medium', animate:false, bubbles:true, duration:8, pausedUntil:0 } },
  lastTick: now
};

const listeners = new Set();
const liveListeners = new Set();
const clone = value => structuredClone(value);
const emit = () => { for (const listener of listeners) listener(); for (const listener of liveListeners) listener(live()); };
const live = () => ({
  now: Date.now(), source: '北京时间 · 演示时钟', pending: state.reminders.filter(r=>r.status==='fired').length,
  preferences: { ...state.settings.pet, mode: new URL(location.href).searchParams.get('mode') || state.settings.pet.mode },
  people: [
    { person:'me', alias:'D', code:'BUSY_EVENT', label:'会议 / 活动中', current:[], next:null, todayCount:2 },
    { person:'partner', alias:'Y', code:'BUSY_CLASS', label:'上课中', current:[], next:null, todayCount:2 }
  ],
  hoverTip: location.hash === '#tip' ? { state:'busy', text:'D · 忙碌 · 下一项 14:00 交互设计工作坊' } : undefined,
  bubble: location.hash === '#bubble' ? { id:'demo-bubble', text:'产品界面评审将在 10 分钟后开始，请准备问题清单。', below:false } : undefined
});

async function change(command) {
  if (command.type === 'save') {
    const list = state[command.entity];
    const index = list.findIndex(item => item.id === command.value.id);
    if (index < 0) list.push(clone(command.value)); else list[index] = clone(command.value);
  } else if (command.type === 'delete') {
    state[command.entity] = state[command.entity].filter(item => item.id !== command.id);
  } else if (command.type === 'settings') {
    state.settings = { ...state.settings, ...Object.fromEntries(Object.entries(command).filter(([key]) => !['type','pet'].includes(key))), pet:{...state.settings.pet,...(command.pet||{})} };
  } else if (command.type === 'importSchedule') {
    state.profiles = command.value.profiles.map(profile => ({...profile,updatedAt:Date.now()}));
    state.courses = command.value.courses.map(course => ({...course,updatedAt:Date.now()}));
  } else if (command.type === 'ack') {
    state.reminders = state.reminders.map(item => item.id === command.id ? {...item,status:'ack'} : item);
  } else if (command.type === 'snooze') {
    state.reminders = state.reminders.map(item => item.id === command.id ? {...item,status:'pending',due:Date.now()+600000} : item);
  } else if (command.type === 'inboxStatus') {
    state.notices = state.notices.map(item => item.id === command.noticeId ? {...item,parseStatus:command.status,updatedAt:Date.now()} : item);
  } else if (command.type === 'draft') {
    state.notices = state.notices.map(item => item.id === command.noticeId ? {...item,parsedData:clone(command.draft),updatedAt:Date.now()} : item);
  } else if (command.type === 'inbound') {
    state.notices.unshift({id:command.id,title:'原始通知',text:command.payload.text||'',originalText:command.payload.text||'',image:command.payload.image,state:'inbox',sourceType:command.payload.sourceType||'MANUAL',createdAt:Date.now(),updatedAt:Date.now(),parseStatus:'UNPARSED'});
  } else if (command.type === 'review') {
    state.notices = state.notices.map(item => item.id === command.noticeId ? {...item,parseStatus:'CONFIRMED',targetEntityType:command.draft.type==='GENERAL_NOTICE'?'notice':command.draft.type==='TODO'?'tasks':command.draft.type==='EVENT'?'events':'exceptions',targetEntityId:`demo-${command.noticeId}`,processedAt:Date.now(),parsedData:clone(command.draft)} : item);
  }
  emit();
  return clone(state);
}

async function parseNotice(id, text) {
  const notice = state.notices.find(item => item.id === id);
  if (text !== undefined) notice.text = text;
  const source = notice.text || notice.originalText || '';
  const draft = /提交|截止|前交/.test(source) ? todoDraft : /通知|公告/.test(source) ? generalDraft : eventDraft;
  notice.parsedData = clone(draft); notice.detectedType = draft.type; notice.parseStatus = 'NEEDS_REVIEW'; notice.confidence = draft.confidence; notice.updatedAt = Date.now();
  emit();
  return clone(state);
}

contextBridge.exposeInMainWorld('dayhub', {
  get: async () => clone(state), change, parseNotice,
  clipboardText: async () => '', chooseSchedule: async () => clone(schedule),
  importImage: async () => null, pasteImage: async () => null, image: async () => '', ocr: async () => '',
  backup: async () => 'C:\\演示数据\\YD备份.dayhub', restore: async () => clone(state), testNotification: async () => '已提交给 Windows 通知系统。',
  live: async () => live(), onLive(callback){liveListeners.add(callback);return()=>liveListeners.delete(callback);},
  subscribe(callback){listeners.add(callback);return()=>listeners.delete(callback);}, onSettings:()=>()=>{}, onError:()=>()=>{},
  window:async()=>{}, pointer:async()=>{}, bubble:async()=>{}, presence:async()=>{}, toggle:async()=>{}, beginDrag:async()=>{}, drag:async()=>{}, endDrag:async()=>{}
});
