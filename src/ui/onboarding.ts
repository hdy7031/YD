// Phase 5B1 · 首次使用 onboarding（应用生命周期 UI）。
//
// 只在 `settings.setup === false` 时出现，最多四步（按条件跳过）：
// 关于你 → 使用方式 → 桌面陪伴 → 桌宠形象与日常节奏。
// 它**不是**第二套初始化逻辑，也不产生任何新状态语义：
//
//   * 谁是本人、谁是同行者仍然只由 Profile.role 决定（people.ts）；
//   * 人物此刻在做什么仍然只由 StateEngine 决定，onboarding 不新增 CurrentState；
//   * 桌面桌宠是**可选能力**：选「暂时不用」就跳过形象 / 主体 / 节奏引导，
//     YD Core 照常完整可用（petEnabled=false）；
//   * 用户输入的名字 / 使用方式 / Avatar / 桌宠主体都是本地 draft，只有最后一步
//     才通过一条 completeSetup 命令写入（见 src/setup.ts）；
//   * Avatar 卡片复用 Phase 4 的 AvatarPackCard + Avatar Registry，列表来自
//     listAvatarPacks()，不写死 Pack 名单；
//   * Person / Avatar / 桌宠主体三层严格分开：形象永远属于某个人，桌宠只是
//     "消费谁的 CurrentState + 谁的 Avatar"（resolvePetSubject / PetInstance）。
import React, { useEffect, useRef, useState } from 'react';
import { DEFAULT_AVATAR_PACK_ID, getAvatarPack, listAvatarPacks, type AvatarPackId } from '../avatar.ts';
import { NEUTRAL_SELF_NAME } from '../core.ts';
import { getCompanionProfile, petSubjectRoleOf, requireSelfProfile, type PetSubjectRole } from '../people.ts';
import { SETUP_NAME_LIMIT, setupNameProblem, type SetupInput, type SetupMode } from '../setup.ts';
import type { State } from '../types.ts';
import { AvatarPackCard } from './companion.ts';

const h=(type:any,props:any,...children:any[]):React.ReactElement=>React.createElement(type,props,...children);

export type SetupStep='name'|'mode'|'pet'|'pet-setup';

/** 桌面陪伴：默认「暂时不用」——低打扰，且用户显式选择后才出现桌面悬浮物。 */
type PetChoice='on'|'off';
const PET_OPTIONS=[
  {value:'on',title:'使用桌宠',detail:'在桌面上安静地显示状态，随时可以在设置里关闭'},
  {value:'off',title:'暂时不用',detail:'YD 的课表、待办、提醒与状态照常可用'},
] as const satisfies readonly {value:PetChoice;title:string;detail:string}[];

/** 完成 onboarding 之后的落点：直接进 Home，或按用户选择去设置该人的日常节奏。 */
export type SetupIntent='home'|'routine';

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

export function OnboardingPanel({state,pending,submit}:{state:State;pending:boolean;submit:(input:SetupInput,intent:SetupIntent)=>Promise<string>}){
  const self=requireSelfProfile(state),companion=getCompanionProfile(state),packs=listAvatarPacks();
  // 已经有陪伴对象的工作区不再问"独自 / 双人"：移除陪伴对象是 Profile 生命周期
  // （Phase 5B2），这里不创造、也不删除任何档案。
  const [step,setStep]=useState(0);
  // —— draft：全部只活在这个组件里 ——
  // 中性占位名（「我」）不算用户已经选过名字，因此留空让用户自己填。
  const [selfName,setSelfName]=useState(()=>self.name.trim()===NEUTRAL_SELF_NAME?'':self.name);
  const [mode,setMode]=useState<SetupMode>('solo');
  // 桌面桌宠：默认"暂时不用"（用户显式选择之后才创建桌面悬浮物）。
  const [petChoice,setPetChoice]=useState<PetChoice>('off');
  const [companionName,setCompanionName]=useState('');
  const [selfPack,setSelfPack]=useState(()=>registeredPack(self.avatar?.packId));
  const [companionPack,setCompanionPack]=useState(()=>registeredPack(companion?.avatar?.packId));
  // 桌宠主体：已经有陪伴对象时沿用库里迁移后的偏好（不替老用户改桌面行为）；
  // 这次才选择双人时按产品默认取 TA —— Together 的特色价值是低打扰查看另一位状态，
  // 但用户随时可以选回「我」。
  const [subject,setSubject]=useState<PetSubjectRole>(()=>companion?petSubjectRoleOf(state):'companion');
  // 步骤按条件动态生成：不用桌宠就跳过形象 / 主体 / 节奏引导（最多四步）。
  const steps:SetupStep[]=companion
    ? (petChoice==='on'?['name','pet','pet-setup']:['name','pet'])
    : (petChoice==='on'?['name','mode','pet','pet-setup']:['name','mode','pet']);
  const [selfPicked,setSelfPicked]=useState(false);
  const [companionPicked,setCompanionPicked]=useState(false);
  const [touched,setTouched]=useState(false);
  const [hint,setHint]=useState('');
  const panel=useRef<HTMLElement|null>(null);

  const current=steps[Math.min(step,steps.length-1)];
  const wantsCompanion=!companion&&mode==='together';
  // 这次设置之后是不是"双人工作区"：决定第三步显示一个还是两个形象区。
  const together=!!companion||mode==='together';
  const companionLabel=(companionName.trim()||companion?.name?.trim()||'TA');
  const selfLabel='你';
  const selfProblem=setupNameProblem(selfName,'称呼');
  const companionProblem=wantsCompanion?setupNameProblem(companionName,'TA 的称呼'):'';
  const stepProblem=current==='name'?selfProblem:current==='mode'?companionProblem:'';
  const valid=!stepProblem;
  const last=step===steps.length-1;
  // 主体最终写进 State 的值：Solo 恒为本人（领域层也会再强制一次）。
  const submittedSubject:PetSubjectRole=together?subject:'self';
  const routineTitle=submittedSubject==='self'?'让你的状态更准确':`让 ${companionLabel} 的状态更准确`;
  const rhythmNote=submittedSubject==='self'
    ?'现在可以补充你的睡眠、起床、吃饭等日常节奏；不设置也不影响使用。'
    :`现在可以补充 ${companionLabel} 的睡眠、起床、吃饭等日常节奏；不设置也不影响使用。`;
  const rhythmAction=submittedSubject==='self'?'现在设置日常节奏':`现在设置 ${companionLabel} 的日常节奏`;
  const stepTitle=current==='name'?'关于你':current==='mode'?'使用方式':current==='pet'?'桌面陪伴':routineTitle;
  const stepLede=current==='name'?'希望 YD 怎么称呼你？'
    :current==='mode'?'选择你现在需要的使用方式，之后可以再改。'
    :current==='pet'?'YD 可以用一个小桌宠，在桌面上安静地展示状态。'
    :(together?'先给两个人各自选一个形象，再决定桌面上显示谁。':'选择你的桌宠形象，之后可以在设置中修改。');

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
  async function finish(intent:SetupIntent){
    if(!valid){setTouched(true);setHint(stepProblem);return;}
    const petEnabled=petChoice==='on';
    const input:SetupInput={
      selfName:selfName.trim(),
      mode:companion?'together':mode,
      petEnabled,
      // 不用桌宠时主体不是用户输入：留给领域层按默认值落盘（Solo 恒为本人）。
      ...(petEnabled?{petSubjectRole:submittedSubject}:{}),
    };
    // 只有用户真的选过才提交 Avatar：没动过的默认卡片不会被记成"用户选择"。
    if(petEnabled&&selfPicked)input.selfAvatarPackId=selfPack;
    if(wantsCompanion)input.companion={name:companionName.trim(),...(petEnabled&&companionPicked?{avatarPackId:companionPack}:{})};
    const problem=await submit(input,intent);
    if(problem)setHint(problem);
  }
  function submitStep(event:React.FormEvent){
    event.preventDefault();
    // 最后一步（在用桌宠时）提供两个动作：去设置日常节奏，或直接开始使用。
    if(current==='pet-setup')void finish('routine');
    else if(last)void finish('home');
    else advance();
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
  // 桌面桌宠代表谁：只有 Together 才有意义（Solo 没有歧义，因此完全不显示这一块）。
  const subjectChooser=()=>h('div',{className:'setup-avatar-group setup-subject','data-setup-subject':'true'},
    h('h3',{className:'setup-avatar-title'},'桌面桌宠代表谁'),
    h('div',{className:'setup-modes',role:'radiogroup','aria-label':'桌面桌宠代表谁'},
      ...([['self','我','桌宠显示你的状态'],['companion',companionLabel,`桌宠显示 ${companionLabel} 的状态`]] as const).map(([value,title,detail])=>h('button',{
        key:value,type:'button',role:'radio','aria-checked':subject===value,'data-setup-subject-option':value,
        className:subject===value?'setup-mode active':'setup-mode',
        onClick:()=>{setSubject(value);setHint('');}},
        h('strong',null,title),h('small',null,detail)))),
    h('p',{className:'setup-note'},'桌宠会使用这个人的形象，并跟随这个人的状态变化。'));
  const routineActions=(nowLabel:string)=>[
    h('button',{type:'button',key:'later',className:'ghost','data-setup-routine-later':'true',disabled:pending,onClick:()=>void finish('home')},'稍后再说'),
    h('button',{type:'submit',key:'now',className:'primary','data-setup-complete':'true','data-setup-routine-now':'true',disabled:pending},pending?'正在完成…':nowLabel),
  ];
  const liveProblem=current==='name'?selfProblem:current==='mode'?companionProblem:'';
  const shownHint=hint||(touched?liveProblem:'');

  return h('div',{className:'setup-gate'},
    h('section',{className:'setup-panel',role:'dialog','aria-modal':'true','aria-labelledby':'setup-title','data-setup-panel':'true','data-setup-step':current,ref:panel,tabIndex:-1,onKeyDown:keepFocusInside},
      h('header',{className:'setup-head'},
        h('span',{className:'setup-progress','data-setup-progress':`${step+1}/${steps.length}`},`${step+1} / ${steps.length}`),
        h('h2',{id:'setup-title'},stepTitle),
        h('p',{className:'setup-lede'},stepLede)),
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
        // 桌面陪伴：可选能力。默认「暂时不用」，不选就不会有桌面悬浮物。
        current==='pet'?h(React.Fragment,null,
          h('div',{className:'setup-modes',role:'radiogroup','aria-label':'桌面陪伴'},
            ...PET_OPTIONS.map(option=>h('button',{key:option.value,type:'button',role:'radio','aria-checked':petChoice===option.value,'data-setup-pet-option':option.value,className:petChoice===option.value?'setup-mode active':'setup-mode',onClick:()=>{setPetChoice(option.value);setHint('');}},
              h('strong',null,option.title),h('small',null,option.detail)))),
          h('p',{className:'setup-note'},'桌面桌宠随时可以在「设置 → 桌面陪伴」里开关。')):null,
        // 最后一步：形象 + 主体 + 日常节奏引导（不复制 Routine 编辑器，也不 seed 作息）。
        current==='pet-setup'?h(React.Fragment,null,
          // Solo：只有一个形象区，不出现"桌宠代表谁"（没有第二种可能）。
          packGrid('self',selfPack,setSelfPack,'你的桌宠形象'),
          together?packGrid('companion',companionPack,setCompanionPack,`${companionLabel}的桌宠形象`):null,
          together?subjectChooser():null,
          // 已经有陪伴对象时只设置本人的形象：TA 的选择继续由设置页维护（Phase 5B1 不重命名 / 不重建档案）。
          companion?h('p',{className:'setup-note'},`${companionLabel}的形象也可以在设置里单独修改。`):null,
          h('hr',{className:'setup-divider'}),h('h3',{className:'setup-avatar-title'},routineTitle),
          h('p',{className:'setup-note'},rhythmNote),
          h('p',{className:'setup-note'},'这些节奏只保存在这台设备，随时可以修改。')):null,
        shownHint?h('p',{className:'setup-hint',role:'alert','data-setup-hint':'true'},shownHint):null,
        h('div',{className:'setup-actions'},
          // 次要动作在前、主 CTA 在后并靠右：与设置页 / 其它对话框的按钮顺序一致。
          step>0?h('button',{type:'button',className:'ghost','data-setup-back':'true',disabled:pending,onClick:()=>setStep(index=>index-1)},'上一步'):null,
          current==='pet-setup'
            ?h(React.Fragment,null,...routineActions(rhythmAction))
            :h('button',{type:'submit',className:'primary','data-setup-next':'true','data-setup-complete':last?'true':undefined,disabled:pending},last?(pending?'正在完成…':'开始使用 YD'):'继续')))));
}
