// Real Electron + preload + SQL.js, always in an isolated database.
const {app,BrowserWindow,clipboard,nativeImage}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const output=path.join(__dirname,'test-data','v0213-'+Date.now());fs.mkdirSync(output,{recursive:true});
process.env.DAYHUB_TEST_DATA=output;
BrowserWindow.prototype.show=function(){};BrowserWindow.prototype.showInactive=function(){};
require('./dist/main.cjs');
const wait=ms=>new Promise(r=>setTimeout(r,ms)),report=[];
const check=(name,ok)=>{assert.ok(ok,name);report.push(name);};
const deadline=setTimeout(()=>{console.error('UI test timeout');app.exit(1);},60000);
app.whenReady().then(async()=>{
  let panel;
  try{
    for(let i=0;i<100;i++){panel=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('index.html'));if(panel&&!panel.webContents.isLoading())break;await wait(100);}
    await wait(500);assert.ok(panel);const run=code=>panel.webContents.executeJavaScript(code);
    const click=async label=>{await run(`(()=>{const el=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)});if(!el)throw new Error('missing '+${JSON.stringify(label)});el.click();})()`);await wait(250);};
    const fill=async(label,value)=>{await run(`(()=>{const field=[...document.querySelectorAll('label.field')].find(l=>l.querySelector('span')?.textContent===${JSON.stringify(label)});const el=field.querySelector('input,textarea,select');const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`);await wait(100);};
    // 0.2.16：宽窗列表还在旁边，所以没有返回按钮，取消选中即可；窄窗才有 ←。
    const back=async()=>{if(await run("!!document.querySelector('.crumb-back')"))await run(`document.querySelector('.crumb-back').click()`);else await run(`document.querySelector('.inbox-list-item.selected')?.click()`);await wait(300);};
    // 0.2.16：唯一录入入口是统一 Composer，不再有“新建文字通知 / 保存并整理”。
    const compose=async text=>{
      await run(`(()=>{const el=document.querySelector('.capture-input');const set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;set.call(el,${JSON.stringify(text)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await wait(120);await click('整理通知');await wait(600);
    };
    await run("window.dayhub.change({type:'settings',setup:true})");await wait(250);
    await click('通知收件箱');await compose('明天下午3点在信息楼报告厅进行新生大会，请提前10分钟到场。');
    let state=await run('window.dayhub.get()');check('文字保存并自动整理，尚未写正式事务',state.notices.length===1&&state.events.length===0&&state.notices[0].parseStatus==='NEEDS_REVIEW');
    check('草稿核对字段渲染',await run(`document.querySelector('.inbox-detail').textContent.includes('整理结果')&&[...document.querySelectorAll('.inbox-detail input')].some(e=>e.value==='新生大会')`));
    for(const width of [1366,1050,750]){panel.setSize(width,850);await wait(150);check('收件箱无横向溢出 '+width,await run("document.querySelector('.main').scrollWidth<=document.querySelector('.main').clientWidth+1"));fs.writeFileSync(path.join(output,'inbox-'+width+'.png'),(await panel.webContents.capturePage()).toPNG());}
    await fill('标题','已核对的新生大会');await click('确认并加入日程');state=await run('window.dayhub.get()');check('确认后事务、提醒和已处理状态原子保存',state.events.length===1&&state.events[0].title==='已核对的新生大会'&&state.events[0].end===null&&state.reminders.length===1&&state.notices[0].parseStatus==='CONFIRMED');
    check('已处理详情不再显示创建按钮',await run(`![...document.querySelectorAll('.inbox-detail button')].some(b=>b.textContent==='确认并加入日程')`));
    await click('查看事项');check('活动编辑器来源入口',await run(`document.querySelector('[role=dialog]').textContent.includes('来源 · 通知收件箱')`));
    await run(`document.querySelector('.source-box button').click()`);await wait(200);check('来源跳转回原始通知',await run(`!document.querySelector('[role=dialog]')&&document.querySelector('.inbox-original').textContent.includes('新生大会')`));
    await compose('下午三点开会');await wait(200);check('缺日期禁止确认',await run(`([...document.querySelectorAll('button')].find(b=>b.textContent==='确认并加入日程')).disabled`));
    await fill('日期','2030-09-10');await fill('标题','手动修正活动');await click('保存草稿');await click('事项与会议');await click('通知收件箱');check('手改草稿持久保留',await run(`window.dayhub.get().then(s=>s.notices.some(n=>n.parsedData?.title==='手动修正活动'))`));
    // 0.2.16：普通通知的主操作文案改为“确认已处理”，不再是含糊的“标记已处理”。
    await run(`window.dayhub.change({type:'inbound',id:'unknown-ui',payload:{text:'一段无法分类的信息'}}).then(()=>window.dayhub.parseNotice('unknown-ui'))`);await wait(200);await run(`document.querySelector('.inbox-list-item').click()`);await wait(150);await fill('类型','GENERAL_NOTICE');await fill('标题','保留资料');await click('确认已处理');check('UNKNOWN可手选普通通知',await run(`window.dayhub.get().then(s=>s.notices.find(n=>n.id==='unknown-ui').targetEntityType==='notice')`));
    const previous=await clipboard.readText();try{await clipboard.writeText('开题报告周五前交。');
      await run(`(()=>{const dt=new DataTransfer();dt.setData('text/plain','开题报告周五前交。');document.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));})()`);await wait(200);await click('整理通知');await wait(400);
      check('真实剪贴板进入统一入口',await run(`window.dayhub.get().then(s=>s.notices.some(n=>n.sourceType==='CLIPBOARD'&&n.detectedType==='TODO'))`));}finally{await clipboard.writeText(previous);}
    const bytes=fs.readFileSync(path.join(__dirname,'test-data','v0213-ocr.png')),image=require('node:crypto').createHash('sha256').update(bytes).digest('hex')+'.png';fs.copyFileSync(path.join(__dirname,'test-data','v0213-ocr.png'),path.join(output,'attachments',image));
    await run(`window.dayhub.change({type:'inbound',id:'image-ui',payload:{image:${JSON.stringify(image)},sourceType:'IMAGE_IMPORT'}})`);await wait(200);await run(`document.querySelector('.inbox-list-item').click()`);await wait(200);
    check('图片进入Inbox且原图可预览',await run(`document.querySelector('.inbox-image')?.naturalWidth>0`));
    let ocrText='';try{ocrText=await run(`window.dayhub.ocr(${JSON.stringify(image)})`);}catch(e){report.push('OCR系统不可用时原图仍保存');}
    if(ocrText){report.push('Windows本机OCR成功提取文字');fs.writeFileSync(path.join(output,'ocr.txt'),ocrText);}
    check('OCR成功或失败均不丢Inbox',await run(`window.dayhub.get().then(s=>s.notices.some(n=>n.id==='image-ui'&&n.image))`));
    if(ocrText)await run(`window.dayhub.parseNotice('image-ui',${JSON.stringify(ocrText)},true)`);await wait(150);
    await fill('提取文字 / 补充文字',ocrText||'明天下午3点开会');await click('保存文字并重新整理');await wait(300);
    check('图片补充文字可继续整理',await run(`window.dayhub.get().then(s=>s.notices.find(n=>n.id==='image-ui').parseStatus==='NEEDS_REVIEW'&&s.notices.find(n=>n.id==='image-ui').detectedType==='EVENT')`));
    fs.writeFileSync(path.join(output,'image.png'),(await panel.webContents.capturePage()).toPNG());
    await back();
    for(const width of [750,1366]){panel.setSize(width,850);await wait(180);check('未选中时整页通知大厅 '+width,await run(`!!document.querySelector('.inbox-hub.is-hall')&&!document.querySelector('.inbox-detail')`));fs.writeFileSync(path.join(output,'hall-'+width+'.png'),(await panel.webContents.capturePage()).toPNG());}
    await run(`document.querySelector('.inbox-list-item').click()`);await wait(150);
    check('宽窗选中后左右分栏',await run(`getComputedStyle(document.querySelector('.inbox-list')).display!=='none'&&document.querySelector('.inbox-detail').getBoundingClientRect().left>document.querySelector('.inbox-list').getBoundingClientRect().left`));
    await run(`document.querySelector('.inbox-list-item.selected').click()`);await wait(150);check('再次点击取消选中',await run(`!!document.querySelector('.inbox-hub.is-hall')`));
    panel.setSize(750,850);await run(`document.querySelector('.inbox-list-item').click()`);await wait(500);check('窄窗返回按钮不被标题栏遮挡',await run(`document.querySelector('.inbox-detail-head').getBoundingClientRect().top>=44`));check('窄窗详情替代列表而非上下堆叠',await run(`getComputedStyle(document.querySelector('.inbox-list')).display==='none'&&!!document.querySelector('.inbox-detail')`));fs.writeFileSync(path.join(output,'detail-750.png'),(await panel.webContents.capturePage()).toPNG());await back();
    await run(`window.dayhub.change({type:'inbound',id:'patch-delete',payload:{text:'误添加通知'}})`);await wait(180);await run(`document.querySelector('.inbox-list-item').click()`);await wait(150);await click('忽略');await back();check('忽略记录整体置灰',await run(`!!document.querySelector('.status-IGNORED')`));await run(`document.querySelector('.status-IGNORED').click()`);await wait(150);await click('重新处理');check('解除忽略恢复待处理',await run(`window.dayhub.get().then(s=>s.notices.find(n=>n.id==='patch-delete').parseStatus==='UNPARSED')`));
    // 0.2.16：删除收进 ⋯ 菜单，并说明删除后果。
    await run(`document.querySelector('.inbox-detail .action-menu summary').click()`);await wait(150);await click('删除通知');check('删除确认说明后果',await run(`document.querySelector('.source-box').textContent.includes('删除后')&&document.querySelector('.source-box').textContent.includes('无法恢复')`));await click('确认删除');check('误添加通知删除后回到大厅',await run(`window.dayhub.get().then(s=>!s.notices.some(n=>n.id==='patch-delete')&&!!document.querySelector('.inbox-hub.is-hall'))`));
    check('待确认红色与已确认绿色状态存在',await run(`!!document.querySelector('.status-NEEDS_REVIEW .inbox-status')&&!!document.querySelector('.status-CONFIRMED .inbox-status')&&getComputedStyle(document.querySelector('.status-NEEDS_REVIEW .inbox-status')).color!==getComputedStyle(document.querySelector('.status-CONFIRMED .inbox-status')).color`));
    check('五个窗口仍正常',BrowserWindow.getAllWindows().length===5);
    fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({report},null,2));console.log(JSON.stringify({output,report}));app.exit(0);
  }catch(e){fs.writeFileSync(path.join(output,'failure.txt'),e.stack||String(e));if(panel)fs.writeFileSync(path.join(output,'failure.png'),(await panel.webContents.capturePage()).toPNG());console.error(e);app.exit(1);}
});
