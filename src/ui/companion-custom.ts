// Custom companion renderer: frame resolution, crossfade and the light motion
// layer. No business judgement happens here — the frame comes straight from the
// companion display projection the main process already resolved.
import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import { DEFAULT_AVATAR_PACK_ID, resolveAvatarPack } from '../avatar.ts';
import { AvatarRuntime } from '../avatar-runtime.ts';
import { companionFallbackIdle } from '../companion-fallback-idle.ts';
import { companionRailLabel, type CompanionDisplay } from '../companion-display.ts';
import { companionTone } from '../companion-colors.ts';
import { resolveCompanionFrame, type CompanionAssets, type ResolvedCompanionFrame } from '../companion-frame.ts';
import { presenceStateFor, type LiveSnapshot } from '../live.ts';
const h=React.createElement;
const api=()=>window.dayhub;

// The main process owns resource paths; Chromium owns decode.  Decode rejection
// is deliberately observable here so a bad new pack can never replace the
// current visual with a broken image.
const decode=(url:string)=>new Promise<void>((resolve,reject)=>{
  const image=new Image();
  image.onload=()=>{
    if(typeof image.decode==='function') void image.decode().then(()=>resolve(),reject);
    else resolve();
  };
  image.onerror=()=>reject(new Error('Avatar image failed to load'));
  image.src=url;
});

function removeBrokenImages(assets:CompanionAssets,broken:Set<string>):CompanionAssets{
  if(!broken.size)return assets;
  const packs=Object.fromEntries(Object.entries(assets.packs).map(([id,pack])=>[id,{...pack,images:Object.fromEntries(Object.entries(pack.images).filter(([,url])=>!broken.has(url)))}]));
  const primary=packs[assets.resolvedPackId]??packs[assets.pack.id];
  return {...assets,packs,images:primary?.images??{},missing:[...new Set([...(primary?.missing??[]),...Object.keys(assets.images).filter(key=>broken.has(assets.images[key]))])]};
}

async function decodeAssets(assets:CompanionAssets):Promise<CompanionAssets>{
  const urls=[...new Set(Object.values(assets.packs).flatMap(pack=>Object.values(pack.images)))];
  const results=await Promise.all(urls.map(async url=>({url,ok:await decode(url).then(()=>true,()=>false)})));
  const safe=removeBrokenImages(assets,new Set(results.filter(result=>!result.ok).map(result=>result.url)));
  // `companionFallbackIdle` is the resolver's catastrophic last resort.  If
  // even it cannot decode, AvatarRuntime retains its previous last-known-good.
  await decode(companionFallbackIdle);
  const preview=resolveCompanionFrame(safe,safe.pack.previewState);
  const pack=resolveAvatarPack(preview.resolvedPackId);
  const primary=safe.packs[pack.id];
  return {...safe,resolvedPackId:pack.id,pack,source:primary?.source??safe.source,manifest:primary?.manifest??safe.manifest,images:primary?.images??{},missing:primary?.missing??[],aspect:pack.canvas.width/pack.canvas.height};
}

let runtime:AvatarRuntime<CompanionAssets>|undefined;
function avatarRuntime(){
  return runtime??=new AvatarRuntime<CompanionAssets>({
    resolve:requestedPackId=>{const pack=resolveAvatarPack(requestedPackId);return {id:pack.id,version:pack.version};},
    load:async requestedPackId=>{
      const value=await api().companionAssets(requestedPackId);
      return {resolvedPackId:value.resolvedPackId,version:value.pack.version,value};
    },
    decode:decodeAssets,
    identify:value=>({resolvedPackId:value.resolvedPackId,version:value.pack.version}),
  });
}

export function useCompanionAssets(packId?:string,commitGeometry=false):CompanionAssets|null{
  const [assets,set]=useState<CompanionAssets|null>(()=>avatarRuntime().activeVisual?.value??null);
  const request=useRef(0);
  useEffect(()=>{
    let active=true;const token=++request.current;
    const requestedPackId=packId||DEFAULT_AVATAR_PACK_ID;
    // State changes do not enter this dependency list: one decoded Pack serves
    // every CompanionDisplay state.  A selection change keeps the existing
    // image visible while the new pack loads and decodes.
    void avatarRuntime().request(requestedPackId,async resource=>{
      if(!commitGeometry)return true;
      const ready=await api().avatarVisualReady({requestedPackId,resolvedPackId:resource.resolvedPackId,version:resource.version});
      return ready===true;
    }).then(result=>{
      if(!active||token!==request.current)return;
      if(result.kind==='committed'){
        // The cached bundle may have been loaded through a different request
        // (for example an unknown persisted id resolving to yd-default). Keep
        // requested identity on this immutable projection for frame resolver.
        set({...result.active.value,requestedPackId:result.active.requestedPackId,resolvedPackId:result.active.resolvedPackId});
      }
      // failed/stale intentionally retain the previous state: last-known-good.
    });
    return()=>{active=false;};
  },[packId,commitGeometry]);
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
export function useCrossfade(frame:ResolvedCompanionFrame|undefined,duration:number,frozen=false,visualKey?:string){
  const [layers,setLayers]=useState<Layer[]>([]);
  const applied=useRef<string|undefined>(undefined);
  const counter=useRef(0);
  const signature=frame?`${frame.resolvedPackId}:${frame.resolvedState}:${frame.asset}:${frame.geometry.scale}:${frame.geometry.offsetX}:${frame.geometry.offsetY}:${frame.url}`:undefined;
  const pack=frame?(visualKey??frame.resolvedPackId):undefined;
  const appliedPack=useRef<string|undefined>(undefined);
  // Layout timing is important for Pack changes: main has just committed the
  // matching window geometry, so replacing the outgoing layer before paint
  // prevents an A-sprite/B-canvas intermediate frame.
  useLayoutEffect(()=>{
    if(!frame){setLayers([]);applied.current=undefined;appliedPack.current=undefined;return;}
    const packChanged=appliedPack.current!==undefined&&appliedPack.current!==pack;
    if(frozen&&!packChanged)return;
    if(applied.current===signature)return;
    applied.current=signature;
    appliedPack.current=pack;
    counter.current+=1;
    const layer:Layer={...frame,key:counter.current};
    setLayers(previous=>packChanged?[layer]:[...previous.slice(-1),layer]);
  },[signature,frozen,pack]);
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
  const visualKey=assets?`${assets.resolvedPackId}@${assets.pack.version}`:undefined;
  const layers=useCrossfade(frame,motion?150:0,frozen,visualKey);
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
