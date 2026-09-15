// Phase 5B2 · 「设置 → 角色与陪伴」里的使用方式与档案。
//
// 这一层只做两件事，而且都只是**发起命令**：
//   * 使用方式：Solo ↔ Together（可逆；切换不会删除任何 companion 数据）；
//   * 档案：编辑本人的 / 同行者的 name 与 shortAlias（PersonId 与 role 不可编辑）。
//
// 展示纪律（AGENTS.md 的 Information Density）：
//   * 一行只回答一个问题：这一行是谁、当前处于什么状态、能编辑什么；
//   * 不写"切换不会删除数据、以后还能……"这类永久说明，用一次性反馈与短对话框表达；
//   * Solo 下保留的 companion 必须一眼看出"当前未参与"，不能看起来仍在当前体验里。
import React,{useState} from 'react';
import type { PersonId, Profile, State } from '../types.ts';
import { activeCompanionProfile, getCompanionProfile, requireSelfProfile, usageModeOf, type UsageMode } from '../people.ts';
import { companionDisplayName } from './shell.ts';

const h=React.createElement,api=window.dayhub;
const errorText=(e:unknown)=>e instanceof Error?e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/,''):String(e);
type Command=Parameters<typeof api.change>[0];

const USAGE_MODE_OPTIONS:[UsageMode,string,string][]=[
  ['solo','只为自己','只使用本人的安排与状态'],
  ['together','我和另一位','同时使用本人与陪伴对象的安排与状态'],
];

export function ProfileLifecycleSettings({state}:{state:State}){
  const mode=usageModeOf(state);
  const self=requireSelfProfile(state);
  const companion=getCompanionProfile(state);
  const active=activeCompanionProfile(state);
  const petEnabled=state.settings.petEnabled!==false;
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [feedback,setFeedback]=useState('');
  const [creating,setCreating]=useState(false);
  const [restoring,setRestoring]=useState(false);
  const [editing,setEditing]=useState<PersonId|null>(null);
  const [draftName,setDraftName]=useState('');
  const [draftSubject,setDraftSubject]=useState<'self'|'companion'>('companion');

  const clear=()=>{setError('');setFeedback('');};
  // 所有写入都走同一条命令链（api.change → core.apply → validate → Store），
  // 失败只把说明交回界面，绝不静默吞掉。
  const run=async(command:Command,message:string)=>{
    setBusy(true);setError('');
    try{await api.change(command);setCreating(false);setRestoring(false);setEditing(null);setFeedback(message);return true;}
    catch(e){setError(errorText(e));return false;}
    finally{setBusy(false);}
  };
  const choose=(value:UsageMode)=>{
    clear();
    if(value===mode)return;
    if(value==='solo'){
      // Together → Solo：可逆的运行方式切换，不删除任何资料，因此不需要危险确认。
      void run({type:'usageMode',mode:'solo'},'已切换为只为自己 · 对方的资料保留，可随时恢复');
      return;
    }
    if(companion){setRestoring(true);return;}
    // 第一次进入双人模式才需要填写称呼；桌宠开着时顺便确认桌宠表示谁。
    setDraftName('');
    setDraftSubject('companion');
    setCreating(true);
  };
  const editable=editing?state.profiles.find(profile=>profile.id===editing):undefined;
  const shown=creating||restoring||editing?error:'';

  const row=(profile:Profile,label:string,note:string|undefined)=>{
    const identity=profile.id===self.id?'self':active?'active':'retained';
    return h('div',{className:'setting-row',key:profile.id,'data-profile-row':profile.id,'data-profile-state':identity},
      h('div',{className:'setting-row-copy'},h('strong',null,label),note?h('small',null,note):null),
      h('div',{className:'setting-row-control'},
        h('button',{type:'button',className:'ghost','data-profile-edit':profile.id,disabled:busy,onClick:()=>{clear();setEditing(profile.id);}},'编辑')));
  };

  return h('section',{className:'profile-lifecycle'},
    h('div',{className:'setting-block'},
      h('h3',null,'使用方式'),
      h('div',{className:'choice-chips','data-usage-mode':'true',role:'radiogroup','aria-label':'使用方式'},
        ...USAGE_MODE_OPTIONS.map(([value,label,note])=>h('button',{
          key:value,type:'button',role:'radio','aria-checked':mode===value,'data-usage-mode-option':value,
          className:mode===value?'choice-chip active':'choice-chip',title:note,disabled:busy,
          onClick:()=>choose(value),
        },label))),
      feedback?h('p',{className:'muted setting-note','data-usage-feedback':'true',role:'status'},feedback):null,
      !creating&&!restoring&&!editing&&error?h('p',{className:'error','data-usage-error':'true',role:'alert'},error):null),
    h('div',{className:'setting-block'},
      h('h3',null,'档案'),
      row(self,'我的资料',undefined),
      // 保留的 companion 照常可编辑，但必须一眼看出它当前没有参与体验。
      companion?row(companion,active?`${companionDisplayName(companion)}的资料`:`已保留的 ${companionDisplayName(companion)}`,active?undefined:'当前未参与，资料已保留'):null),
    creating?h('div',{className:'modal-backdrop'},h('section',{className:'modal small',role:'dialog','aria-modal':true,'aria-label':'开始双人模式','data-usage-dialog':'create'},
      h('div',{className:'modal-head'},h('h2',null,'怎么称呼 TA？')),
      h('label',{className:'field'},h('span',null,'称呼'),
        h('input',{type:'text',maxLength:40,'aria-label':'TA 的称呼','data-usage-companion-name':'true',value:draftName,onChange:(e:React.ChangeEvent<HTMLInputElement>)=>{setDraftName(e.target.value);setError('');}})),
      // 桌宠开着时才问"桌宠表示"：没开桌宠的人现在不需要回答这个问题。
      petEnabled?h('div',{className:'field full'},h('span',null,'桌宠表示'),
        h('div',{className:'choice-chips','data-usage-subject':'true',role:'radiogroup','aria-label':'桌宠表示'},
          ...([['self','我'],['companion','TA']] as const).map(([value,label])=>h('button',{
            key:value,type:'button',role:'radio','aria-checked':draftSubject===value,'data-usage-subject-option':value,
            className:draftSubject===value?'choice-chip active':'choice-chip',disabled:busy,
            onClick:()=>setDraftSubject(value),
          },label)))):null,
      shown?h('p',{className:'error','data-usage-error':'true',role:'alert'},shown):null,
      h('div',{className:'modal-foot'},
        h('button',{type:'button',className:'ghost','data-usage-dialog-cancel':'true',disabled:busy,onClick:()=>{setCreating(false);clear();}},'取消'),
        h('button',{type:'button',className:'primary','data-usage-create-confirm':'true',disabled:busy,
          onClick:()=>void run({type:'usageMode',mode:'together',companionName:draftName,...(petEnabled?{petSubjectRole:draftSubject}:{})},'已开始双人模式')},'开始双人模式')))):null,
    restoring&&companion?h('div',{className:'modal-backdrop'},h('section',{className:'modal small',role:'dialog','aria-modal':true,'aria-label':'恢复双人模式','data-usage-dialog':'restore'},
      h('div',{className:'modal-head'},h('h2',null,`恢复与 ${companionDisplayName(companion)} 的双人模式？`)),
      shown?h('p',{className:'error','data-usage-error':'true',role:'alert'},shown):null,
      h('div',{className:'modal-foot'},
        h('button',{type:'button',className:'ghost','data-usage-dialog-cancel':'true',disabled:busy,onClick:()=>{setRestoring(false);clear();}},'取消'),
        h('button',{type:'button',className:'primary','data-usage-restore-confirm':'true',disabled:busy,
          onClick:()=>void run({type:'usageMode',mode:'together'},'已恢复双人模式')},'恢复')))):null,
    editable?h(ProfileIdentityDialog,{key:editable.id,profile:editable,isSelf:editable.id===self.id,busy,error:shown,close:()=>{setEditing(null);clear();},submit:(command:Command,message:string)=>void run(command,message)}):null);
}

/**
 * 档案编辑：只有称呼与桌面短代号。
 * PersonId / role / Avatar / 作息 / 学期与节次都不在这里出现 —— 它们各有各的正式入口。
 */
function ProfileIdentityDialog({profile,isSelf,busy,error,close,submit}:{profile:Profile;isSelf:boolean;busy:boolean;error:string;close:()=>void;submit:(command:Command,message:string)=>void}){
  const [name,setName]=useState(profile.name);
  const [alias,setAlias]=useState(profile.shortAlias??'');
  const label=isSelf?'你的资料':'TA 的资料';
  return h('div',{className:'modal-backdrop'},h('section',{className:'modal small',role:'dialog','aria-modal':true,'aria-label':label,'data-profile-edit-dialog':profile.id},
    h('div',{className:'modal-head'},h('h2',null,label)),
    h('label',{className:'field'},h('span',null,'称呼'),
      h('input',{type:'text',maxLength:40,'aria-label':'称呼','data-profile-name-input':'true',value:name,onChange:(e:React.ChangeEvent<HTMLInputElement>)=>setName(e.target.value)})),
    h('label',{className:'field'},h('span',null,'桌面短代号'),
      // 留空 = 用派生规则（小宇 → 宇），不写死一个新值；填了就用用户自己的（1—8 字）。
      h('input',{type:'text',maxLength:8,'aria-label':'桌面短代号','data-profile-alias-input':'true',value:alias,placeholder:'留空则按称呼派生',onChange:(e:React.ChangeEvent<HTMLInputElement>)=>setAlias(e.target.value)})),
    error?h('p',{className:'error','data-profile-error':'true',role:'alert'},error):null,
    h('div',{className:'modal-foot'},
      h('button',{type:'button',className:'ghost','data-profile-cancel':'true',disabled:busy,onClick:close},'取消'),
      h('button',{type:'button',className:'primary','data-profile-save':'true',disabled:busy,
        onClick:()=>submit({type:'profileIdentity',personId:profile.id,name,shortAlias:alias},'资料已保存')},'保存'))));
}
