import fs from 'node:fs';
import path from 'node:path';
import { initial, validateState } from './core.ts';
import type { State } from './types.ts';
export interface DB { run(sql:string, params?:unknown[]):unknown; exec(sql:string):{columns:string[];values:unknown[][]}[]; export():Uint8Array; close():void }
export type OpenDB=(bytes?:Uint8Array)=>DB;
// Windows 上杀毒、索引或刚被关闭的文件句柄会让 rename 短暂返回 EPERM/EBUSY。
// 这种失败是可重试的，重试几次数十毫秒即可，不需要用户重做录入。
const renameRetryCodes=['EPERM','EBUSY','EACCES'];
function sleepSync(ms:number){try{Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms);}catch{/* 不支持时直接继续 */}}
function renameWithRetry(from:string,to:string){
  for(let attempt=0;;attempt++){
    try{fs.renameSync(from,to);return;}
    catch(error){
      const code=(error as NodeJS.ErrnoException).code??'';
      if(attempt>=3||!renameRetryCodes.includes(code))throw error;
      sleepSync(40*(attempt+1));
    }
  }
}
export class Store {
  state: State; file: string; private open: OpenDB; private queue: Promise<unknown>=Promise.resolve(); recovered=false;
  constructor(directory:string, open:OpenDB, now=Date.now()) {
    fs.mkdirSync(directory,{recursive:true});this.file=path.join(directory,'dayhub.sqlite');this.open=open;
    if(fs.existsSync(this.file)) {
      try{this.state=this.decode(fs.readFileSync(this.file));}
      catch(error){if(!fs.existsSync(this.file+'.bak'))throw new Error('数据库无法读取，请从备份恢复。原文件未改动。');this.state=this.decode(fs.readFileSync(this.file+'.bak'));fs.copyFileSync(this.file,this.file+'.damaged-'+Date.now());fs.copyFileSync(this.file+'.bak',this.file);this.recovered=true;}
    }else{this.state=initial(now);this.persist(this.state);}
  }
  private decode(bytes:Uint8Array):State {const db=this.open(bytes);try{const result=db.exec('SELECT body FROM app_state WHERE id = 1');if(!result[0]?.values[0])throw new Error('数据库没有状态');return validateState(JSON.parse(String(result[0].values[0][0])));}finally{db.close();}}
  private encode(state:State):Uint8Array {
    const db=this.open();try{db.run('CREATE TABLE app_state (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL, body TEXT NOT NULL)');db.run('INSERT INTO app_state (id,version,body) VALUES (1,1,?)',[JSON.stringify(state)]);return db.export();}finally{db.close();}
  }
  private persist(state:State) {
    const bytes=this.encode(state), tmp=this.file+'.tmp';
    try{
      const fd=fs.openSync(tmp,'w');try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
      if(fs.existsSync(this.file)){const bak=this.file+'.bak.tmp';fs.copyFileSync(this.file,bak);renameWithRetry(bak,this.file+'.bak');}
      renameWithRetry(tmp,this.file);
    }catch(error){try{fs.unlinkSync(tmp);}catch{}throw new Error('保存失败，修改未提交。请检查磁盘空间或目录权限。',{cause:error});}
  }
  private reload() {
    if(!fs.existsSync(this.file))throw new Error('数据库文件不存在，请不要继续录入，并从备份恢复。');
    this.state=this.decode(fs.readFileSync(this.file));
  }
  update(change:(state:State)=>State):Promise<State> {
    // The installer and an older resident process can briefly overlap during an
    // upgrade. Always re-read the durable state before applying a command so a
    // stale in-memory instance can never replace newer on-disk records.
    const operation=this.queue.then(()=>{this.reload();const next=change(structuredClone(this.state));validateState(next);this.persist(next);this.state=next;return structuredClone(next);});
    this.queue=operation.catch(()=>{});return operation;
  }
  snapshot(){this.reload();return structuredClone(this.state);}
  async flush(){await this.queue;this.reload();}
}
