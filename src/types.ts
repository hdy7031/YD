import type { SourceMetadata, ParsedDraft, ParseStatus, DraftType, InboundPayload } from './inbox-types.ts';
// 身份标识不再限制为固定的两个人：历史 id 'me' / 'partner' 仍然合法，
// 但新的档案可以是任意合法编号（见 src/people.ts 的解析顺序）。
export type PersonId = string;
// 工作区内的身份角色：本人 / 同行者。v0.3 只解决 YD Solo / Together 的基础。
export type ProfileRole = 'self' | 'companion';
export type AvatarSelectionSource = 'default' | 'user';
export interface AvatarSelection { packId: import('./avatar.ts').AvatarPackId; source: AvatarSelectionSource }
export interface ChecklistItem { id: string; text: string; done: boolean }
export interface AcademicCalendar { startDate: string; weeks: number }
// role 在 v1 旧数据里不存在（由 src/people.ts 按 角色→历史 id→位置 解析）；
// 迁移到 v2 之后必须显式存在。
// routine 在 v3 及更早的数据里不存在（v4 起由 src/routine.ts 提供，迁移会补齐）；
// 它嵌套在档案下，所以自身不再存 personId：Profile.id 就是唯一身份。
export interface Profile extends AcademicCalendar { shortAlias?: string; tentative?: boolean; role?: ProfileRole; routine?: import('./routine.ts').RoutineProfile; avatar?: AvatarSelection; id: PersonId; name: string; startDate: string; weeks: number; periods: { start: string; end: string }[]; updatedAt: number }
export interface Course { createdAt?: number; activity?: 'teaching'|'research'; id: string; person: PersonId; title: string; place: string; notes: string; weekday: number; first: number; last: number; weeks: number[]; reminders: number[]; checklist: ChecklistItem[]; sourceId?: string; updatedAt: number }
export interface Exception { createdAt?: number; sourceInboxItemId?: string; id: string; courseId: string; date: string; cancelled: boolean; start?: string; end?: string; place?: string; updatedAt: number }
// v3 起会议/活动必须归属某个档案（迁移会为旧数据补上工作区本人）；
// v2 及更早的数据库没有该字段，读入时由 core.eventPerson() 回退到本人。
export interface Event { createdAt?: number; sourceInboxItemId?: string; person?: PersonId; id: string; title: string; start: string; end: string|null; place: string; notes: string; reminders: number[]; checklist: ChecklistItem[]; sourceId?: string; updatedAt: number }
export interface Task { createdAt?: number; sourceInboxItemId?: string; id: string; title: string; due: string; notes: string; done: boolean; checklist: ChecklistItem[]; reminders: number[]; sourceId?: string; updatedAt: number }
export interface Notice extends SourceMetadata { ocrText?:string; createdAt?: number; parseStatus?: ParseStatus; detectedType?: DraftType; parsedData?: ParsedDraft; confidence?: number; targetEntityType?: "tasks"|"events"|"exceptions"|"notice"; targetEntityId?: string; processedAt?: number; parseError?: string; id: string; title: string; text: string; originalText?: string; image?: string; state: 'inbox' | 'later' | 'archived'; updatedAt: number }
export type ReminderStatus = 'scheduled'|'due'|'acknowledged'|'snoozed'|'cancelled';
export interface Reminder { createdAt?: number; updatedAt?: number; id: string; target: string; occurrence?: string; title: string; due: number; status: ReminderStatus; firedAt?: number; handledAt?: number; snoozedFrom?: string; snoozeMinutes?: number; cancelReason?: 'time_changed'|'completed' }
// v0.3 Phase 3C：临时手动状态（每人在同一时刻最多一条）。
// endAt === null 表示"直到用户取消"；kind 复用 CurrentState 的领域 kind（见 src/state/manual.ts）。
export interface ManualOverride { createdAt: number; id: string; personId: PersonId; kind: import('./state/manual.ts').ManualStateKind; label: string; startAt: number; endAt: number | null }
// orb = 悬浮球 / 状态 Dock 的窗口位置。w / h 记录落盘时的窗口尺寸：
// Dock 的宽度随内容变化（内容完整优先），有了这对尺寸就能按"牌面右下角"这个
// 真正的视觉锚点还原，状态词变长变短都不会让 Dock 横向漂。老数据没有这两个字段，
// 按原来的"窗口左上角"语义还原，行为与升级前完全一致。
// usageMode（Phase 5B2）是"当前怎么用 YD"的运行方式偏好，不是档案清单：
// 缺失时由 src/people.ts 按档案事实推导，因此旧库不需要迁移。
export interface Settings { domainVersion?: number; pet?: import('./live.ts').PetPreferences; liveVersion?: number; petMigratedV0215?: boolean; launch: boolean; trayResident?: boolean; orb?: { x: number; y: number; w?: number; h?: number }; setup: boolean; petSubjectRole?: import('./people.ts').PetSubjectRole; petEnabled?: boolean; usageMode?: import('./people.ts').UsageMode }
export interface State { inboxVersion?: number; bubbleHistory?: {id:string;at:number}[]; version: 1; profiles: Profile[]; courses: Course[]; exceptions: Exception[]; events: Event[]; tasks: Task[]; notices: Notice[]; reminders: Reminder[]; manualOverrides: ManualOverride[]; settings: Settings; lastTick: number }
export interface SchedulePackage {
  format: 'dayhub-schedule'; version: 1; termName: string;
  // 课表包只承载"学期 + 节次 + 课程"：不携带 Routine，导入永远不会覆盖用户自己的作息规则。
  profiles: Array<Omit<Profile, 'updatedAt' | 'routine' | 'avatar'>>;
  courses: Array<Omit<Course, 'updatedAt'>>;
}
export interface Occurrence {
  id: string; target: string; title: string; start: number; end: number; place: string; notes: string;
  person: PersonId; kind: 'course' | 'event'; courseId?: string; date?: string; checklist: ChecklistItem[];
  sourceId?: string; sourceInboxItemId?: string; createdAt?: number; updatedAt?: number; endUnknown?: boolean;
  // Course occurrence presentation metadata. Cancelled instances are omitted from
  // status calculations unless a caller explicitly requests them for a list.
  cancelled?: boolean;
  rescheduled?: boolean;
}
export type Entity = 'profiles' | 'courses' | 'exceptions' | 'events' | 'tasks' | 'notices';
export type Command = { type:"inbound"; payload:InboundPayload; id:string } | { type:"review"; noticeId:string; draft:ParsedDraft; allowDuplicate?:boolean; updateId?:string } | { type:"inboxStatus"; noticeId:string; status:"IGNORED"|"UNPARSED" } | {type:"draft";noticeId:string;draft:ParsedDraft} | { type: 'save'; entity: Entity; value: unknown } | { type: 'delete'; entity: Entity; id: string } | { type: 'convert'; noticeId: string; task: unknown } | { type: 'ack'; id: string } | { type: 'snooze'; id: string; minutes?: 10|30|60 } | { type: 'settings'; launch?: boolean; setup?: boolean; trayResident?: boolean; pet?: Partial<import('./live.ts').PetPreferences>; petSubjectRole?: import('./people.ts').PetSubjectRole; petEnabled?: boolean } | { type: 'importSchedule'; value: SchedulePackage } | { type: 'manual'; kind: import('./state/manual.ts').ManualStateKind; label: string; endAt: number | null; personId?: PersonId } | { type: 'manualCancel'; id?: string } | { type: 'avatarSet'; personId: PersonId; packId: import('./avatar.ts').AvatarPackId } | { type: 'avatarReset'; personId: PersonId } | { type: 'completeSetup'; value: import('./setup.ts').SetupInput }
  // Phase 5B2 · Profile lifecycle：使用方式切换与档案身份编辑各只有一条正式写入路径。
  | { type: 'usageMode'; mode: import('./people.ts').UsageMode; companionName?: string; petSubjectRole?: import('./people.ts').PetSubjectRole }
  | { type: 'profileIdentity'; personId: PersonId; name: string; shortAlias?: string | null };
export interface DesktopAPI {
  version():Promise<string>;
  onSettings(callback:()=>void):()=>void;
  // 桌宠右键菜单 → 主窗口：打开"设置当前状态"。
  onStatus(callback:()=>void):()=>void;
  companionAssets(packId?:import('./avatar.ts').AvatarPackId):Promise<import('./companion-frame.ts').CompanionAssets>;
  avatarVisualReady(ready:import('./avatar-runtime.ts').AvatarVisualReady):Promise<boolean>;
  live():Promise<import('./live.ts').LiveSnapshot>;
  /** hover 收起的兜底确认：系统光标此刻是否还在桌宠 / 状态牌窗口内。 */
  cursorInside():Promise<boolean>;
  /** Dock 默认态 / 展开态牌面的自然宽度（渲染层测量）：主进程据此定窗口尺寸。 */
  dockSize(measure:{collapsed:number;hover:number}):Promise<void>;
  onLive(callback:(value:import('./live.ts').LiveSnapshot)=>void):()=>void;
  // 'mini' = 切换详情（Dock 模式共用同一个窗口，桌宠模式用独立浮层）；
  // 'detail-close' = 明确收起详情（点击 Dock / ESC 用，避免与 toggle 抢语义）。
  window(action:'minimize'|'maximize'|'close'|'open'|'mini'|'detail-close'|'menu'|'settings'):Promise<void>;
  // 自绘桌宠右键菜单：主进程投递菜单模型，渲染层回传被点中的行。
  menuAction(id:string):Promise<void>;
  onMenu(callback:(items:import('./companion-menu.ts').CompanionMenuItem[])=>void):()=>void;
  bubble(action:'close'|'hold'|'release'):Promise<void>;
  presence(action:'enter'|'leave',person?:PersonId):Promise<void>;
  pointer(interactive:boolean):Promise<void>;
  // 命中区：渲染层上报"人物 / 状态小框 / 状态牌面 / 气泡"的真实矩形（窗口内 DIP），
  // 主进程据此决定这个透明窗口此刻是接收鼠标还是点击穿透（Phase 5B1 P0）。
  reportHitRegions(regions:{x:number;y:number;w:number;h:number;hover?:boolean}[]):Promise<void>;
  onPointer(callback:(state:{inside:boolean;hover:boolean})=>void):()=>void;

  parseNotice(id:string,text?:string,fromOcr?:boolean):Promise<State>; clipboardText():Promise<string>;
  get(): Promise<State>; change(command: Command): Promise<State>;
  chooseSchedule(): Promise<SchedulePackage | null>;
  importImage(): Promise<{ image: string } | null>; importImageBytes(bytes: Uint8Array): Promise<{ image: string }>; pasteImage(): Promise<{ image: string } | null>;
  image(id: string): Promise<string>; ocr(id: string): Promise<string>;
  backup(): Promise<string | null>; restore(): Promise<State | null>; testNotification(): Promise<string>;
  toggle(): Promise<void>; beginDrag(x: number, y: number): Promise<void>; drag(x: number, y: number): Promise<void>; endDrag(): Promise<void>;
  subscribe(callback: () => void): () => void;
  onError(callback: (message:string) => void): () => void;
}

// Existing storage names remain compatible with version-1 backups.
export type Todo = Task;
export type InboxItem = Notice;
export type CourseOccurrence = Occurrence & { kind: "course" };
