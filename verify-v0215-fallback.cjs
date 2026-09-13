/**
 * @deprecated
 *
 * Historical verification for 0.2.15 fallback behavior: with the custom asset
 * folder hidden the app had to fall back to the built-in *cat* companion and
 * say why.
 *
 * That cat asset and its `小猫桌宠` copy were removed in Phase 4A. The current
 * product must never reintroduce them, so this script is intentionally excluded
 * from current release acceptance.
 *
 * Do not modify current production behavior merely to make this verifier pass.
 *
 * Superseded by:
 * - verify-v030-avatar-pack.cjs (registry / availability contract)
 * - verify-v030-avatar-runtime.cjs (fallback chain + last-known-good)
 * - verify-v0220-packaged.cjs (`打包版无猫相关素材或文案`)
 *
 * Kept only for historical regression archaeology.
 */
// 0.2.15 fallback run: with the custom asset folder hidden, the app must keep
// working with the built-in cat companion and say why.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const output=path.join(__dirname,'test-data','v0215-fallback-'+Date.now());
fs.mkdirSync(output,{recursive:true});
process.env.DAYHUB_TEST_DATA=output;
const custom=path.join(__dirname,'dist','assets','companion','custom');
const hidden=custom+'.hidden';
fs.renameSync(custom,hidden);
require('./dist/main.cjs');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const report=[];
function check(name,value){assert.ok(value,name);report.push(name);}
// Windows rounds transparent frameless windows to the physical pixel grid.
const near=(actual,expected,tolerance=2)=>Math.abs(actual-expected)<=tolerance;
app.whenReady().then(async()=>{
  try{
    let panel,orb;
    for(let i=0;i<120;i++){const ws=BrowserWindow.getAllWindows();panel=ws.find(w=>!w.webContents.getURL().includes('#')&&w.webContents.getURL().includes('index.html'));orb=ws.find(w=>w.webContents.getURL().endsWith('#orb'));if(panel&&orb&&!panel.webContents.isLoading()&&!orb.webContents.isLoading())break;await wait(100);}
    const run=code=>panel.webContents.executeJavaScript(code);
    const pet=code=>orb.webContents.executeJavaScript(code);
    // The app already resolved (and cached) the missing bundle at startup; put
    // the shipped assets back immediately so the repository stays intact.
    if(fs.existsSync(hidden))fs.renameSync(hidden,custom);
    await wait(600);
    const bundle=await run('window.dayhub.companionAssets()');
    check('素材缺失时明确回退到小猫桌宠',bundle.available===false&&/小猫/.test(bundle.reason));
    const live=await run('window.dayhub.live()');
    check('素材缺失时不强行切到专属形象',live.preferences.mode!=='custom');
    check('回退后仍是可用的小猫桌宠窗口',near(orb.getSize()[0],300)&&near(orb.getSize()[1],128));
    check('回退后渲染内置形象且不报错',await pet("!!document.querySelector('.pet-art')&&!document.querySelector('.companion-frame')"));
    check('设置页可读取回退原因',/小猫/.test(await run("window.dayhub.companionAssets().then(a=>a.reason)")));
    const log=fs.readFileSync(path.join(output,'dayhub.log'),'utf8');
    check('日志记录回退原因',/桌宠素材 .*小猫/.test(log));
    fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({output,passed:report},null,2));
    console.log(JSON.stringify({output,passed:report},null,2));
    app.quit();
  }catch(e){if(fs.existsSync(hidden))fs.renameSync(hidden,custom);console.error(e);fs.writeFileSync(path.join(output,'failure.txt'),e.stack||String(e));app.exit(1);}
});
