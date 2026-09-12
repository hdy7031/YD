import type { Store } from './store.ts';
import type { ParserAdapter, InboundPayload } from './inbox-types.ts';
import { parseSaved, receive } from './inbox.ts';
export class InboxService {
  private active=new Set<string>();
  private store:Store; private parser:ParserAdapter; private changed:()=>void;
  constructor(store:Store,parser:ParserAdapter,changed:()=>void=()=>{}){this.store=store;this.parser=parser;this.changed=changed;}
  async receive(payload:InboundPayload,id:string){const saved=await this.store.update(s=>receive(s,payload,id,Date.now()));this.changed();return saved;}
  async recover(){await this.store.update(s=>{for(const n of s.notices)if(n.parseStatus==='PARSING'){n.parseStatus='FAILED';n.parseError='上次整理被中断，原始通知已保存，请重新整理。';n.updatedAt=Date.now();}return s;});}
  async parse(noticeId:string,text?:string,fromOcr=false){
    if(this.active.has(noticeId))throw new Error('正在整理这条通知，请稍后');
    if(text!==undefined&&(typeof text!=='string'||text.length>200000))throw new Error('通知文字无效或过长');
    this.active.add(noticeId);
    try {
      const saved=await this.store.update(s=>{const n=s.notices.find(x=>x.id===noticeId);if(!n)throw new Error('原通知不存在');if(n.parseStatus==='CONFIRMED'||n.parseStatus==='IGNORED')throw new Error('请先恢复待处理通知');if(text!==undefined){n.text=text;if(fromOcr&&n.image)n.ocrText=text;}n.parseStatus='PARSING';n.updatedAt=Date.now();n.parseError=undefined;return s;});this.changed();
      const n=saved.notices.find(x=>x.id===noticeId)!;
      try {
        const draft=await parseSaved(n,saved,this.parser);
        return await this.store.update(s=>{const current=s.notices.find(x=>x.id===noticeId)!;if(current.parseStatus!=='PARSING')return s;Object.assign(current,{parsedData:draft,detectedType:draft.type,confidence:draft.confidence,parseStatus:'NEEDS_REVIEW',updatedAt:Date.now()});return s;});
      }catch(error){
        return await this.store.update(s=>{const current=s.notices.find(x=>x.id===noticeId)!;if(current.parseStatus==='PARSING')Object.assign(current,{parseStatus:'FAILED',parseError:'自动整理失败，原始通知已保存。你仍可以手动填写。',updatedAt:Date.now()});return s;});
      }
    } finally {this.active.delete(noticeId);this.changed();}
  }
}
