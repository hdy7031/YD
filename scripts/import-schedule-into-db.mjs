import fs from 'node:fs';
import path from 'node:path';
import initSqlJs from 'sql.js';
import { Store } from '../src/store.ts';
import { apply, occurrences, conflicts } from '../src/core.ts';
import { pack } from '../src/backup.ts';

const [directory, scheduleFile, receiptFile] = process.argv.slice(2);
if(!directory||!scheduleFile||!receiptFile)throw new Error('需要数据库目录、课表文件和回执文件');
const wasmBinary=Uint8Array.from(fs.readFileSync(path.join(process.cwd(),'node_modules','sql.js','dist','sql-wasm.wasm'))).buffer;
const SQL=await initSqlJs({wasmBinary});
const store=new Store(directory,bytes=>new SQL.Database(bytes));
const value=JSON.parse(fs.readFileSync(scheduleFile,'utf8'));
const before=store.snapshot();
const checked=apply(before,{type:'importSchedule',value});
if(conflicts(occurrences(checked,-Infinity,Infinity)).size)throw new Error('课表存在未解决的时间冲突');

const backupDirectory=path.join(directory,'backups');
fs.mkdirSync(backupDirectory,{recursive:true});
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const backupFile=path.join(backupDirectory,`before-2026-autumn-import-${stamp}.dayhub`);
fs.writeFileSync(backupFile,pack(before,path.join(directory,'attachments')),'utf8');
const after=await store.update(state=>apply(state,{type:'importSchedule',value}));
const receipt={
  importedAt:new Date().toISOString(),
  database:store.file,
  backup:backupFile,
  term:value.termName,
  before:{profiles:before.profiles,courses:before.courses.length,events:before.events.length,tasks:before.tasks.length,notices:before.notices.length},
  after:{profiles:after.profiles,courses:after.courses.length,myCourses:after.courses.filter(course=>course.person==='me').length,partnerCourses:after.courses.filter(course=>course.person==='partner').length,events:after.events.length,tasks:after.tasks.length,notices:after.notices.length,reminders:after.reminders.length}
};
fs.writeFileSync(receiptFile,JSON.stringify(receipt,null,2)+'\n','utf8');
console.log(JSON.stringify(receipt,null,2));
