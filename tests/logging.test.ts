import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {configureLogging,installStreamGuards,isBrokenPipeError,isStreamBroken,logError,logLine} from '../src/logging.ts';

// 用真实可写的 stdout/stderr 替身验证：终端管道断开不能让主进程日志抛出未捕获异常。
class Probe extends EventEmitter {
  destroyed=false;writableEnded=false;chunks:string[]=[];
  write(text:string){this.chunks.push(text);return true;}
}
const pipe=(probe:Probe)=>probe as unknown as NodeJS.WriteStream;
const workspace=()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dayhub-logging-'));return {dir,file:path.join(dir,'dayhub.log')};};
const brokenPipe=()=>Object.assign(new Error('EPIPE: broken pipe, write'),{code:'EPIPE'});

test('只有管道断开类错误被当作 EPIPE 处理',()=>{
  assert.equal(isBrokenPipeError({code:'EPIPE'}),true);
  assert.equal(isBrokenPipeError({code:'ERR_STREAM_DESTROYED'}),true);
  assert.equal(isBrokenPipeError({code:'ERR_STREAM_WRITE_AFTER_END'}),true);
  assert.equal(isBrokenPipeError({code:'ENOSPC'}),false);
  assert.equal(isBrokenPipeError(new Error('boom')),false);
});

test('stdout 的 EPIPE 不再抛出，日志自动降级为只写文件',()=>{
  const {file}=workspace(),out=new Probe(),err=new Probe();
  configureLogging({file,mirrorConsole:true,streams:{out:pipe(out),err:pipe(err)}});
  out.emit('error',brokenPipe());
  assert.equal(isStreamBroken(pipe(out)),true);
  out.chunks.length=0;
  logLine('info','管道断开后的业务日志');
  assert.deepEqual(out.chunks,[],'断开的控制台不应继续被写入');
  const text=fs.readFileSync(file,'utf8');
  assert.match(text,/控制台输出管道已断开（EPIPE），日志改为只写文件/);
  assert.match(text,/\[info\] 管道断开后的业务日志/);
  out.emit('error',brokenPipe());
  assert.equal(fs.readFileSync(file,'utf8').match(/控制台输出管道已断开/g)?.length,1,'同一路断开只记录一次');
});

test('stderr 断开后错误日志仍落文件，不依赖控制台存活',()=>{
  const {file}=workspace(),out=new Probe(),err=new Probe();
  configureLogging({file,mirrorConsole:true,streams:{out:pipe(out),err:pipe(err)}});
  err.emit('error',brokenPipe());
  logError(new Error('提醒检查失败'),'提醒检查未完成');
  assert.deepEqual(err.chunks,[],'断开的 stderr 不应继续被写入');
  assert.match(fs.readFileSync(file,'utf8'),/\[error\] 提醒检查未完成：Error: 提醒检查失败/);
});

test('非 EPIPE 的 stream 错误仍进入日志与另一路输出',()=>{
  const {file}=workspace(),out=new Probe(),err=new Probe();
  configureLogging({file,mirrorConsole:true,streams:{out:pipe(out),err:pipe(err)}});
  err.emit('error',Object.assign(new Error('not enough space'),{code:'ENOSPC'}));
  assert.match(fs.readFileSync(file,'utf8'),/\[error\] 控制台输出失败：Error: not enough space/);
  assert.equal(out.chunks.filter(chunk=>chunk.includes('控制台输出失败')).length,1,'非 EPIPE 错误应保持可见');
});

test('write 同步抛错时同样降级，不打断调用方',()=>{
  const {file}=workspace(),boom=new Probe();
  boom.write=()=>{throw brokenPipe();};
  configureLogging({file,mirrorConsole:true,streams:{out:pipe(boom),err:pipe(new Probe())}});
  logLine('info','同步抛错也不影响业务');
  assert.equal(isStreamBroken(pipe(boom)),true);
  assert.match(fs.readFileSync(file,'utf8'),/\[info\] 同步抛错也不影响业务/);
});

test('文件日志就绪前的记录先缓存，configureLogging 后补写',()=>{
  const {file}=workspace();
  configureLogging({file:undefined,mirrorConsole:false});
  logLine('info','启动早期日志');
  configureLogging({file});
  assert.match(fs.readFileSync(file,'utf8'),/\[info\] 启动早期日志/);
  configureLogging({file:undefined,mirrorConsole:true});
});

test('重复安装守卫不会重复注册或重复报错',()=>{
  const {file}=workspace(),out=new Probe(),err=new Probe(),streams={out:pipe(out),err:pipe(err)};
  configureLogging({file,mirrorConsole:true,streams});
  installStreamGuards(streams);installStreamGuards(streams);
  out.emit('error',brokenPipe());
  assert.equal(fs.readFileSync(file,'utf8').match(/控制台输出管道已断开/g)?.length,1);
});
