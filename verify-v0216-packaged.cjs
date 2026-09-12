// Packaged-build verification for 0.2.16.
//
// Runs release/win-unpacked/YD.exe with an isolated DAYHUB_TEST_DATA
// directory (the single-instance lock is per userData, so the installed app is
// untouched) and drives the real packaged renderer through the Chrome DevTools
// protocol: assets, companion rail, drag freeze and the inbox composer.
//
// Run: node verify-v0216-packaged.cjs
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const exe = path.join(root, 'release', 'win-unpacked', 'YD.exe');
const output = path.join(root, 'test-data', 'v0216-packaged-' + Date.now());
const port = 9333;
fs.mkdirSync(output, { recursive: true });

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const report = [], notes = [];
const check = (name, ok) => {
  if (!ok) throw new Error('packaged check failed: ' + name);
  report.push(name);
};

async function cdpTargets() {
  for (let i = 0; i < 120; i++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const pages = targets.filter((t) => t.type === 'page');
      if (pages.length >= 5) return pages;
    } catch { /* 端口还没起来 */ }
    await wait(500);
  }
  throw new Error('打包版未在 60 秒内暴露调试端口');
}

class Session {
  constructor(url) {
    this.id = 0;
    this.pending = new Map();
    this.socket = new WebSocket(url);
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      const resolver = this.pending.get(message.id);
      if (resolver) { this.pending.delete(message.id); resolver(message); }
    });
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener('open', () => resolve());
      this.socket.addEventListener('error', (error) => reject(error));
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve) => this.pending.set(id, resolve));
  }
  async eval(expression) {
    const response = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (response.result?.exceptionDetails) throw new Error(response.result.exceptionDetails.text + ' ' + (response.result.exceptionDetails.exception?.description ?? ''));
    return response.result?.result?.value;
  }
  close() { try { this.socket.close(); } catch { /* ignore */ } }
}

(async () => {
  if (!fs.existsSync(exe)) throw new Error('未找到打包版可执行文件：' + exe);
  const logFile = path.join(output, 'dayhub.log');
  const child = spawn(exe, [`--remote-debugging-port=${port}`], {
    env: { ...process.env, DAYHUB_TEST_DATA: output },
    detached: false,
    stdio: 'ignore',
  });
  const sessions = [];
  try {
    const pages = await cdpTargets();
    check('打包版启动并暴露 5 个真实窗口', pages.length >= 5);
    const panelTarget = pages.find((t) => !t.url.includes('#') && t.url.includes('index.html'));
    const orbTarget = pages.find((t) => t.url.endsWith('#orb'));
    check('打包版包含主窗口与桌宠窗口', !!panelTarget && !!orbTarget);
    const panel = new Session(panelTarget.webSocketDebuggerUrl ?? panelTarget.webSocketDebuggerUrl);
    const orb = new Session(orbTarget.webSocketDebuggerUrl ?? orbTarget.webSocketDebuggerUrl);
    sessions.push(panel, orb);
    await panel.ready; await orb.ready;

    // ---- 资源与状态栏 ----------------------------------------------------
    const bundle = await panel.eval('window.dayhub.companionAssets().then(a=>({available:a.available,count:Object.keys(a.images).length,reason:a.reason,source:a.source}))');
    check('打包版读到七个专属角色素材（含 sleeping）', bundle.available && bundle.count === 7);
    check('打包版 sleeping 素材随包发布且可解码', await panel.eval("window.dayhub.companionAssets().then(a=>typeof a.images.sleeping==='string'&&a.images.sleeping.startsWith('data:image/png;base64,')&&a.images.sleeping.length>10000)") === true);
    check('打包版素材来源指向 app.asar 内的 assets/companion/custom', /app\.asar|assets[\\/]companion[\\/]custom/.test(bundle.source));
    const selfCheck = await (async () => {
      for (let i = 0; i < 40; i++) {
        const value = await orb.eval("(()=>({stage:!!document.querySelector('.sprite-stage'),inner:!!document.querySelector('.sprite-inner'),rail:!!document.querySelector('.status-rail'),chips:document.querySelectorAll('.companion-rail .rail-chip').length,letters:[...document.querySelectorAll('.companion-rail .rail-chip b')].map(e=>e.textContent).join(''),img:(()=>{const s=document.querySelector('.companion-frame.is-current');return !!s&&s.complete&&s.naturalWidth>0})(),filter:getComputedStyle(document.querySelector('.companion-rail')).backdropFilter}))()");
        if (value.img && value.chips === 2) return value;
        await wait(300);
      }
      return null;
    })();
    check('打包版三层结构完整且状态栏常驻', !!selfCheck && selfCheck.stage && selfCheck.inner && selfCheck.rail);
    check('打包版 D / Y 状态点渲染正确', selfCheck.letters === 'DY');
    const toneCheck = await orb.eval("(()=>{const dots=[...document.querySelectorAll('.companion-rail .rail-dot')];return {count:dots.length,tones:dots.map(d=>d.dataset.tone),colors:dots.map(d=>getComputedStyle(d).backgroundColor)}})()");
    check('打包版状态点使用唯一颜色映射（同语义同色）', toneCheck.count === 2 && toneCheck.tones.every((t) => t && t !== 'alert') && toneCheck.colors[0] === toneCheck.colors[1]);
    check('打包版角色帧已解码完成', selfCheck.img === true);
    check('打包版状态栏不使用 backdrop-filter', !selfCheck.filter || selfCheck.filter === 'none');
    const cssCheck = await orb.eval("(()=>{let hover=false,frozen=false;for(const sheet of document.styleSheets)for(const rule of sheet.cssRules){const t=rule.cssText||'';if(t.includes('.pet-handle:hover .sprite-inner')&&t.includes('translateY'))hover=true;if(t.includes('.pet-dock.is-dragging .companion-frame')&&t.includes('none'))frozen=true;}return {hover,frozen}})()");
    check('打包版包含 hover 只作用于 sprite-inner 的规则', cssCheck.hover === true);
    check('打包版包含拖动冻结动画的规则', cssCheck.frozen === true);

    // ---- 拖动：真实指针序列 + 主进程窗口移动 -----------------------------
    const dragResult = await (async () => {
      const before = await orb.eval('({x:window.screenX,y:window.screenY,w:innerWidth,h:innerHeight})');
      await orb.eval(`(()=>{const el=document.querySelector('.pet-handle');el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerId:3,button:0,buttons:1,clientX:30,clientY:60,screenX:${before.x + 60},screenY:${before.y + 60}}));return true})()`);
      const during = await orb.eval("(()=>({dragging:document.querySelector('.pet-dock').classList.contains('is-dragging'),transform:getComputedStyle(document.querySelector('.sprite-inner')).transform,animation:getComputedStyle(document.querySelector('.companion-body')).animationName}))()");
      await orb.eval(`(()=>{const el=document.querySelector('.pet-handle');el.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:3,buttons:1,clientX:0,clientY:60,screenX:${before.x - 40},screenY:${before.y + 60}}));return true})()`);
      await wait(200);
      const moved = await orb.eval('({x:window.screenX,y:window.screenY,w:innerWidth,h:innerHeight})');
      await orb.eval(`document.querySelector('.pet-handle').dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:3,button:0,clientX:0,clientY:60,screenX:${before.x - 40},screenY:${before.y + 60}}))`);
      await wait(300);
      const after = await orb.eval("(()=>({dragging:document.querySelector('.pet-dock').classList.contains('is-dragging'),rail:document.querySelectorAll('.companion-rail .rail-chip').length,animation:getComputedStyle(document.querySelector('.companion-body')).animationName}))()");
      return { before, during, moved, after };
    })();
    check('打包版拖动期间 is-dragging 生效且动画冻结', dragResult.during.dragging === true && dragResult.during.transform === 'none' && dragResult.during.animation === 'none');
    check('打包版拖动真的移动窗口且尺寸不变', dragResult.moved.x < dragResult.before.x && Math.abs(dragResult.moved.w - dragResult.before.w) <= 2 && Math.abs(dragResult.moved.h - dragResult.before.h) <= 2);
    check('打包版拖动后状态栏仍然存在', dragResult.after.rail === 2 && dragResult.after.dragging === false);
    check('打包版拖动后动画恢复', dragResult.after.animation !== 'none');
    check('打包版拖动位置落盘', await panel.eval('window.dayhub.get().then(s=>!!s.settings.orb&&Number.isFinite(s.settings.orb.x))') === true);

    // ---- 通知收件箱：统一录入入口 ----------------------------------------
    await panel.eval(`window.dayhub.change({type:'settings',setup:true})`);
    await panel.eval(`[...document.querySelectorAll('.nav-item')].find(b=>b.textContent.includes('通知收件箱')).click()`);
    await wait(500);
    check('打包版收件箱只有一个统一录入入口', await panel.eval("!!document.querySelector('.capture-composer')&&![...document.querySelectorAll('button')].some(b=>['新建文字通知','粘贴文字','粘贴截图'].includes(b.textContent.trim()))") === true);
    await panel.eval(`(()=>{const dt=new DataTransfer();dt.setData('text/plain','【打包验收】9月15日 10:00 在三楼会议室开教研会。');document.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));return true})()`);
    await wait(400);
    check('打包版 Ctrl+V 文字进入 Composer', await panel.eval("document.querySelector('.capture-input').value.includes('打包验收')") === true);
    await panel.eval(`(()=>{const el=document.querySelector('.capture-input');el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,bubbles:true,cancelable:true}));return true})()`);
    let detail = false;
    for (let i = 0; i < 30 && !detail; i++) { detail = await panel.eval("document.querySelector('.inbox-detail')?.textContent.includes('打包验收')===true"); if (!detail) await wait(300); }
    check('打包版 Ctrl+Enter 保存原文并自动整理，详情自动打开', detail === true);
    check('打包版详情底部有固定操作条', await panel.eval("(()=>{const bar=document.querySelector('.inbox-detail-actions');return !!bar&&getComputedStyle(bar).position==='sticky'&&bar.textContent.includes('保存草稿')})()") === true);
    // 打包版默认窗口 1050px（窄窗语义）；调到 1360px 后应变成宽窗语义。
    let resized = false;
    try {
      const windowInfo = await panel.send('Browser.getWindowForTarget');
      if (windowInfo.result?.windowId !== undefined) {
        await panel.send('Browser.setWindowBounds', { windowId: windowInfo.result.windowId, bounds: { width: 1360, height: 880 } });
        await wait(900);
        resized = true;
      }
    } catch { /* 不支持调整窗口时按当前宽度判断 */ }
    const width = await panel.eval('innerWidth');
    const hasBack = await panel.eval("!!document.querySelector('.crumb-back')");
    const listVisible = await panel.eval("getComputedStyle(document.querySelector('.inbox-list')).display!=='none'");
    if (resized && width >= 1100) {
      check('打包版宽窗详情没有页面级返回且列表同屏', hasBack === false && listVisible === true);
    } else {
      check('打包版窄窗详情保留返回入口', hasBack === true);
    }
    notes.push(`打包版窗口宽度：${width}${resized ? '（已由验收脚本调整为 1360）' : ''}`);
    check('打包版原文可回溯且来源为 CLIPBOARD', await panel.eval("window.dayhub.get().then(s=>{const n=s.notices.find(n=>(n.originalText||'').includes('打包验收'));return !!n&&n.sourceType==='CLIPBOARD'&&n.originalText===n.text})") === true);

    // ---- 事项筛选与设置文案 ----------------------------------------------
    await panel.eval(`[...document.querySelectorAll('.nav-item')].find(b=>b.textContent.trim()==='事项与会议').click()`);
    await wait(400);
    check('打包版事项筛选为两级 IA', await panel.eval("[...document.querySelectorAll('.management-toolbar .segmented button')].map(b=>b.textContent.trim()).join('|')") === '全部|待办|会议');
    await panel.eval(`[...document.querySelectorAll('.nav-item')].find(b=>b.textContent.trim()==='设置与备份').click()`);
    await wait(400);
    const settingsText = await panel.eval("document.querySelector('.pet-settings').textContent");
    check('打包版设置页使用用户语言', settingsText.includes('会根据当前状态自动切换动作') && !/已接入|6 个状态|第一版/.test(await panel.eval("document.querySelector('.page-settings').textContent")));
    check('打包版动态效果只有标准 / 减少', await panel.eval("(()=>{const g=document.querySelector('[aria-label=\"桌宠动态效果\"]');return !!g&&g.querySelectorAll('button').length===2})()") === true);
    check('打包版设置页有夜间休息开关', await panel.eval("(()=>{const row=[...document.querySelectorAll('.pet-settings label')].find(l=>l.textContent.includes('夜间自动休息'));return !!row&&row.textContent.includes('23:30')&&row.textContent.includes('06:30')&&!!row.querySelector('input[type=checkbox]')})()") === true);
    check('打包版夜间开关可关闭并持久化', await panel.eval("window.dayhub.change({type:'settings',pet:{nightRest:false}}).then(s=>s.settings.pet.nightRest===false)") === true);

    // ---- 日志与数据 --------------------------------------------------------
    const log = fs.readFileSync(logFile, 'utf8');
    check('打包版日志记录素材接入', /桌宠素材 专属角色/.test(log));
    // 目录名里可能出现 “404” 这类数字，这里只匹配真正的加载失败记录。
    check('打包版日志无资源加载失败 / 渲染进程退出', !/页面加载失败|预加载失败|渲染进程退出|ERR_FILE_NOT_FOUND|Failed to load resource/.test(log));
    check('打包版使用隔离数据目录', log.includes(output));
    check('打包版创建了独立数据库', fs.existsSync(path.join(output, 'dayhub.sqlite')) || fs.existsSync(path.join(output, 'dayhub.sqlite.tmp')));
    notes.push(`打包版数据目录：${output}`);
    const bytes = fs.statSync(path.join(root, 'release', 'win-unpacked', 'resources', 'app.asar')).size;
    notes.push(`app.asar 大小：${bytes} 字节`);
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ passed: report, notes, exe, asar: bytes }, null, 2));
    console.log(JSON.stringify({ output, passed: report.length, notes }, null, 2));
  } finally {
    for (const session of sessions) session.close();
    try { child.kill(); } catch { /* ignore */ }
    await wait(1500);
    try { require('node:child_process').execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* 已退出 */ }
  }
})().catch((error) => {
  fs.writeFileSync(path.join(output, 'failure.txt'), error.stack ?? String(error));
  console.error(error);
  process.exit(1);
});
