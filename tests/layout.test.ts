import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { companionGeometry, companionRail, companionSizes, companionCharacter, companionFrame, companionDock } from '../src/companion-layout.ts';
import { clampToArea, keepVisible, resolveDragStep, type DragAnchor } from '../src/geometry.ts';
import { courseTone, courseTones } from '../src/selectors.ts';

test('0.2.20 桌宠画布是固定尺寸：状态与素材内容无法改变窗口大小',()=>{
  const aspect=418/618;
  for(const size of companionSizes){
    const custom=companionGeometry('custom',size,aspect),again=companionGeometry('custom',size,aspect);
    assert.deepEqual(custom,again);
    // 画布 = 上下留白 + 角色 + 间隙 + 状态栏，状态栏永远在窗口内。
    assert.equal(custom.height,companionFrame.padY*2+companionCharacter.height[size]+companionRail.gap+companionRail.height);
    assert.ok(custom.height>companionCharacter.height[size]);
    assert.ok(custom.width>=companionCharacter.minWidth);
    // 角色宽度按画布比例缩放，不变形。
    const fromAspect=Math.max(companionCharacter.minWidth,Math.round(companionCharacter.height[size]*aspect)+companionFrame.padX*2);
    assert.ok(Math.abs(custom.width-fromAspect)<=1);
    // Visual System 2.0：Together / Solo 各自有固定几何，hover 只能改变内部内容。
    const dock=companionGeometry('orb',size,aspect,2,false);
    // 窗口高度 = 默认牌面 + hover 生长量（生长发生在固定画布内部，窗口本身不变）。
    assert.deepEqual(dock,{...companionDock.collapsed[size],height:companionDock.collapsed[size].height+companionDock.grow[size],shape:'rounded'});
    assert.ok(dock.width>=248&&dock.width<=304,`${size} Together Dock 宽度落在参考区间`);
    assert.ok(dock.height>=72&&dock.height<=84,`${size} Together Dock 画布高度落在参考区间（含 hover 预留）`);
    assert.ok(dock.width>dock.height,'Dock 是横向状态牌，不是球体');
    assert.equal(dock.shape,'rounded','Dock 使用圆角矩形窗口裁剪');
    assert.notEqual(dock.width,dock.height,'不再保留单球体设计');
    const togetherExpanded=companionGeometry('orb',size,aspect,2,true);
    assert.deepEqual(togetherExpanded,{...companionDock.expanded[size],height:companionDock.expanded[size].height+companionDock.grow[size],shape:'rounded'});
    assert.deepEqual(togetherExpanded,dock,'Together hover 不得改变窗口几何');
    const solo=companionGeometry('orb',size,aspect,1,false);
    const soloExpanded=companionGeometry('orb',size,aspect,1,true);
    assert.deepEqual(solo,{...companionDock.solo[size],height:companionDock.solo[size].height+companionDock.soloGrow[size],shape:'rounded'});
    assert.deepEqual(soloExpanded,{...companionDock.soloExpanded[size],height:companionDock.soloExpanded[size].height+companionDock.soloGrow[size],shape:'rounded'});
    assert.ok(solo.width<dock.width&&solo.width>solo.height,'Solo 是重新配比的独立横向形态');
    assert.deepEqual(soloExpanded,solo,'Solo hover 不得改变窗口几何');
  }
  // 素材比例异常时退回安全比例而不是生成 0 宽窗口。
  assert.deepEqual(companionGeometry('custom','medium',0),companionGeometry('custom','medium',0.68));
  assert.deepEqual(companionGeometry('custom','medium',Number.NaN),companionGeometry('custom','medium',0.68));
  // Window geometry only consumes the selected Pack canvas ratio; it has no
  // display-state or character-id branch.
  assert.doesNotMatch(companionGeometry.toString(),/busy_class|yd-default/);
});

test('0.2.20 渲染层透明安全区与主进程画布常量一致',()=>{
  const css=fs.readFileSync(path.join(process.cwd(),'src','ui','style.css'),'utf8');
  const framePads=[...css.matchAll(/--frame-pad-x,(\d+)px/g)].map(match=>Number(match[1]));
  assert.ok(framePads.length>0,'样式表里应使用 --frame-pad-x 变量');
  for(const value of framePads)assert.equal(value,companionFrame.padX,'CSS 回退边距必须等于 companionFrame.padX');
});

test('0.2.16 渲染层状态栏高度与主进程画布常量一致',()=>{
  const css=fs.readFileSync(path.join(process.cwd(),'src','ui','style.css'),'utf8');
  const matches=[...css.matchAll(/--rail-height,(\d+)px/g)].map(match=>Number(match[1]));
  assert.ok(matches.length>0,'样式表里应使用 --rail-height 变量');
  for(const value of matches)assert.equal(value,companionRail.height,'CSS 回退高度必须等于 companionRail.height');
});

test('Phase 2 Dual Status Dock：legacy 黄色单球体与 gold/amber 残留已清除',()=>{
  const orbCss=fs.readFileSync(path.join(process.cwd(),'src','ui','presence-orb.css'),'utf8');
  const mainCss=fs.readFileSync(path.join(process.cwd(),'src','ui','style.css'),'utf8');
  // 旧球体结构（圆形表面 / 身份字母）不再存在：Dock 是圆角状态牌。
  for(const css of [orbCss,mainCss]) assert.doesNotMatch(css,/^[\s,>+~]*\.presence-(orb|surface)\b/m,'旧的 presence-orb / presence-surface 选择器必须移除');
  assert.doesNotMatch(mainCss,/^[\s,>+~]*\.identity-mark\b/m,'旧的 identity-mark 选择器必须移除');
  // Dock 表面：mist 白底 + 圆角矩形，没有暗金色渐变。
  assert.match(orbCss,/\.dock-surface\b/);
  // 2026-09-14（Asset 04）：两端是完整半圆的状态牌（pill）。
  assert.match(orbCss,/\.dock-surface[\s\S]*?border-radius:999px/);
  assert.doesNotMatch(orbCss,/#(?:e0b234|b88a16|7e5c0c|e4c87c)/i,'Dock 路径不得保留 legacy 暗金配色');
  assert.doesNotMatch(orbCss,/linear-gradient\([^)]*rgba\(\s*2[0-9]{2}\s*,/,'Dock 不使用暖色大色块渐变');
  // 统一语义色（与 companion-colors.ts 一致）：空闲 rose、即将 amber、进行中 sage teal、
  // 专注更深一层，只有真正的冲突才是红；meal / sleep 只作为极小 indicator 保留各自的柔和色。
  for(const tone of ['#C18A9C','#D7AD59','#55A995','#60998F','#C2726A','#A3ACB0']) assert.match(orbCss,new RegExp(tone,'i'),`缺少 ${tone}`);
  assert.match(orbCss,/\.dock-row\.kind-meal/,'meal 使用独立的小范围 soft-sand indicator');
  assert.match(orbCss,/\.dock-row\.kind-(?:nap|sleep)/,'休息状态使用 dusty blue-gray indicator');
});

test('0.2.16 窗口回收：拖到屏幕边缘、显示器被拔掉都不会留在屏幕外',()=>{
  const area={x:0,y:0,width:1920,height:1040};
  assert.deepEqual(clampToArea(500,300,167,272,area),{x:500,y:300});
  // 右下越界会被拉回完全可见的位置。
  assert.deepEqual(clampToArea(1900,1030,167,272,area),{x:1920-167,y:1040-272});
  assert.deepEqual(clampToArea(-80,-40,167,272,area),{x:0,y:0});
  // 贴边吸附只在 32px 内发生。
  assert.deepEqual(clampToArea(20,400,167,272,area,true),{x:0,y:400});
  assert.deepEqual(clampToArea(60,400,167,272,area,true),{x:60,y:400});
  // 显示器被拔掉：旧坐标落在工作区之外时回到主显示器可见区域。
  assert.deepEqual(clampToArea(3000,1200,167,272,{x:0,y:0,width:1280,height:720}),{x:1280-167,y:720-272});
  // 旧的方形助手仍然保持原行为，避免影响悬浮球历史逻辑。
  assert.deepEqual(keepVisible(-10,900,{x:0,y:0,width:1920,height:1040},102),{x:0,y:900});
  assert.deepEqual(keepVisible(-10,2000,{x:0,y:0,width:1920,height:1040},102),{x:0,y:938});
});

test('0.2.16 课程颜色由稳定 hash 决定，同一课程永远同色',()=>{
  const a={id:'course-a',title:'Computer Vision',person:'partner'};
  const b={id:'course-b',title:'Computer Vision',person:'partner'};
  const first=courseTone(a);
  assert.ok(courseTones.includes(first as typeof courseTones[number]));
  assert.equal(courseTone(a),first,'同一课程重复取色必须一致');
  assert.equal(courseTone({...a,title:'改名后的课程'}),first,'改名不影响身份色');
  assert.equal(courseTone({...a,id:'course-a'}),first,'调课/停课不改 id 时颜色不变');
  // 取色与调用顺序无关：打乱顺序逐个取色结果相同。
  const ids=['c1','c2','c3','c4','c5','c6','c7','c8'];
  const forward=ids.map(id=>courseTone({id}));
  const backward=[...ids].reverse().map(id=>courseTone({id})).reverse();
  assert.deepEqual(forward,backward);
  assert.ok(new Set(ids.map(id=>courseTone({id}))).size>=2,'多门课程不应该全部落到同一种颜色');
  // 没有 id 的临时对象退回 person+title，仍然稳定。
  assert.equal(courseTone({title:'临时课程',person:'me'}),courseTone({title:'临时课程',person:'me'}));
  assert.notEqual(courseTone({id:'course-a',title:'Computer Vision',person:'partner'}),undefined);
});

test('0.2.16 拖动坐标决策：指针与光标一致时按指针，不一致时改用系统光标',()=>{
  const anchor=(patch:Partial<DragAnchor>={}):DragAnchor=>({windowX:600,windowY:400,pointerX:640,pointerY:440,cursorX:640,cursorY:440,cursorMode:false,width:170,height:272,...patch});
  // 1) 真实拖动：指针与系统光标一起走同样的量，按指针计算。
  const normal=resolveDragStep(anchor(),{x:660,y:410},{x:660,y:410});
  assert.deepEqual(normal,{cursorMode:false,delta:{x:20,y:-30},adoptedCursor:false});
  // 2) 150% 缩放下映射不一致：系统光标走了 120/-30 DIP，指针只走了 60/-15 → 用光标。
  const dpi=resolveDragStep(anchor(),{x:700,y:425},{x:760,y:410});
  assert.equal(dpi.cursorMode,true);
  assert.equal(dpi.adoptedCursor,true);
  assert.deepEqual(dpi.delta,{x:120,y:-30});
  // 3) 光标因抖动只动了 2px：仍然按指针，不误判成坐标不一致。
  const jitter=resolveDragStep(anchor({pointerX:640,pointerY:440}),{x:645,y:440},{x:642,y:440});
  assert.equal(jitter.cursorMode,false);
  assert.deepEqual(jitter.delta,{x:5,y:0});
  // 4) 进入光标模式后一直跟随系统光标，即使指针事件原地不动。
  const following=resolveDragStep(anchor({cursorMode:true}),{x:640,y:440},{x:700,y:430});
  assert.equal(following.cursorMode,true);
  assert.equal(following.adoptedCursor,false);
  assert.deepEqual(following.delta,{x:60,y:-10});
  // 5) 拖回原点：位移归零，窗口回到起始位置。
  const back=resolveDragStep(anchor({cursorMode:true}),{x:640,y:440},{x:640,y:440});
  assert.deepEqual(back.delta,{x:0,y:0});
});
