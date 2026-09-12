import fs from 'node:fs';
import path from 'node:path';
import initSqlJs from 'sql.js';
import {pack} from '../src/backup.ts';
import {validateState} from '../src/core.ts';
const [directory,output]=process.argv.slice(2);
if(!directory||!output)throw new Error('需要数据目录和备份输出路径');
const SQL=await initSqlJs();
const db=new SQL.Database(fs.readFileSync(path.join(directory,'dayhub.sqlite')));
try{
 const state=validateState(JSON.parse(db.exec('SELECT body FROM app_state WHERE id=1')[0].values[0][0]));
 fs.writeFileSync(output,pack(state,path.join(directory,'attachments')),{flag:'wx'});
 console.log(JSON.stringify({backup:output,courses:state.courses.length,tasks:state.tasks.length,events:state.events.length,notices:state.notices.length,reminders:state.reminders.length,liveVersion:state.settings.liveVersion??null},null,2));
}finally{db.close();}
