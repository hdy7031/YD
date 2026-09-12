import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validateState } from './core.ts';
import type { State } from './types.ts';
export function pack(state:State, directory:string):string {
  const images:Record<string,string>={};for(const n of state.notices)if(n.image&&!images[n.image])images[n.image]=fs.readFileSync(path.join(directory,n.image)).toString('base64');
  return JSON.stringify({format:'dayhub-backup',version:1,state,images});
}
export function unpack(content:string):{state:State;images:Map<string,Buffer>} {
  if(Buffer.byteLength(content)>200*1024*1024)throw new Error('备份超过 200 MB');
    const obj=JSON.parse(content);if(obj.format!=='dayhub-backup'||obj.version!==1)throw new Error('不是受支持的 YD 备份');
  const state=validateState(obj.state), images=new Map<string,Buffer>();
  for(const n of state.notices)if(n.image&&!images.has(n.image)){
    const data=obj.images?.[n.image];if(typeof data!=='string'||data.length>30*1024*1024)throw new Error('图片缺失或过大');
    const bytes=Buffer.from(data,'base64');if(bytes.length>20*1024*1024||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||createHash('sha256').update(bytes).digest('hex')+'.png'!==n.image)throw new Error('图片校验失败');images.set(n.image,bytes);
  }
  return {state,images};
}
