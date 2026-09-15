import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { Store } from '../src/store.ts';
import { epoch, apply, tick, createFreshState } from '../src/core.ts';
import { pack, unpack } from '../src/backup.ts';
import { InboxService } from '../src/inbox-service.ts';
import { LocalRuleParser } from '../src/parser.ts';
// The same Store contract is exercised against real SQLite using Node's built-in
// engine. Release runtime uses sql.js; its loading must also be checked after install.
function temporary(){return fs.mkdtempSync(path.join(os.tmpdir(),'dayhub-test-'));}
function fixture(){const dir=temporary(),dbDir=path.join(dir,'adapter');fs.mkdirSync(dbDir);const open=(bytes?:Uint8Array)=>{
  const file=path.join(dbDir,crypto.randomUUID()+'.sqlite');if(bytes)fs.writeFileSync(file,bytes);const db=new DatabaseSync(file);
  return {run(sql:string,params:unknown[]=[]){db.prepare(sql).run(...params as any[]);},exec(sql:string){const stmt=db.prepare(sql);const rows=stmt.all();return rows.length?[{columns:Object.keys(rows[0]),values:rows.map(Object.values)}]:[];},export(){return fs.readFileSync(file);},close(){db.close();fs.unlinkSync(file);}};
};return {dir,open};}
const now=epoch('2026-09-07T00:00');
const task={id:'t1',title:'重启测试',due:'2026-09-08T12:00',notes:'',done:false,checklist:[],reminders:[0,120],updatedAt:now};
test('Inbox parser失败与中断保留原文；事务落盘失败不产生半个Event或Reminder',async()=>{
  const {dir,open}=fixture();try{
    const store=new Store(dir,open,now);
    await store.update(s=>apply(s,{type:'inbound',id:'inbox',payload:{text:'明天下午3点开会'}},now));
    const broken=new InboxService(store,{parse(){throw new Error('parser unavailable');}});
    await broken.parse('inbox');assert.equal(store.snapshot().notices[0].parseStatus,'FAILED');assert.equal(new Store(dir,open).state.notices[0].originalText,'明天下午3点开会');
    const service=new InboxService(store,new LocalRuleParser());await service.parse('inbox');const draft=store.snapshot().notices[0].parsedData!;
    fs.mkdirSync(store.file+'.tmp');await assert.rejects(store.update(s=>apply(s,{type:'review',noticeId:'inbox',draft},now)),/保存失败/);
    assert.equal(store.snapshot().events.length,0);assert.equal(store.snapshot().reminders.length,0);assert.equal(store.snapshot().notices[0].parseStatus,'NEEDS_REVIEW');
    fs.rmdirSync(store.file+'.tmp');await store.update(s=>apply(s,{type:'review',noticeId:'inbox',draft},now));
    const reopened=new Store(dir,open).snapshot();assert.equal(reopened.events.length,1);assert.equal(reopened.reminders.length,1);assert.equal(reopened.notices[0].parseStatus,'CONFIRMED');
    await store.update(s=>apply(s,{type:'inbound',id:'interrupted',payload:{text:'另一条通知'}},now));
    await store.update(s=>{s.notices[1].parseStatus='PARSING';return s;});await service.recover();assert.equal(store.snapshot().notices[1].parseStatus,'FAILED');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('数据库使用 SQLite 格式并跨实例保留记录',async()=>{const {dir,open}=fixture();try{const a=new Store(dir,open,now);await a.update(s=>apply(s,{type:'save',entity:'tasks',value:task},now));assert.equal(fs.readFileSync(a.file).subarray(0,15).toString(),'SQLite format 3');const b=new Store(dir,open);assert.equal(b.state.tasks[0].title,task.title);assert.equal(b.state.reminders.length,2);}finally{fs.rmSync(dir,{recursive:true,force:true});}});
test('并发保存串行合并，不丢记录',async()=>{const {dir,open}=fixture();try{const a=new Store(dir,open,now);await Promise.all(Array.from({length:10},(_,i)=>a.update(s=>apply(s,{type:'save',entity:'tasks',value:{...task,id:'t'+i}},now))));assert.equal(a.snapshot().tasks.length,10);assert.equal(new Store(dir,open).state.tasks.length,10);}finally{fs.rmSync(dir,{recursive:true,force:true});}});
test('旧驻留实例不会用空内存覆盖另一实例刚写入的数据',async()=>{const {dir,open}=fixture();try{const stale=new Store(dir,open,now),writer=new Store(dir,open,now);await writer.update(s=>apply(s,{type:'save',entity:'tasks',value:task},now));assert.equal(stale.state.tasks.length,0);assert.equal(stale.snapshot().tasks.length,1);await stale.update(s=>apply(s,{type:'save',entity:'tasks',value:{...task,id:'t2'}},now));assert.deepEqual(new Store(dir,open).state.tasks.map(t=>t.id).sort(),['t1','t2']);}finally{fs.rmSync(dir,{recursive:true,force:true});}});
test('保存失败不显示成功、不改变内存，后续重试可成功',async()=>{const {dir,open}=fixture();try{const a=new Store(dir,open,now);fs.mkdirSync(a.file+'.tmp');await assert.rejects(a.update(s=>apply(s,{type:'save',entity:'tasks',value:task},now)),/保存失败/);assert.equal(a.state.tasks.length,0);fs.rmdirSync(a.file+'.tmp');await a.update(s=>apply(s,{type:'save',entity:'tasks',value:task},now));assert.equal(a.state.tasks.length,1);}finally{fs.rmSync(dir,{recursive:true,force:true});}});
test('主文件损坏时恢复上一副本并保留损坏文件',async()=>{const {dir,open}=fixture();try{const a=new Store(dir,open,now);await a.update(s=>apply(s,{type:'save',entity:'tasks',value:task},now));await a.update(s=>apply(s,{type:'save',entity:'tasks',value:{...task,notes:'第二次保存'}},now));fs.writeFileSync(a.file,'damaged');const b=new Store(dir,open);assert.equal(b.recovered,true);assert.equal(b.state.tasks[0].notes,'');assert.ok(fs.readdirSync(dir).some(x=>x.includes('.damaged-')));}finally{fs.rmSync(dir,{recursive:true,force:true});}});
test('延后提醒和已处理状态跨重启保留',async()=>{const {dir,open}=fixture();try{let a=new Store(dir,open,now);await a.update(s=>apply(s,{type:'save',entity:'tasks',value:task},now));const at=epoch('2026-09-08T10:00');await a.update(s=>{tick(s,at);return s;});await a.update(s=>apply(s,{type:'snooze',id:s.reminders.find(r=>r.status==='due')!.id},at));a=new Store(dir,open);assert.equal(a.state.reminders.filter(r=>r.status==='snoozed').length,1);assert.equal(a.state.reminders.find(r=>r.id.startsWith('s:'))?.due,at+600000);}finally{fs.rmSync(dir,{recursive:true,force:true});}});
test('备份包含附件并验证哈希，拒绝路径穿越',()=>{const dir=temporary();try{const bytes=Buffer.from('89504e470d0a1a0a0000','hex'),image=createHash('sha256').update(bytes).digest('hex')+'.png';fs.writeFileSync(path.join(dir,image),bytes);const s=createFreshState(now);s.notices.push({id:'n1',title:'截图',text:'核对文字',originalText:'原文',image,state:'inbox',updatedAt:now});const encoded=pack(s,dir),restored=unpack(encoded);assert.equal(restored.state.notices[0].originalText,'原文');assert.deepEqual(restored.images.get(image),bytes);const bad=JSON.parse(encoded);bad.state.notices[0].image='../evil.png';assert.throws(()=>unpack(JSON.stringify(bad)),/图片编号/);const missing=JSON.parse(encoded);missing.images={};assert.throws(()=>unpack(JSON.stringify(missing)),/图片缺失/);}finally{fs.rmSync(dir,{recursive:true,force:true});}});
