// Phase 5B1 · 首次使用 onboarding（应用生命周期 UI）。
//
// 只在 `settings.setup === false` 时出现，最多三步：关于你 / 使用方式 / 桌宠形象。
// 它**不是**第二套初始化逻辑，也不产生任何新状态语义：
//
//   * 谁是本人、谁是同行者仍然只由 Profile.role 决定（people.ts）；
//   * 人物此刻在做什么仍然只由 StateEngine 决定，onboarding 不新增 CurrentState；
//   * 用户输入的名字 / 使用方式 / Avatar 都是本地 draft，只有点「开始使用 YD」
//     才通过一条 completeSetup 命令写入（见 src/setup.ts）；
//   * Avatar 卡片复用 Phase 4 的 AvatarPackCard + Avatar Registry，列表来自
//     listAvatarPacks()，不写死 Pack 名单。
import React, { useEffect, useRef, useState } from 'react';
import { DEFAULT_AVATAR_PACK_ID, getAvatarPack, listAvatarPacks, type AvatarPackId } from '../avatar.ts';
import { NEUTRAL_SELF_NAME } from '../core.ts';
import { getCompanionProfile, requireSelfProfile } from '../people.ts';
import { SETUP_NAME_LIMIT, setupNameProblem, type SetupInput, type SetupMode } from '../setup.ts';
import type { State } from '../types.ts';
import { AvatarPackCard } from './companion.ts';

const h=(type:any,props:any,...children:any[]):React.ReactElement=>React.createElement(type,props,...children);

type SetupStep='name'|'mode'|'avatar';

// 使用方式文案：给用户看的是"只为自己 / 我和另一位"，
// Solo / Together / companion 这些领域词不出现在界面上。
const MODE_OPTIONS=[
  {value:'solo',title:'只为自己',detail:'专注管理自己的安排、状态和桌宠'},
  {value:'together',title:'我和另一位',detail:'同时管理双方的安排，并用桌宠查看 TA 的状态'},
] as const satisfies readonly {value:SetupMode;title:string;detail:string}[];

/** 已注册的 Pack 才作为 draft 初值；不可用时也只是回到默认，不替用户改写数据。 */
function registeredPack(id:string|undefined):AvatarPackId {
  return getAvatarPack(id??'')?.id??DEFAULT_AVATAR_PACK_ID;
}

export function OnboardingPanel({state,pending,submit}:{state:State;pending:boolean;submit:(input:SetupInput)=>Promise<string>}){
  const self=requireSelfProfile(state),companion=getCompanionProfile(state),packs=listAvatarPacks();
  // 已经有陪伴对象的工作区不再问"独自 / 双人"：移除陪伴对象是 Profile 生命周期
  // （Phase 5B2），这里不创造、也不删除任何档案。
  const steps:SetupStep[]=companion?['name','avatar']:['name','mode','avatar'];
  const [step,setStep]=useState(0);
  // —— draft：全部只活在这个组件里 ——
  // 中性占位名（「我」）不算用户已经选过名字，因此留空让用户自己填。
  const [selfName,setSelfName]=useState(()=>self.name.trim()===NEUTRAL_SELF_NAME?'':self.name);
  const [mode,setMode]=useState<SetupMode>('solo');
  const [companionName,setCompanionName]=useState('');
  const [selfPack,setSelfPack]=useState(()=>registeredPack(self.avatar?.packId));
  const [companionPack,setCompanionPack]=useState(()=>registeredPack(companion?.avatar?.packId));
  const [selfPicked,setSelfPicked]=useState(false);
  const [companionPicked,setCompanionPicked]=useState(false);
  const [touched,setTouched]=useState(false);
  const [hint,setHint]=useState('');
  const panel=useRef<HTMLElement|null>(null);

  const current=steps[Math.min(step,steps.length-1)];
  const wantsCompanion=!companion&&mode==='together';
  const selfProblem=setupNameProblem(selfName,'称呼');
  const companionProblem=wantsCompanion?setupNameProblem(companionName,'TA 的称呼'):'';
  const stepProblem=current==='name'?selfProblem:current==='mode'?companionProblem:'';
  const valid=!stepProblem;
  const last=step===steps.length-1;

  // 换步时把焦点交给面板本身：Tab 从这一步的第一个控件开始，焦点也不会留在上一步。
  useEffect(()=>{
    if(step>0)panel.current?.focus();
  },[step]);

  // 轻量焦点陷阱：onboarding 期间背景是只读的，Tab 不能跑进设置页 / 侧栏。
  function keepFocusInside(event:React.KeyboardEvent){
    if(event.key!=='Tab')return;
    const root=panel.current;
    if(!root)return;
    const focusable=Array.from(root.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])'));
    if(!focusable.length)return;
    const first=focusable[0],lastItem=focusable[focusable.length-1],active=document.activeElement as HTMLElement|null;
    if(event.shiftKey&&(active===first||!active||!root.contains(active))){event.preventDefault();lastItem.focus();}
    else if(!event.shiftKey&&active===lastItem){event.preventDefault();first.focus();}
  }

  function advance(){
    if(!last){
      if(!valid){setTouched(true);setHint(stepProblem);return;}
      setHint('');setStep(index=>index+1);
    }
  }
  async function finish(){
    if(!valid){setTouched(true);setHint(stepProblem);return;}
    const input:SetupInput={selfName:selfName.trim(),mode:companion?'together':mode};
    // 只有用户真的选过才提交 Avatar：没动过的默认卡片不会被记成"用户选择"。
    if(selfPicked)input.selfAvatarPackId=selfPack;
    if(wantsCompanion)input.companion={name:companionName.trim(),...(companionPicked?{avatarPackId:companionPack}:{})};
    const problem=await submit(input);
    if(problem)setHint(problem);
  }
  function submitStep(event:React.FormEvent){
    event.preventDefault();
    if(last)void finish();else advance();
  }

  const nameField=(value:string,set:(next:string)=>void,dataName:string,label:string)=>{
    return h('label',{className:'field setup-field'},
      h('span',null,label),
      h('input',{type:'text',value,'data-setup-name-input':dataName,maxLength:SETUP_NAME_LIMIT,autoComplete:'off',autoFocus:current==='name'&&dataName==='self',
        placeholder:'例如：小宇',onChange:(e:any)=>{set(e.target.value);setTouched(true);setHint('');}}));
  };
  const packGrid=(person:'self'|'companion',value:AvatarPackId,set:(next:AvatarPackId)=>void,label:string)=>{
    return h('div',{className:'setup-avatar-group','data-setup-avatar-person':person},
      h('h3',{className:'setup-avatar-title'},label),
      h('div',{className:'avatar-pack-grid setup-avatar-grid'},...packs.map(pack=>h(AvatarPackCard,{key:pack.id,pack,active:pack.id===value,selected:pack.id===value,busy:pending,selectedLabel:'已选择',idleLabel:'选择',onPreview:()=>{set(pack.id);(person==='self'?setSelfPicked:setCompanionPicked)(true);setHint('');}}))));
  };
  const liveProblem=current==='name'?selfProblem:current==='mode'?companionProblem:'';
  const shownHint=hint||(touched?liveProblem:'');

  return h('div',{className:'setup-gate'},
    h('section',{className:'setup-panel',role:'dialog','aria-modal':'true','aria-labelledby':'setup-title','data-setup-panel':'true','data-setup-step':current,ref:panel,tabIndex:-1,onKeyDown:keepFocusInside},
      h('header',{className:'setup-head'},
        h('span',{className:'setup-progress','data-setup-progress':`${step+1}/${steps.length}`},`${step+1} / ${steps.length}`),
        h('h2',{id:'setup-title'},current==='name'?'关于你':current==='mode'?'使用方式':'桌宠形象'),
        h('p',{className:'setup-lede'},current==='name'?'希望 YD 怎么称呼你？':current==='mode'?'选择你现在需要的使用方式，之后可以再改。':'选择你的桌宠，稍后可以在设置中修改。')),
      h('form',{className:'setup-form',onSubmit:submitStep},
        current==='name'?h(React.Fragment,null,
          nameField(selfName,setSelfName,'self','怎么称呼你？'),
          h('p',{className:'setup-note'},'这些信息只保存在这台设备。')):null,
        current==='mode'?h(React.Fragment,null,
          h('div',{className:'setup-modes',role:'radiogroup','aria-label':'使用方式'},
            ...MODE_OPTIONS.map(option=>h('button',{key:option.value,type:'button',role:'radio','aria-checked':mode===option.value,'data-setup-mode-option':option.value,className:mode===option.value?'setup-mode active':'setup-mode',onClick:()=>{setMode(option.value);setHint('');}},
              h('strong',null,option.title),h('small',null,option.detail)))),
          wantsCompanion?nameField(companionName,setCompanionName,'companion','怎么称呼 TA？'):null,
          h('p',{className:'setup-note'},'不需要账号，也不需要联网。')):null,
        current==='avatar'?h(React.Fragment,null,
          packGrid('self',selfPack,setSelfPack,'我的桌宠'),
          wantsCompanion?packGrid('companion',companionPack,setCompanionPack,'TA 的桌宠'):null,
          // 已经有陪伴对象时只设置本人的形象：TA 的选择继续由设置页维护（Phase 5B1 不重命名 / 不重建档案）。
          companion&&!wantsCompanion?h('p',{className:'setup-note'},'TA 的桌宠可以在设置里单独修改。'):null):null,
        shownHint?h('p',{className:'setup-hint',role:'alert','data-setup-hint':'true'},shownHint):null,
        h('div',{className:'setup-actions'},
          // 次要动作在前、主 CTA 在后并靠右：与设置页 / 其它对话框的按钮顺序一致。
          step>0?h('button',{type:'button',className:'ghost','data-setup-back':'true',disabled:pending,onClick:()=>setStep(index=>index-1)},'上一步'):null,
          h('button',{type:'submit',className:'primary','data-setup-complete':last?'true':undefined,'data-setup-next':last?undefined:'true',disabled:pending},last?(pending?'正在完成…':'开始使用 YD'):'继续')))));
}
