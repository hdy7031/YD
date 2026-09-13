/**
 * @deprecated
 *
 * Historical button walk-through for the pre-refresh main window (0.2.10–0.2.12
 * era). It loads `dist/index.html` behind `scripts/audit-preload.cjs` and looks
 * buttons up by their old visible copy (`我的安排`, `未处理提醒 · 1`, ...).
 *
 * Commit `1657d0e ui: refresh main window visual system` replaced that visual
 * system, so the audit now renders no buttons at all (`buttonCount: 0`,
 * `未找到按钮：我的安排`) and is intentionally excluded from current release
 * acceptance.
 *
 * Do not modify current production behavior merely to make this verifier pass.
 *
 * Superseded by:
 * - runtime-audit.cjs (Together workspace: navigation, windows, tray, orb, reminders)
 * - runtime-audit-solo.cjs (same surface in the Solo workspace)
 * - verify-v0220.cjs / verify-v0220-packaged.cjs (desk pet + settings copy)
 *
 * The full-page button walk-through itself has no current replacement; it is
 * historical coverage only.
 *
 * Kept only for historical regression archaeology.
 */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const output = path.join(root, 'test-data', 'ui-audit-report');
app.commandLine.appendSwitch('disable-gpu');
app.whenReady().then(async () => {
  fs.mkdirSync(output, {recursive:true});
  const win = new BrowserWindow({width:1050,height:780,show:false,backgroundColor:'#f4f2ed',webPreferences:{preload:path.join(__dirname,'audit-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  await win.loadFile(path.join(root,'dist','index.html'));
  const report = await win.webContents.executeJavaScript(`(async()=>{
    const passed=[], failed=[], wait=()=>new Promise(resolve=>setTimeout(resolve,35));
    const note=(name,ok,detail='')=>(ok?passed:failed).push({name,detail});
    const exact=(selector,text,scope=document)=>[...scope.querySelectorAll(selector)].find(el=>el.textContent.trim()===text);
    const click=async(text,scope=document)=>{const el=exact('button',text,scope);if(!el)throw new Error('未找到按钮：'+text);el.click();await wait();return el;};
    const modal=()=>document.querySelector('[role="dialog"]');
    const closeModal=async()=>{const box=modal();if(!box)throw new Error('没有打开的弹窗');const close=exact('button','取消',box)||exact('button','关闭',box);if(!close)throw new Error('弹窗缺少取消或关闭按钮');close.click();await wait();};
    try{
      await wait();
      const nav=[['我的安排','我的安排'],['Ta的课表','Ta的课表'],['课表管理','课表管理'],['事项与会议','事项与会议'],['通知收件箱','通知收件箱'],['未处理提醒','未处理提醒 · 1'],['设置与备份','设置与备份']];
      for(const [title,label] of nav){await click(label);note('导航：'+label,document.querySelector('h1')?.textContent===title,'标题未同步');}
      await click('Ta的课表');
      note('Ta页面标题',document.querySelector('h1')?.textContent==='Ta的课表');
      note('Ta页面顶部状态卡',!!document.querySelector('.partner-status-card')&&document.querySelector('.partner-status-headline')?.textContent.trim().length>0);
      note('Ta页面不再出现重复身份和不确定性文案',!['Y ·','预计','实际忙闲状态未确认','仅依据已录入课表'].some(text=>document.querySelector('.main').textContent.includes(text)));
      note('Ta日程使用紧凑列表或明确空状态',!!document.querySelector('.partner-list')||!!document.querySelector('.main .empty-state'));
      note('Ta页面日期选择器可访问',document.querySelector('input[aria-label="查看 Ta 的日期"]')?.type==='date');
      const partnerStatusBefore=document.querySelector('.partner-status-headline').textContent;
      const partnerDate=document.querySelector('input[aria-label="查看 Ta 的日期"]');
      const oldDate=partnerDate.value;
      const future=new Date(partnerDate.value+'T12:00:00Z');future.setUTCDate(future.getUTCDate()+1);partnerDate.value=future.toISOString().slice(0,10);
      partnerDate.dispatchEvent(new Event('change',{bubbles:true}));await wait();
      note('切换日期不改变顶部真实当前状态',partnerStatusBefore===document.querySelector('.partner-status-headline')?.textContent);
      partnerDate.value=oldDate;partnerDate.dispatchEvent(new Event('change',{bubbles:true}));await wait();
      note('Ta页面无横向滚动',document.querySelector('.main').scrollWidth<=document.querySelector('.main').clientWidth);
      await click('我的安排');await click('新建待办');note('新建待办弹窗',modal()?.getAttribute('aria-label')==='待办');await closeModal();
      await click('新建会议');note('新建会议弹窗',modal()?.getAttribute('aria-label')==='会议 / 活动');await closeModal();
      await click('设置我的作息');note('引导页作息弹窗',modal()?.getAttribute('aria-label')==='学校作息与学期');await closeModal();
      await click('已核对，开始使用');note('引导完成反馈',!document.querySelector('.setup-banner'));
      await click('课表管理');note('其他模块不重复显示新建按钮',!exact('button','新建待办')&&!exact('button','新建会议'));await click('学校作息');note('作息编辑不崩溃',modal()?.getAttribute('aria-label')==='学校作息与学期');await closeModal();
      await click('添加课程');note('添加课程弹窗',modal()?.getAttribute('aria-label')==='课程');await closeModal();
      note('周课表横纵视图',document.querySelectorAll('.schedule-day').length===7&&document.querySelectorAll('.period-label').length===8);
      document.querySelector('.course-block').click();await wait();note('编辑课程弹窗',modal()?.getAttribute('aria-label')==='课程');
      await click('复制课程',modal());note('复制课程弹窗',modal()?.getAttribute('aria-label')==='课程');await closeModal();
      document.querySelector('.course-block').click();await wait();await click('删除课程',modal());note('删除课程确认',modal()?.getAttribute('aria-label')==='确认删除');await closeModal();
      await click('载入整理后的课表');note('课表文件预览',modal()?.getAttribute('aria-label')==='核对课表导入'&&modal()?.textContent.includes('2026 秋季'));await closeModal();
      await click('我的安排');const deleteMeeting=exact('button','删除会议');note('会议删除入口',!!deleteMeeting);if(deleteMeeting){deleteMeeting.click();await wait();note('删除会议确认',modal()?.getAttribute('aria-label')==='确认删除');await closeModal();}
      await click('事项与会议');note('事项会议双栏',document.querySelectorAll('.management-section').length===2);await click('标记完成');note('待办完成反馈',!!exact('button','恢复待处理'));await click('恢复待处理');
      const search=document.querySelector('input[aria-label="搜索事项与会议"]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(search,'不存在的事项');search.dispatchEvent(new Event('input',{bubbles:true}));await wait();note('搜索无结果提示',[...document.querySelectorAll('.empty-state')].some(x=>x.textContent.includes('没有符合条件')));setter.call(search,'');search.dispatchEvent(new Event('input',{bubbles:true}));await wait();
      await click('通知收件箱');await click('新建文字通知');note('文字通知弹窗',modal()?.getAttribute('aria-label')==='原始通知 / 课表图片');await closeModal();
      await click('转为待办');note('通知转待办核对弹窗',modal()?.getAttribute('aria-label')==='核对并转为待办');await closeModal();
      await click('编辑 / 原图');note('通知编辑弹窗',modal()?.getAttribute('aria-label')==='原始通知 / 课表图片');await closeModal();
      await click('录入为课程');note('通知录入课程弹窗',modal()?.getAttribute('aria-label')==='课程');await closeModal();
      await click('粘贴截图');note('空剪贴板反馈',document.querySelector('[role="status"]')?.textContent.includes('没有图片'));const ok=exact('button','知道了');if(ok){ok.click();await wait();}
      await click('未处理提醒 · 1');await click('打开事项');note('提醒打开事项',modal()?.getAttribute('aria-label')==='待办');await closeModal();
      await click('设置与备份');note('桌面陪伴模块有舒适内边距',parseFloat(getComputedStyle(document.querySelector('.pet-settings')).paddingLeft)>=26);await click('我的学期与节次');note('设置页作息入口',modal()?.getAttribute('aria-label')==='学校作息与学期');await closeModal();
      await click('发送测试通知');note('测试通知反馈',document.querySelector('[role="status"]')?.textContent.includes('测试通知已提交'));const known=exact('button','知道了');if(known){known.click();await wait();}
      await click('导出完整备份');note('备份按钮反馈',document.querySelector('[role="status"]')?.textContent.includes('备份已导出'));
      await click('我的安排');
    }catch(error){failed.push({name:'审计执行',detail:error.message});}
    return {passed,failed,buttonCount:document.querySelectorAll('button').length,title:document.querySelector('h1')?.textContent};
  })()`);
  await new Promise(resolve=>setTimeout(resolve,200));
  const png = await win.webContents.capturePage();
  fs.writeFileSync(path.join(output,'overview.png'),png.toPNG());
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
  await win.close();
  app.exit(report.failed.length ? 1 : 0);
}).catch(error=>{console.error(error);app.exit(1);});
