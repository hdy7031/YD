// Custom companion renderer: frame resolution, crossfade and the light motion
// layer. No business judgement happens here — the frame comes straight from the
// companion display projection the main process already resolved.
import React,{useEffect,useRef,useState} from 'react';
import { companionRailLabel, type CompanionDisplay } from '../companion-display.ts';
import { companionTone } from '../companion-colors.ts';
import { resolveCompanionFrame, type CompanionAssets, type ResolvedCompanionFrame } from '../companion-frame.ts';
import { presenceStateFor, type LiveSnapshot } from '../live.ts';
const h=React.createElement;
const api=()=>window.dayhub;

// Assets are fetched for the current PetInstance Pack and reused for every
// display-state switch. A later selection change naturally requests its Pack.
const decode=(url:string)=>new Promise<void>(resolve=>{
  const image=new Image();
  image.onload=()=>resolve();
  image.onerror=()=>resolve();
  image.src=url;
});
export function useCompanionAssets(packId?:string):CompanionAssets|null{
  const [assets,set]=useState<CompanionAssets|null>(null);
  const request=useRef(0);
  useEffect(()=>{
    let active=true;const token=++request.current;
    // 同一个 packId 只在 effect 建立时读取；状态切换不会重复搬运整包图片。
    // 收到后先把全部 Pack 帧解码完成再交给界面：状态切换是纯内存切换，
    // 不会出现“先显示破图，再补上真图”的闪动。
    void api().companionAssets(packId).then(async value=>{
      if(value?.available)await Promise.all([...new Set(Object.values(value.packs).flatMap(pack=>Object.values(pack.images)))].map(decode));
      if(active&&token===request.current)set(value);
    }).catch(()=>{if(active&&token===request.current)set(null);});
    return()=>{active=false;};
  },[packId]);
  return assets;
}

export function companionImage(assets:CompanionAssets|null,display?:CompanionDisplay):ResolvedCompanionFrame|undefined{
  return display?resolveCompanionFrame(assets,display.state):undefined;
}

interface Layer extends ResolvedCompanionFrame { key:number }

// Two stacked layers: the outgoing frame fades out while the incoming frame
// fades in over ~150ms. The old layer is dropped afterwards, so repeated state
// changes cannot leave residue or blur. While the window is being dragged the
// swap is postponed: the pointer interaction always outranks the clock, so a
// pose change can never appear under the cursor mid-drag.
export function useCrossfade(frame:ResolvedCompanionFrame|undefined,duration:number,frozen=false){
  const [layers,setLayers]=useState<Layer[]>([]);
  const applied=useRef<string|undefined>(undefined);
  const counter=useRef(0);
  const signature=frame?`${frame.resolvedPackId}:${frame.resolvedState}:${frame.asset}:${frame.geometry.scale}:${frame.geometry.offsetX}:${frame.geometry.offsetY}:${frame.url}`:undefined;
  useEffect(()=>{
    if(!frame){setLayers([]);applied.current=undefined;return;}
    if(frozen)return;
    if(applied.current===signature)return;
    applied.current=signature;
    counter.current+=1;
    const layer:Layer={...frame,key:counter.current};
    setLayers(previous=>[...previous.slice(-1),layer]);
  },[signature,frozen]);
  useEffect(()=>{
    if(layers.length<2)return;
    const timer=window.setTimeout(()=>setLayers(previous=>previous.slice(-1)),duration);
    return()=>window.clearTimeout(timer);
  },[layers,duration]);
  return layers;
}

interface ArtProps {
  assets:CompanionAssets|null;
  display?:CompanionDisplay;
  animate:boolean;
  reduceMotion:boolean;
  frozen?:boolean;
}

// 同一个 stage 里只换帧、不换舞台：每帧按 Avatar Pack 自己的 geometry
// 摆放（底边中点锚点 + 每个姿态允许的少量偏移），
// 因此换动作时人物的桌面落点基本不动。
export function CustomCompanionArt({assets,display,animate,reduceMotion,frozen=false}:ArtProps){
  const frame=companionImage(assets,display);
  const motion=animate&&!reduceMotion;
  const layers=useCrossfade(frame,motion?150:0,frozen);
  const [nudging,setNudging]=useState(false);
  const nudgeId=display?.nudgeId??0;
  const seen=useRef(nudgeId);
  useEffect(()=>{
    if(nudgeId===seen.current)return;
    seen.current=nudgeId;
    if(!motion)return;
    setNudging(true);
    const timer=window.setTimeout(()=>setNudging(false),1500);
    return()=>window.clearTimeout(timer);
  },[nudgeId,motion]);
  const className='companion-figure'+(motion?' is-breathing':'')+(nudging?' is-nudging':'');
  return h('div',{className,role:'img','aria-label':display?`专属角色桌宠 · ${display.label}`:'专属角色桌宠','data-asset-slot':display?.state??'idle','data-asset-key':frame?.asset??'idle','data-avatar-pack':frame?.resolvedPackId,'data-avatar-state':frame?.resolvedState,'data-avatar-fallback':frame?.fallback},
    h('div',{className:'companion-body'},...layers.map((layer,index)=>{
      return h('img',{
        key:layer.key,
        className:'companion-frame '+(index===layers.length-1?'is-current':'is-leaving'),
        src:layer.url,
        alt:'',
        draggable:false,
        decoding:'async',
        style:{'--pet-scale':layer.geometry.scale,'--pet-x':layer.geometry.offsetX+'px','--pet-y':layer.geometry.offsetY+'px'} as React.CSSProperties,
      });
    })));
}

// Low key D / Y rail: a letter and a coloured dot per person, plus a very small
// pending badge. Everything else belongs to the mini panel behind a click.
//
// 颜色唯一来源是 companion-colors.ts：同一个状态（语义）永远同一个颜色，
// 与是 D 还是 Y 无关，也不存在“空闲却显示红色”的兜底分支。
export function CompanionRail({live}:{live:LiveSnapshot|null}){
  const rows=(live?.people||[]).map(person=>h('span',{className:'rail-chip',key:person.person,title:`${person.alias} · ${companionRailLabel(person)}`},
    h('b',null,person.alias),
    h('i',{className:`rail-dot tone-${companionTone(presenceStateFor(person))}`,'data-tone':companionTone(presenceStateFor(person)),'aria-hidden':true})));
  const summary=(live?.people||[]).map(person=>`${person.alias} ${companionRailLabel(person)}`).join('、');
  const night=!!live?.display.nightly;
  return h('div',{className:'companion-rail'+(night?' is-night':''),role:'status','aria-label':live?`${summary}${live.pending?` · ${live.pending} 条待处理提醒`:''}${night?' · 夜间休息中':''}`:'双方状态'},
    ...rows,live?.pending?h('span',{className:'rail-count',title:`${live.pending} 条待处理提醒`},String(live.pending)):null);
}
