// EPIPE 稳定性验收：父进程用管道启动真实 Electron 主进程，在应用运行中关闭自己的读取端，
// 然后检查主进程是否仍在工作、是否出现未捕获异常，以及运行日志是否自动降级为只写文件。
// 用法：node verify-epipe-stdio.cjs                        （父进程，依次运行四种场景并断言）
//       场景 1 开发模式（等价 npm start 的 electron .，终端保持存在）
//       场景 2 真实主进程 + 持续控制台输出，运行中关闭管道
//       场景 3 对照组：不加载主进程入口的裸 console 输出（应复现 EPIPE 未捕获异常）
//       场景 4 打包版 YD.exe，运行中关闭管道
//       electron verify-epipe-stdio.cjs --child            （真实主进程 + 持续控制台输出）
//       electron verify-epipe-stdio.cjs --child-bare       （对照组：未安装守卫的裸 console 输出）
// 注意：必须放在项目根目录运行，Electron 会把入口脚本所在目录当作 app 路径。
const {spawn,spawnSync}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path');
const root=__dirname;
const mode=process.argv[2];
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const append=file=>line=>{try{fs.appendFileSync(file,line+'\n');}catch{}};
const lastLogTime=log=>{const hits=[...log.matchAll(/^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)/gm)];return hits.length?Date.parse(hits[hits.length-1][1]):NaN;};

function childProcess(){
  const data=process.env.DAYHUB_TEST_DATA,marker=path.join(data,'uncaught.txt'),alive=path.join(data,'alive.txt');
  const phase=append(path.join(data,'phase.txt'));
  phase('脚本已加载 '+Date.now());
  const record=error=>append(marker)((error&&error.stack)||String(error));
  process.on('uncaughtException',record);process.on('unhandledRejection',record);
  if(mode==='--child'){require(path.join(root,'dist','main.cjs'));phase('主进程入口已执行，守卫已安装 '+Date.now());}
  let count=0;
  setInterval(()=>{
    count+=1;
    console.log(`EPIPE 压测日志 #${count} ${Date.now()}`);
    append(alive)(`${count} ${Date.now()}`);
  },200);
  setInterval(()=>phase('仍在运行 '+Date.now()),3000);
}

async function scenario(kind){
  const script=path.join(root,'verify-epipe-stdio.cjs');
  const packaged=path.join(root,'release','win-unpacked','YD.exe');
  const electron=path.join(root,'node_modules','electron','dist','electron.exe');
  const command=kind==='packaged'?packaged:electron;
  // dev 场景直接以项目目录启动（等价于 npm start 里的 electron .），其余场景加载入口脚本。
  const args=kind==='packaged'?[]:kind==='dev'?[root]:[script,kind==='guard'?'--child':'--child-bare'];
  const output=path.join(root,'test-data',`epipe-${kind}-${Date.now()}`);
  fs.mkdirSync(output,{recursive:true});
  const logFile=path.join(output,'dayhub.log');
  const readLog=()=>fs.existsSync(logFile)?fs.readFileSync(logFile,'utf8'):'';
  const child=spawn(command,args,{cwd:root,env:{...process.env,DAYHUB_TEST_DATA:output},stdio:['ignore','pipe','pipe']});
  let captured='';
  child.stdout.on('data',chunk=>{captured+=chunk.toString('utf8');});
  child.stderr.on('data',chunk=>{captured+=chunk.toString('utf8');});
  const started=Date.now();
  // 等到应用真正起来（主进程已写出启动日志）再关闭管道，等价于使用中启动终端消失。
  const ready=kind==='dev'?'启动显示':'数据源';
  while(Date.now()-started<30000&&child.exitCode===null){
    if(kind==='bare'?captured.includes('EPIPE 压测日志'):readLog().includes(ready))break;
    await wait(100);
  }
  await wait(300);
  // 关闭管道的读取端：之后主进程的 stdout/stderr 都是断开的。dev 场景保留终端，作为对照。
  if(kind!=='dev'){child.stdout.destroy();child.stderr.destroy();}
  const closedAt=Date.now();
  await wait(kind==='bare'?5000:kind==='dev'?2000:9000);
  const result={
    kind,
    output,
    startupOutput:captured.slice(0,400),
    closedAfterMs:closedAt-started,
    stillRunning:child.exitCode===null,
    uncaught:fs.existsSync(path.join(output,'uncaught.txt'))?fs.readFileSync(path.join(output,'uncaught.txt'),'utf8').slice(0,500):null,
    aliveTicks:fs.existsSync(path.join(output,'alive.txt'))?fs.readFileSync(path.join(output,'alive.txt'),'utf8').trim().split(/\r?\n/).filter(Boolean).length:0,
    downgradeNote:null,
    logAfterDowngrade:false,
    wroteAfterBreak:false,
    consoleMirrored:false
  };
  if(kind!=='bare'){
    const log=readLog();
    result.consoleMirrored=/\[info\] (启动|数据源)/.test(captured);
    result.downgradeNote=/控制台输出管道已断开（EPIPE）/.test(log);
    result.logAfterDowngrade=result.downgradeNote&&log.slice(log.indexOf('控制台输出管道已断开')).split(/\r?\n/).some(line=>line.includes('[info] 启动显示'));
    const last=lastLogTime(log);
    result.lastLogAt=Number.isFinite(last)?new Date(last).toISOString():null;
    result.wroteAfterBreak=Number.isFinite(last)&&last>closedAt;
  }
  try{spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore'});}catch{}
  await wait(500);
  return result;
}

if(mode==='--child'||mode==='--child-bare')childProcess();
else(async()=>{
  const failure=[];
  try{
    const dev=await scenario('dev');
    const guard=await scenario('guard');
    const bare=await scenario('bare');
    const packaged=await scenario('packaged');
    if(!dev.stillRunning)failure.push('开发模式启动后主进程退出');
    if(!dev.consoleMirrored)failure.push('开发模式没有把运行日志镜像到控制台');
    if(dev.downgradeNote)failure.push('终端未关闭时不应降级为只写文件');
    if(!guard.stillRunning)failure.push('关闭管道后主进程退出');
    if(guard.uncaught)failure.push('关闭管道后出现未捕获异常：'+guard.uncaught.split('\n')[0]);
    if(!guard.downgradeNote)failure.push('日志未记录 EPIPE 降级');
    if(guard.aliveTicks<3)failure.push('关闭管道后主进程停止工作');
    if(!packaged.stillRunning)failure.push('打包版关闭管道后退出');
    if(!packaged.wroteAfterBreak)failure.push('打包版在控制台断开后没有继续写运行日志');
    const report={dev,guard,control:bare,packaged,failure,passed:!failure.length};
    const file=path.join(root,'test-data',`epipe-report-${Date.now()}.json`);
    fs.writeFileSync(file,JSON.stringify(report,null,2));
    console.log(JSON.stringify({report:file,passed:report.passed,failure,dev:{stillRunning:dev.stillRunning,consoleMirrored:dev.consoleMirrored,downgradeNote:dev.downgradeNote},guard:{stillRunning:guard.stillRunning,uncaught:guard.uncaught,downgradeNote:guard.downgradeNote,logAfterDowngrade:guard.logAfterDowngrade,aliveTicks:guard.aliveTicks},control:{uncaught:!!bare.uncaught,stillRunning:bare.stillRunning},packaged:{stillRunning:packaged.stillRunning,wroteAfterBreak:packaged.wroteAfterBreak,lastLogAt:packaged.lastLogAt}},null,2));
    process.exit(report.passed?0:1);
  }catch(error){
    failure.push('验收脚本自身失败：'+((error&&error.stack)||String(error)));
    console.log(JSON.stringify({passed:false,failure},null,2));
    process.exit(1);
  }
})();
