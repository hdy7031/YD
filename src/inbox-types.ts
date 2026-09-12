import type { Course, Profile, Task, Event } from './types.ts';
export type SourceType = 'MANUAL'|'CLIPBOARD'|'SCREENSHOT'|'IMAGE_IMPORT'|'QQ_GROUP'|'MOBILE'|'OTHER';
export interface SourceMetadata { sourceType?: SourceType; sourceLabel?: string|null; externalSourceId?: string|null; externalConversationId?: string|null; externalMessageId?: string|null; receivedAt?: number }
export interface InboundPayload extends SourceMetadata { text?: string; image?: string }
export interface InboundAdapter<T> { receive(input:T): Promise<InboundPayload> }
export type DraftType = 'TODO'|'EVENT'|'COURSE_CHANGE'|'GENERAL_NOTICE'|'UNKNOWN';
export type ParseStatus = 'UNPARSED'|'PARSING'|'NEEDS_REVIEW'|'CONFIRMED'|'FAILED'|'IGNORED';
export interface ParsedDraft {
  schemaVersion: 1; type: DraftType; title: string; date: string; startTime: string; endTime: string;
  location: string; note: string; reminderMinutes: number|null; confidence: number; warnings: string[]; missingFields: string[];
  courseId: string; operation: 'CANCEL'|'RESCHEDULE'|'LOCATION_CHANGE'; newDate: string; first: number|null; last: number|null;
  correction: boolean;
}
export interface ParseContext { now: number; profiles: Profile[]; courses: Course[]; tasks: Task[]; events: Event[]; source: SourceMetadata }
export interface ParserAdapter { parse(input:{text:string;createdAt:number},context:ParseContext): ParsedDraft|Promise<ParsedDraft> }
export interface OcrAdapter { recognize(image:string): Promise<string> }
export function blankDraft():ParsedDraft { return {schemaVersion:1,type:'UNKNOWN',title:'',date:'',startTime:'',endTime:'',location:'',note:'',reminderMinutes:null,confidence:0,warnings:[],missingFields:[],courseId:'',operation:'CANCEL',newDate:'',first:null,last:null,correction:false}; }
export function validDraft(v:unknown):v is ParsedDraft {
  const d=v as ParsedDraft;
  return !!d&&d.schemaVersion===1&&['TODO','EVENT','COURSE_CHANGE','GENERAL_NOTICE','UNKNOWN'].includes(d.type)
    &&['title','date','startTime','endTime','location','note','courseId','newDate'].every(k=>typeof (d as any)[k]==='string'&&(d as any)[k].length<=200000)
    &&['CANCEL','RESCHEDULE','LOCATION_CHANGE'].includes(d.operation)&&typeof d.correction==='boolean'
    &&Number.isFinite(d.confidence)&&d.confidence>=0&&d.confidence<=1
    &&[d.warnings,d.missingFields].every(a=>Array.isArray(a)&&a.length<=100&&a.every(x=>typeof x==='string'&&x.length<=1000))
    &&[d.first,d.last].every(n=>n===null||Number.isInteger(n)&&Number(n)>=1&&Number(n)<=24)
    &&(d.reminderMinutes===null||Number.isInteger(d.reminderMinutes)&&d.reminderMinutes>=0&&d.reminderMinutes<=525600);
}
