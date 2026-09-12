import fs from 'node:fs';
// 主进程日志：文件优先，控制台只是可用时的镜像。
// stdout/stderr 可能属于启动它的终端；GUI 应用必须在管道断开（EPIPE）后继续运行，
// 因此这里在最早的初始化阶段接管 stream 的 error 事件，并在控制台失效时自动降级为只写文件。
export interface ConsoleStreams { out?:NodeJS.WriteStream; err?:NodeJS.WriteStream }
// 这些错误说明控制台输出通道已经不存在，继续写入只会重复报错。
const gonePipeCodes=new Set(['EPIPE','ERR_STREAM_DESTROYED','ERR_STREAM_WRITE_AFTER_END','ECONNRESET']);
const pendingLines:string[]=[],broken=new WeakSet<object>(),guarded=new WeakSet<object>();
const pendingLimit=500;
let streams:ConsoleStreams={},logFile:string|undefined,mirror=true;
export const isBrokenPipeError=(error:unknown)=>gonePipeCodes.has(String((error as NodeJS.ErrnoException|undefined)?.code));
export const describeError=(error:unknown)=>error instanceof Error?`${error.name}: ${error.message}`:String(error);
export const isStreamBroken=(stream:unknown)=>!!stream&&broken.has(stream as object);
const consoleOut=()=>streams.out??process.stdout,consoleErr=()=>streams.err??process.stderr;
const line=(level:string,message:string)=>`${new Date().toISOString()} [${level}] ${message}\n`;
function append(text:string){
  if(logFile){try{fs.appendFileSync(logFile,text,'utf8');return;}catch{}}
  if(pendingLines.length<pendingLimit)pendingLines.push(text);
}
function safeWrite(stream:NodeJS.WriteStream|undefined,text:string){
  if(!stream||broken.has(stream))return;
  if(stream.destroyed||stream.writableEnded){broken.add(stream);return;}
  // console.log 也会同步抛错；这里直接用 stream，保证同步异常和异步 EPIPE 都不会冒泡。
  try{stream.write(text+'\n');}catch{broken.add(stream);}
}
// 必须在主进程入口尽早调用：没有 error 监听器时，stdout/stderr 上的 EPIPE
// 会变成未捕获异常，也就是 Electron 的 “A JavaScript error occurred in the main process”。
export function installStreamGuards(targets:ConsoleStreams={}){
  if(targets.out||targets.err)streams={...streams,...targets};
  for(const stream of [consoleOut(),consoleErr()]){
    if(!stream||guarded.has(stream))continue;
    guarded.add(stream);
    stream.on('error',(error:NodeJS.ErrnoException)=>{
      const first=!broken.has(stream);broken.add(stream);
      if(isBrokenPipeError(error)){
        if(first)append(line('info',`控制台输出管道已断开（${error.code}），日志改为只写文件。`));
        return;
      }
      // 非 EPIPE 的 stream 错误不在这里吞掉：仍然进入正常日志（文件 + 尚可用的另一路输出）。
      const message=`控制台输出失败：${describeError(error)}`;
      append(line('error',message));
      safeWrite(stream===consoleOut()?consoleErr():consoleOut(),line('error',message).trim());
    });
  }
}
export function configureLogging(options:{file?:string;mirrorConsole?:boolean;streams?:ConsoleStreams}={}){
  if(options.streams)installStreamGuards(options.streams);
  if(options.mirrorConsole!==undefined)mirror=options.mirrorConsole;
  if('file' in options)logFile=options.file;
  if(!logFile)return;
  const lines=pendingLines.splice(0);
  for(const text of lines){try{fs.appendFileSync(logFile,text,'utf8');}catch{pendingLines.push(text);return;}}
}
// 业务日志：先落文件，再（开发环境）镜像到控制台；任何一步失败都不影响调用方。
export function logLine(level:string,message:string){
  const text=line(level,message);
  append(text);
  if(mirror)safeWrite(level==='error'?consoleErr():consoleOut(),text.trim());
}
export function logError(error:unknown,context?:string){logLine('error',`${context?context+'：':''}${describeError(error)}`);}
