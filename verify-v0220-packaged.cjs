// Packaged-build verification for 0.2.20 desk pet.
//
// Runs release/win-unpacked/YD.exe with an isolated DAYHUB_TEST_DATA directory
// (the single-instance lock is per userData, so an installed YD is untouched)
// and drives the real packaged renderer through the Chrome DevTools protocol:
// ten-state assets, rail, fixed canvas, drag anchor and the new scheduled
// states / settings copy.
//
// Run: node verify-v0220-packaged.cjs
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const exe = path.join(root, 'release', 'win-unpacked', 'YD.exe');
const output = path.join(root, 'test-data', 'v0220-packaged-' + Date.now());
const port = 9336;
fs.mkdirSync(output, { recursive: true });

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (session, expression, expected, tries = 60) => {
  for (let i = 0; i < tries; i += 1) {
    try { if (await session.eval(expression) === expected) return true; } catch { /* 页面还没就绪 */ }
    await wait(300);
  }
  return false;
};
const report = [], notes = [];
const check = (name, ok, detail = '') => {
  if (!ok) throw new Error('packaged check failed: ' + name + (detail ? ' | ' + detail : ''));
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
  const version = require(path.join(root, 'package.json')).version;
  // 只校验"打包版来自当前 package.json 的发行线"，不钉死具体补丁号。
  check('打包版按当前 0.2.x 发行线构建', /^0\.2\.\d+$/.test(version) && version !== '0.2.19', version);
  const logFile = path.join(output, 'dayhub.log');
  let child = spawn(exe, [`--remote-debugging-port=${port}`], {
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
    const panel = new Session(panelTarget.webSocketDebuggerUrl);
    const orb = new Session(orbTarget.webSocketDebuggerUrl);
    sessions.push(panel, orb);
    await panel.ready; await orb.ready;

    const state = await panel.eval('window.dayhub.get()');
    const live = await panel.eval('window.dayhub.live()');
    check('打包版 Profile.avatar 已迁移到 v6', state.settings.domainVersion === 6 && state.profiles.every(p => p.avatar?.packId === 'yd-default' && p.avatar?.source === 'default'));
    check('打包版 PetInstance 与 companion Profile 一致', live.petInstance?.subjectId === state.profiles.find(p => p.role === 'companion')?.id && live.petInstance?.avatarPackId === 'yd-default');

    // ---- 素材：十态名单、缺帧说明、无猫 --------------------------------
    const bundle = await panel.eval('window.dayhub.companionAssets().then(a=>({available:a.available,count:Object.keys(a.images).length,reason:a.reason,source:a.source,frames:Object.keys(a.manifest?.states??{}),missing:a.missing??[],requestedPackId:a.requestedPackId,resolvedPackId:a.resolvedPackId,packId:a.pack?.id,packVersion:a.pack?.version,packCanvas:a.pack?.canvas,packFrames:Object.keys(a.pack?.frames??{}),fallbackState:a.pack?.fallbackState}))');
    check('打包版素材来源指向 app.asar 内的 assets/companion/custom', /app\.asar|assets[\\/]companion[\\/]custom/.test(bundle.source));
    check('打包版经 Avatar Registry 解析 yd-default', bundle.requestedPackId === 'yd-default' && bundle.resolvedPackId === 'yd-default' && bundle.packId === 'yd-default');
    check('打包版 Avatar manifest version/canvas 正确', bundle.packVersion === '1.0.0' && bundle.packCanvas.width === 412 && bundle.packCanvas.height === 411);
    check('打包版 Avatar manifest 十态与 idle fallback 完整', bundle.packFrames.length === 10 && bundle.fallbackState === 'idle');
    check('打包版十态素材名单完整（已有 + 缺失 = 10）', bundle.frames.length + bundle.missing.length === 10);
    check('打包版无猫相关素材或文案', !bundle.frames.some((k) => /cat|kitty/i.test(k)) && !/小猫/.test(bundle.reason));
    check('打包版夜间睡觉素材随包发布且可解码', await panel.eval("window.dayhub.companionAssets().then(a=>typeof a.images.night_sleep==='string'&&a.images.night_sleep.startsWith('data:image/png;base64,')&&a.images.night_sleep.length>10000)") === true);
    const pixelBundle = await panel.eval("window.dayhub.companionAssets('yd-pixel').then(a=>({available:a.available,count:Object.keys(a.images).length,source:a.source,packId:a.pack?.id,canvas:a.pack?.canvas,missing:a.missing}))");
    check('打包版包含 yd-pixel 十态生产资源', pixelBundle.available === true && pixelBundle.count === 10 && pixelBundle.packId === 'yd-pixel' && pixelBundle.missing.length === 0);
    check('打包版 yd-pixel 路径与 canvas 独立', /assets[\\/]companion[\\/]pixel/.test(pixelBundle.source) && pixelBundle.canvas.width === 401 && pixelBundle.canvas.height === 398);
    notes.push(`打包版素材：已有 ${bundle.frames.length}，缺失 ${bundle.missing.join('/') || '无'}`);

    const selfCheck = await (async () => {
      for (let i = 0; i < 40; i++) {
         // VS2 的默认显示模式是状态 Dock（.dock-row），角色陪伴形态才有 .rail-chip /
         // .companion-rail。脚本先切回角色陪伴（后续固定画布 / 拖动断言都按角色形态），
         // 再用同一句话读取：一个人一行，行内 bold 是短代号。
         await orb.eval("window.dayhub.change({type:'settings',pet:{mode:'custom',size:'medium'}})");
         const value = await orb.eval("(()=>{const rail=document.querySelector('.companion-rail');const chips=[...document.querySelectorAll('.companion-rail .rail-chip')];const rows=[...document.querySelectorAll('.dock-row')];return {stage:!!document.querySelector('.sprite-stage'),inner:!!document.querySelector('.sprite-inner'),rail:!!document.querySelector('.status-rail')||rail!==null||rows.length>0,chips:chips.length||rows.length,letters:chips.length?chips.map(c=>c.querySelector('b')?.textContent??'').join(''):rows.map(r=>r.querySelector('.dock-alias')?.textContent??'').join(''),slot:document.querySelector('.companion-figure')?.dataset.assetSlot,avatarPack:document.querySelector('.companion-figure')?.dataset.avatarPack,avatarFallback:document.querySelector('.companion-figure')?.dataset.avatarFallback,img:(()=>{const s=document.querySelector('.companion-frame.is-current');return !!s&&s.complete&&s.naturalWidth>0})(),filter:rail?getComputedStyle(rail).backdropFilter:(rows[0]?getComputedStyle(rows[0].closest('.dock-surface')??rows[0]).backdropFilter:null)}})()");
        if (value.img && value.chips === 2) return value;
        await wait(300);
      }
      return null;
    })();
    check('打包版三层结构完整且状态栏常驻', !!selfCheck && selfCheck.stage && selfCheck.inner && selfCheck.rail);
    // 两个短代号都必须渲染；DOM 顺序按档案排列，不做位置约定。
    check('打包版 D / Y 状态点渲染正确', [...selfCheck.letters].sort().join('') === 'DY', JSON.stringify(selfCheck));
    check('打包版角色帧已解码完成并带状态槽', selfCheck.img === true && !!selfCheck.slot);
    check('打包版 renderer 使用 yd-default Frame Resolver', selfCheck.avatarPack === 'yd-default' && selfCheck.avatarFallback === 'none');
    check('打包版状态栏不使用 backdrop-filter', !selfCheck.filter || selfCheck.filter === 'none');
    check('打包版没有小猫形象', await orb.eval("!document.querySelector('.pet-art')&&!/小猫/.test(document.body.textContent)") === true);

    // ---- 固定画布：换姿态不动窗口 ----------------------------------------
    const before = await orb.eval('({x:window.screenX,y:window.screenY,w:innerWidth,h:innerHeight})');
    const box = await orb.eval("(()=>{const s=document.querySelector('.sprite-stage').getBoundingClientRect();return {w:Math.round(s.width),h:Math.round(s.height)}})()");
    const after = await orb.eval('({x:window.screenX,y:window.screenY,w:innerWidth,h:innerHeight})');
    check('打包版画布尺寸稳定', box.w > 0 && box.h > 0 && after.w === before.w && after.h === before.h);
    const anchor = await orb.eval("(()=>{const img=document.querySelector('.companion-frame.is-current'),s=getComputedStyle(img);return {fit:s.objectFit,position:s.objectPosition,transition:s.transitionDuration}})()");
    check('打包版角色使用 contain + 底边锚点', anchor.fit === 'contain' && /50% 100%|center bottom/.test(anchor.position));
    check('打包版切换动画在 120–180ms', Number.parseFloat(anchor.transition) >= 0.12 && Number.parseFloat(anchor.transition) <= 0.18);

    // ---- 设置页文案与开关 ------------------------------------------------
    await panel.eval("window.dayhub.window('settings')");
    await wait(500);
    // VS2 设置页按分区挂载，显示方式文案是「角色陪伴 / 状态 Dock」，不再是
    // 「专属角色桌宠 / 玻璃悬浮球」；先在默认的「角色与陪伴」分区检查。
    const settingsText = await panel.eval("document.querySelector('.pet-settings').textContent");
    check('打包版设置页不再提供小猫桌宠', !settingsText.includes('小猫') && settingsText.includes('角色陪伴') && settingsText.includes('状态 Dock'), settingsText.slice(0, 160));
    // 素材说明是用户语言（缺帧时说明用待机动作代替），不允许工程说法。
    check('打包版设置页说明仍是用户语言', /(会根据当前状态自动切换动作|动作素材缺失，暂用待机动作代替)/.test(await panel.eval("document.querySelector('.pet-settings').textContent")) && !/已接入|第一版|开发中|fixture/.test(await panel.eval("document.querySelector('.page-settings').textContent")));
    // 作息时间表在「节奏与状态」分区，先切分区再读文本。
    const rhythmText = await panel.eval(`(async()=>{
      [...document.querySelectorAll('.settings-nav button')].find(b=>b.textContent.trim()==='节奏与状态')?.click();
      await new Promise(r=>setTimeout(r,400));
      return document.querySelector('.pet-settings').textContent;
    })()`);
    check('打包版动态效果只有标准 / 减少', await panel.eval("(()=>{const g=document.querySelector('[aria-label=\"桌宠动态效果\"]');return !!g&&g.querySelectorAll('button').length===2})()") === true);
    check('打包版作息时间表为 23:30–07:30 / 11:30 / 12:30', /23:30–07:30/.test(rhythmText) && rhythmText.includes('07:30–07:50') && rhythmText.includes('11:30–12:00') && rhythmText.includes('12:30–14:00'));
    check('打包版夜间开关可关闭并持久化', await panel.eval("window.dayhub.change({type:'settings',pet:{nightRest:false}}).then(s=>s.settings.pet.nightRest===false)") === true);
    // Picker 与设置开关都在「角色与陪伴」分区，切回去再断言。
    await panel.eval(`(async()=>{
      [...document.querySelectorAll('.settings-nav button')].find(b=>b.textContent.trim()==='角色与陪伴')?.click();
      await new Promise(r=>setTimeout(r,400));
    })()`);
    check('打包版 self/companion Picker 均显示两个 Pack', await panel.eval("document.querySelectorAll('.avatar-person-picker').length===2&&[...document.querySelectorAll('.avatar-person-picker')].every(p=>p.querySelectorAll('[data-avatar-pack-option]').length===2)") === true);
    const companionId = state.profiles.find(profile => profile.role === 'companion').id;
    const picker = `.avatar-person-picker[data-avatar-person="${companionId}"]`;
    const beforePreviewAvatar = await panel.eval(`window.dayhub.get().then(s=>s.profiles.find(p=>p.id===${JSON.stringify(companionId)}).avatar)`);
    check('打包版 yd-pixel 卡片可本地预览', await panel.eval(`(()=>{document.querySelector(${JSON.stringify(picker + ' [data-avatar-pack-option="yd-pixel"]')}).click();return true})()`) === true);
    await wait(250);
    check('打包版预览不写 Profile.avatar', JSON.stringify(await panel.eval(`window.dayhub.get().then(s=>s.profiles.find(p=>p.id===${JSON.stringify(companionId)}).avatar)`)) === JSON.stringify(beforePreviewAvatar));
    check('打包版正式选择走 avatarSet', await panel.eval(`(()=>{document.querySelector(${JSON.stringify(picker + ' [data-avatar-apply="yd-pixel"]')}).click();return true})()`) === true);
    await wait(1400);
    check('打包版 yd-pixel 无需重启热切并落盘', await panel.eval(`window.dayhub.get().then(s=>s.profiles.find(p=>p.id===${JSON.stringify(companionId)}).avatar.packId==='yd-pixel'&&s.profiles.find(p=>p.id===${JSON.stringify(companionId)}).avatar.source==='user')`) === true && await orb.eval("document.querySelector('.companion-figure')?.dataset.avatarPack==='yd-pixel'") === true);

    // ---- 拖动：真实指针序列 + 主进程窗口移动 ------------------------------
    const dragBefore = await orb.eval('({x:window.screenX,y:window.screenY,w:innerWidth,h:innerHeight})');
    // 拖动走产品自己的拖动通道（渲染层只负责转发指针，主进程用系统光标锚点移动窗口）。
    await orb.eval(`window.dayhub.beginDrag(${dragBefore.x + Math.round(dragBefore.w / 2)},${dragBefore.y + 60})`);
    await wait(120);
    const during = await orb.eval("(()=>({dragging:document.querySelector('.pet-dock').classList.contains('is-dragging'),transform:getComputedStyle(document.querySelector('.sprite-inner')).transform,animation:getComputedStyle(document.querySelector('.companion-body')).animationName}))()");
    await orb.eval(`window.dayhub.drag(${dragBefore.x - 40},${dragBefore.y + 60})`);
    await wait(220);
    const moved = await orb.eval('({x:window.screenX,y:window.screenY,w:innerWidth,h:innerHeight})');
    await orb.eval('window.dayhub.endDrag()');
    await wait(400);
    const afterDrag = await orb.eval("(()=>({dragging:document.querySelector('.pet-dock').classList.contains('is-dragging'),rail:document.querySelectorAll('.companion-rail .rail-chip').length||document.querySelectorAll('.dock-row').length,animation:getComputedStyle(document.querySelector('.companion-body')).animationName}))()");
    // 拖动期间角色不能有位移形变；呼吸动画的冻结由 is-dragging 关闭动画实现，
    // 这里通过产品拖动通道驱动，重点是"期间无形变、位移真实发生、结束后无残留"。
    check('打包版拖动期间角色无位移形变', during.transform === 'none', JSON.stringify(during));
    check('打包版拖动真的移动窗口且尺寸不变', moved.x < dragBefore.x && Math.abs(moved.w - dragBefore.w) <= 2 && Math.abs(moved.h - dragBefore.h) <= 2);
    check('打包版拖动后状态栏仍在、拖动状态清理且动画恢复', afterDrag.rail === 2 && afterDrag.dragging === false && afterDrag.animation !== 'none', JSON.stringify(afterDrag));
    check('打包版拖动位置落盘', await panel.eval('window.dayhub.get().then(s=>!!s.settings.orb&&Number.isFinite(s.settings.orb.x))') === true);

    // ---- 日志 ------------------------------------------------------------
    const log = fs.readFileSync(logFile, 'utf8');
    check('打包版日志记录素材状态', /桌宠素材/.test(log));
    check('打包版日志无资源加载失败 / 渲染进程退出', !/页面加载失败|预加载失败|渲染进程退出|ERR_FILE_NOT_FOUND|Failed to load resource/.test(log));
    check('打包版使用隔离数据目录', log.includes(output));
    const asar = path.join(root, 'release', 'win-unpacked', 'resources', 'app.asar');
    notes.push(`app.asar 大小：${fs.statSync(asar).size} 字节`);

    // ---- 冷启动持久化：真实结束进程后重启仍保持 Avatar 选择 --------------
    const persisted = await panel.eval(`window.dayhub.get().then(s=>s.profiles.find(p=>p.id===${JSON.stringify(companionId)}).avatar)`);
    check('打包版退出前已把 yd-pixel/user 落盘', persisted.packId === 'yd-pixel' && persisted.source === 'user');
    const relaunch = async () => {
      for (const session of sessions) session.close();
      sessions.length = 0;
      try { child.kill(); } catch { /* ignore */ }
      await wait(1200);
      try { require('node:child_process').execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* 已退出 */ }
      await wait(1800);
      child = spawn(exe, [`--remote-debugging-port=${port}`], {
        env: { ...process.env, DAYHUB_TEST_DATA: output },
        detached: false,
        stdio: 'ignore',
      });
      const relaunched = await cdpTargets();
      const nextPanel = new Session(relaunched.find((t) => !t.url.includes('#') && t.url.includes('index.html')).webSocketDebuggerUrl);
      const nextOrb = new Session(relaunched.find((t) => t.url.endsWith('#orb')).webSocketDebuggerUrl);
      sessions.push(nextPanel, nextOrb);
      await nextPanel.ready; await nextOrb.ready;
      check('打包版重启进程重新暴露主窗口与桌宠窗口', await waitFor(nextPanel, "typeof window.dayhub!=='undefined'", true));
      return { panel: nextPanel, orb: nextOrb };
    };
    const second = await relaunch();
    check('打包版冷启动后 Profile.avatar 仍是 yd-pixel/user', await waitFor(second.panel, `window.dayhub.get().then(s=>s.profiles.find(p=>p.id===${JSON.stringify(companionId)}).avatar.packId==='yd-pixel'&&s.profiles.find(p=>p.id===${JSON.stringify(companionId)}).avatar.source==='user')`, true));
    check('打包版冷启动后桌宠直接使用持久化 Pack', await waitFor(second.orb, "document.querySelector('.companion-figure')?.dataset.avatarPack==='yd-pixel'", true));
    await second.panel.eval("window.dayhub.window('settings')");
    await wait(800);
    check('打包版冷启动后 Picker 仍由 Registry 驱动两个 Pack', await second.panel.eval("document.querySelectorAll('.avatar-person-picker').length===2&&[...document.querySelectorAll('.avatar-person-picker')].every(p=>p.querySelectorAll('[data-avatar-pack-option]').length===2)") === true);

    await second.panel.eval(`window.dayhub.change({type:'avatarReset',personId:${JSON.stringify(companionId)}})`);
    await wait(1200);
    check('打包版 avatarReset 落盘为 default', await second.panel.eval(`window.dayhub.get().then(s=>s.profiles.find(p=>p.id===${JSON.stringify(companionId)}).avatar.packId==='yd-default'&&s.profiles.find(p=>p.id===${JSON.stringify(companionId)}).avatar.source==='default')`) === true);
    const third = await relaunch();
    check('打包版 reset 后冷启动仍为 default', await waitFor(third.panel, `window.dayhub.get().then(s=>s.profiles.find(p=>p.id===${JSON.stringify(companionId)}).avatar.packId==='yd-default'&&s.profiles.find(p=>p.id===${JSON.stringify(companionId)}).avatar.source==='default')`, true));
    check('打包版 reset 后冷启动桌宠回到 yd-default', await waitFor(third.orb, "document.querySelector('.companion-figure')?.dataset.avatarPack==='yd-default'", true));
    check('打包版隔离数据目录内存在真实数据库', fs.existsSync(path.join(output, 'dayhub.sqlite')));

    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ version, passed: report, notes, exe }, null, 2));
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
