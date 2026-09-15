import React,{useEffect,useRef,useState} from 'react';
import { id } from '../core.ts';
import { academicOf } from '../academic.ts';
import { blankDraft } from '../inbox-types.ts';
import type { InboundPayload,ParsedDraft,OcrAdapter } from '../inbox-types.ts';
import type { State,Entity,Notice } from '../types.ts';
import { candidates,draftErrors,sourceLabels,statusLabels,typeLabels } from '../inbox.ts';
import { EmptyState } from './views.ts';
const h=React.createElement;
const api=()=>window.dayhub;
// IPC 抛出的错误会带上 “Error invoking remote method …” 前缀，界面只显示人话部分。
const cleanError=(e:unknown)=>e instanceof Error?e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/,'').replace(/^Error:\s*/,''):String(e);
const button=(label:string,onClick:()=>unknown,style='ghost',disabled=false)=>h('button',{type:'button',onClick,className:style,disabled},label);
const stamp=(n:number)=>new Date(n+8*3600000).toISOString().slice(0,16).replace('T',' ');
export function InboxImage({image}:{image?:string}){const [url,set]=useState(''),[failed,setFailed]=useState(false);useEffect(()=>{let active=true;set('');setFailed(false);if(image)api().image(image).then(url=>{if(active)set(url);}).catch(()=>{if(active)setFailed(true);});return()=>{active=false;};},[image]);return image?url?h('img',{className:'inbox-image',src:url,alt:'原始通知图片'}):h('p',null,failed?'原图暂不可用，请检查本地附件。':'正在读取原图……'):null;}
const displayStatus=(n:Notice)=>n.parseStatus==='NEEDS_REVIEW'&&(!n.detectedType||n.detectedType==='UNKNOWN')?'UNPARSED':n.parseStatus||'UNPARSED';
const ocr:OcrAdapter={recognize:image=>api().ocr(image)};
// 未整理的通知只有占位标题，列表与详情改用原文首行，避免一整列都写着“原始通知”。
const placeholderTitles=['','原始通知','通知','文字录入'];
function noticeTitle(n:Notice){
  const parsed=n.parsedData?.title?.trim();
  if(parsed)return parsed;
  const title=(n.title||'').trim();
  if(title&&!placeholderTitles.includes(title))return title;
  const text=(n.originalText||n.text||'').replace(/\s+/g,' ').trim();
  if(text)return text.length>26?text.slice(0,26)+'…':text;
  return n.image?'图片通知':'通知详情';
}
interface Props {state:State;saved:(s:State)=>void;selected:string|null;select:(id:string|null)=>void;open:(entity:Entity,value:unknown)=>void}
// 宽窄窗决定详情头部的语义：宽窗列表还在旁边，所以不出现“返回大厅”。
function useNarrow(query='(max-width:1100px)'){
  const [narrow,set]=useState(()=>window.matchMedia(query).matches);
  useEffect(()=>{
    const media=window.matchMedia(query),listener=()=>set(media.matches);
    media.addEventListener('change',listener);
    return()=>media.removeEventListener('change',listener);
  },[query]);
  return narrow;
}
// 把任意可解码图片（PNG / JPG / WEBP…）在渲染层转成 PNG 再落盘，
// 主进程因此不需要认识所有图片格式。
async function toPngBytes(file:File){
  const bitmap=await createImageBitmap(file);
  try{
    const canvas=document.createElement('canvas');
    canvas.width=bitmap.width;canvas.height=bitmap.height;
    const context=canvas.getContext('2d');
    if(!context)throw new Error('无法读取这张图片，请换一张截图重试');
    context.drawImage(bitmap,0,0);
    const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/png'));
    if(!blob)throw new Error('无法读取这张图片，请换一张截图重试');
    return new Uint8Array(await blob.arrayBuffer());
  }finally{bitmap.close();}
}
const imageFile=/^image\/(png|jpe?g|webp|bmp|gif)$/i;
const droppedImages=(transfer:DataTransfer|null)=>Array.from(transfer?.files||[]).filter(file=>imageFile.test(file.type));
export function InboxHub({state,saved,selected,select,open}:Props){
  // source 记录这段文字是手打的还是粘贴的：原始通知的来源信息必须可信。
  const [filter,setFilter]=useState<'all'|'pending'|'CONFIRMED'|'IGNORED'>('all'),[text,setText]=useState(''),[source,setSource]=useState<'MANUAL'|'CLIPBOARD'>('MANUAL'),[error,err]=useState(''),[busy,setBusy]=useState(false),[dropping,setDropping]=useState(false),[menu,setMenu]=useState(false);
  const narrow=useNarrow();
  const composer=useRef<HTMLTextAreaElement|null>(null);
  // Entering a notice on a narrow window replaces the hall; leaving it restores
  // where the reader was, so returning feels like the same workspace.
  const hallScroll=useRef(0),previous=useRef<string|null>(selected);
  useEffect(()=>{
    const wasOpen=previous.current!==null;previous.current=selected;
    if(selected&&!wasOpen){
      hallScroll.current=window.scrollY;
      if(narrow)document.querySelector('.inbox-hub')?.scrollIntoView({block:'start'});
    }else if(!selected&&wasOpen){
      const top=hallScroll.current;
      window.requestAnimationFrame(()=>window.scrollTo({top,behavior:'auto'}));
    }
  },[selected,narrow]);
  async function ingest(payload:InboundPayload){
    setBusy(true);err('');const noticeId=id();
    try {const s=await api().change({type:'inbound',id:noticeId,payload});saved(s);select(noticeId);setText('');setSource('MANUAL');
      // 图片先入库，识别放到后台：原图永远先保存，识别慢或失败都不会挡住下一条录入。
      if(payload.image){
        const image=payload.image;
        void (async()=>{try{const text=await ocr.recognize(image);if(text.trim())saved(await api().parseNotice(noticeId,text,true));}catch(e){err('图片已保存，本机识别未完成：'+cleanError(e));}})();
        return;
      }
      if(payload.text?.trim())saved(await api().parseNotice(noticeId,payload.text,false));
    }catch(e){err(cleanError(e));}finally{setBusy(false);}
  }
  // 剪贴板里已经带图片数据时直接用这份数据（不依赖系统剪贴板再次读取），
  // 因此截图工具、浏览器复制图片、系统剪贴板历史都能稳定导入。
  async function image(paste:boolean,file?:File){
    setBusy(true);err('');
    try{
      if(file&&imageFile.test(file.type)){
        const stored=await api().importImageBytes(await toPngBytes(file));
        await ingest({image:stored.image,sourceType:paste?'SCREENSHOT':'IMAGE_IMPORT'});
        return;
      }
      const result=await(paste?api().pasteImage():api().importImage());
      if(result)await ingest({image:result.image,sourceType:paste?'SCREENSHOT':'IMAGE_IMPORT'});
      else if(paste)err('剪贴板里没有图片，可以改为粘贴文字。');
    }catch(e){err(cleanError(e));}finally{setBusy(false);}
  }
  const submitText=()=>{const value=text.trim();if(!value||busy)return;void ingest({text:value,sourceType:source});};
  // 在收件箱主界面按 Ctrl+V：剪贴板是图片就直接建图片通知，是文字就直接进
  // Composer，用户不需要先决定“我这是文字还是截图”。
  useEffect(()=>{
    const listener=async(e:ClipboardEvent)=>{
      if(document.querySelector('.modal-backdrop'))return;
      const tag=(e.target as HTMLElement|null)?.tagName??'';
      const editing=tag==='TEXTAREA'||tag==='INPUT';
      const item=Array.from(e.clipboardData?.items||[]).find(entry=>entry.type.startsWith('image/'));
      if(item&&!editing){e.preventDefault();await image(true,item.getAsFile()??undefined);return;}
      const plain=e.clipboardData?.getData('text/plain')??'';
      if(!plain||editing)return;
      e.preventDefault();
      setSource('CLIPBOARD');
      setText(previous=>previous?previous+'\n'+plain:plain);
      window.requestAnimationFrame(()=>composer.current?.focus());
    };
    document.addEventListener('paste',listener);
    return()=>document.removeEventListener('paste',listener);
  },[busy,text]);
  const dropped=async(files:File[])=>{
    if(!files.length||busy)return;
    setDropping(false);setBusy(true);err('');
    try{
      for(const file of files){
        if(file.size>20*1024*1024)throw new Error('请拖入 20 MB 以内的图片');
        const {image:name}=await api().importImageBytes(await toPngBytes(file));
        await ingest({image:name,sourceType:'IMAGE_IMPORT'});
      }
    }catch(e){err(cleanError(e));}finally{setBusy(false);}
  };
  const list=state.notices.filter(n=>filter==='all'||filter==='pending'&&!['CONFIRMED','IGNORED'].includes(n.parseStatus||'')||filter===n.parseStatus).sort((a,b)=>(b.createdAt??b.updatedAt)-(a.createdAt??a.updatedAt));
  const n=state.notices.find(n=>n.id===selected);
  const counts={all:state.notices.length,pending:state.notices.filter(n=>!['CONFIRMED','IGNORED'].includes(n.parseStatus||'')).length,CONFIRMED:state.notices.filter(n=>n.parseStatus==='CONFIRMED').length,IGNORED:state.notices.filter(n=>n.parseStatus==='IGNORED').length};
  const filterLabels:[typeof filter,string][]=[['all','全部'],['pending','待处理'],['CONFIRMED','已确认'],['IGNORED','已忽略']];
  return h(React.Fragment,null,
    // 只有一个入口：粘贴、输入、拖入图片都进同一个 Composer。
    h('section',{className:'capture-composer'+(dropping?' is-drop-target':'')+' is-busy-'+busy,
      onDragOver:(e:React.DragEvent)=>{if(droppedImages(e.dataTransfer).length){e.preventDefault();setDropping(true);}},
      onDragLeave:(e:React.DragEvent)=>{if(e.currentTarget===e.target)setDropping(false);},
      onDrop:(e:React.DragEvent)=>{const files=droppedImages(e.dataTransfer);if(!files.length)return;e.preventDefault();void dropped(files);}},
      h('textarea',{ref:composer,className:'capture-input',rows:text.trim()?6:3,value:text,disabled:busy,placeholder:'粘贴通知、截图，或拖入图片…',
        onChange:(e:React.ChangeEvent<HTMLTextAreaElement>)=>{setText(e.target.value);setSource('MANUAL');},
        onKeyDown:(e:React.KeyboardEvent<HTMLTextAreaElement>)=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();submitText();}}}),
      h('div',{className:'capture-actions'},
        h('span',{className:'capture-hint'},busy?'正在保存原文并整理……':text.trim()?'Ctrl + Enter 整理':dropping?'松手即可导入图片':'Ctrl + V 粘贴文字或截图'),
        h('span',{className:'head-spacer'}),
        button('截图',()=>image(true),'ghost',busy),
        h('details',{className:'action-menu capture-more',open:menu,onToggle:(e:React.SyntheticEvent<HTMLDetailsElement>)=>setMenu(e.currentTarget.open)},
          h('summary',{'aria-label':'更多添加方式'},'+'),
          h('div',{className:'action-menu-pop'},
            h('button',{className:'ghost',onClick:()=>{setMenu(false);void image(false);}},'导入图片'),
            h('button',{className:'ghost',onClick:()=>{setMenu(false);setText('');setSource('MANUAL');}},'清空输入'))),
        button(busy?'整理中…':'整理通知',submitText,'primary',busy||!text.trim()))),
    h('nav',{className:'inbox-filters text-tabs','aria-label':'通知筛选'},...filterLabels.map(([value,label])=>h('button',{key:value,type:'button',className:filter===value?'active':'','aria-current':filter===value?'page':undefined,onClick:()=>{setFilter(value);select(null);}},h('span',null,label),h('small',null,String(counts[value]))))),
    // 数据确认机制是产品原则，保留但降为一行的弱提示（11.5px muted + 轻 info 图标），
    // 不再占据正文级段落的位置。
    h('p',{className:'trust-note'},h('i',{'aria-hidden':true}),'整理结果经确认后才会加入正式事务'),
    error?h('p',{className:'error',role:'alert'},error):null,
    !state.notices.length
      ? h('div',{className:'page-empty-stage'},h(EmptyState,{title:'收件箱还是空的',description:'粘贴通知、截图或拖入图片，原文会先保存在本机，核对后再加入正式事务。',illustration:'assets/gen/empty-inbox.png'}))
      : h('div',{className:'inbox-hub'+(n?' has-selection':' is-hall')},
      h('section',{className:'inbox-list','aria-label':'通知列表'},
        // 列表标题 + 数量合成一个 section header；"选择一条查看详情"这类教学式说明直接删除，
        // 可点击性由列表项自身的 hover / selected 表达。
        h('div',{className:'inbox-list-head'},h('span',{className:'inbox-list-title'},'通知'),h('span',{className:'muted inbox-list-count'},`${list.length} 条`)),
        ...list.map(item=>h('button',{key:item.id,type:'button',className:'entry inbox-list-item kind-'+(item.detectedType||'UNKNOWN')+' status-'+displayStatus(item)+(item.id===selected?' selected':''),'aria-pressed':item.id===selected,onClick:()=>select(item.id===selected?null:item.id)},
          h('strong',null,noticeTitle(item)),
          h('p',{className:'notice-excerpt'},item.originalText||item.text||'图片通知 · 点击查看原图'),
          h('div',{className:'inbox-item-foot'},h('small',{className:'muted'},`${item.sourceLabel||sourceLabels[item.sourceType||'MANUAL']} · ${stamp(item.createdAt??item.updatedAt)}`),h('span',{className:'tag inbox-status'},statusLabels[displayStatus(item)])))),
        !list.length?h('div',{className:'inbox-empty muted'},filter==='all'?'暂无通知。':'这个筛选下没有通知。'):null),
      h('section',{className:'inbox-detail-pane','aria-label':'通知详情'},
        n?h(InboxDetail,{key:n.id,notice:n,state,saved,open,back:()=>select(null),narrow})
          :h('div',{className:'inbox-placeholder'},h('img',{src:'assets/gen/empty-inbox-selection.png',alt:'','aria-hidden':true,draggable:false}),h('div',null,h('strong',null,'未选择通知'),h('p',{className:'muted'},'通知的原文与整理结果会显示在这里。'))))));
}
function InboxDetail({notice:n,state,saved,open,back,narrow}:{notice:Notice;state:State;saved:(s:State)=>void;open:Props['open'];back:()=>void;narrow:boolean}){
  const [draft,setDraft]=useState<ParsedDraft>(n.parsedData||blankDraft()),[text,setText]=useState(n.text),[error,err]=useState(''),[busy,setBusy]=useState(false),[allow,setAllow]=useState(false),[updateId,setUpdate]=useState(''),[deleting,setDeleting]=useState(false);
  useEffect(()=>{setDraft(n.parsedData||blankDraft());setAllow(false);setUpdate('');},[JSON.stringify(n.parsedData)]);
  useEffect(()=>setText(n.text),[n.text]);
  const change=(k:keyof ParsedDraft,v:unknown)=>{setDraft(d=>({...d,[k]:v}));setAllow(false);};
  const input=(k:keyof ParsedDraft,type='text')=>h('input',{type,value:String(draft[k]??''),onChange:(e:React.ChangeEvent<HTMLInputElement>)=>change(k,e.target.value)});
  const field=(label:string,child:React.ReactNode)=>h('label',{className:'field'},h('span',null,label),child);
  const options=(k:keyof ParsedDraft,values:Record<string,string>)=>h('select',{value:String(draft[k]),onChange:(e:React.ChangeEvent<HTMLSelectElement>)=>change(k,e.target.value)},...Object.entries(values).map(([v,t])=>h('option',{key:v,value:v},t)));
  const matches=candidates(state,draft),errors=draftErrors(state,draft),processed=n.parseStatus==='CONFIRMED',ignored=n.parseStatus==='IGNORED',working=busy||n.parseStatus==='PARSING';
  async function run(fn:()=>Promise<State>){setBusy(true);err('');try{saved(await fn());}catch(e){err(cleanError(e));}finally{setBusy(false);}}
  function target(){const entity=n.targetEntityType;if(entity&&entity!=='notice'){const value=(state[entity] as any[]).find(v=>v.id===n.targetEntityId);if(value)open(entity,value);else err('关联事务已删除，原始通知仍保留。');}}
  const statusText=statusLabels[displayStatus(n)];
  // 主操作按事务类型写成一句话，避免所有通知都只有含糊的“确认”。
  const primaryLabel=updateId?'确认更新已有事项':({TODO:'确认并创建待办',EVENT:'确认并加入日程',COURSE_CHANGE:draft.operation==='CANCEL'?'确认停课调整':draft.operation==='LOCATION_CHANGE'?'确认换教室':'确认课程调整',GENERAL_NOTICE:'确认已处理',UNKNOWN:'请先选择类型'} as Record<string,string>)[draft.type]??'确认';
  return h('article',{className:'inbox-detail','aria-label':'通知详情'},
    // 宽窗列表还在旁边，因此头部只写标题、状态与元信息，不出现页级返回。
    h('header',{className:'inbox-detail-head'},
      narrow?h('button',{type:'button',className:'crumb-back',title:'返回通知收件箱','aria-label':'返回通知收件箱',onClick:back},'‹ 通知收件箱'):null,
      h('div',{className:'inbox-head-main'},
        h('strong',{className:'inbox-head-title'},noticeTitle(n)),
        h('small',{className:'muted'},`${sourceLabels[n.sourceType||'MANUAL']} · ${stamp(n.createdAt??n.updatedAt)}`)),
      h('span',{className:'head-spacer'}),
      h('span',{className:'inbox-status-chip status-'+displayStatus(n)},statusText),
      !processed?h('details',{className:'action-menu'},h('summary',{'aria-label':'更多通知操作'},'⋯'),
        h('div',{className:'action-menu-pop'},h('button',{className:'text-button',onClick:()=>setDeleting(true)},'删除通知'))):null),
    deleting?h('div',{className:'source-box',role:'alert'},h('p',null,'删除后，这条通知和整理草稿都会被移除，无法恢复。已创建的待办、会议或调课记录不受影响。'),h('div',{className:'actions'},button('取消',()=>setDeleting(false),'ghost',working),button('确认删除',()=>run(async()=>{const next=await api().change({type:'delete',entity:'notices',id:n.id});back();return next;}),'danger',working))):null,
    // Evidence layer: what arrived stays untouched and readable.
    h('section',{className:'detail-section detail-evidence'},h('h2',null,'原始通知'),h(InboxImage,{image:n.image}),h('pre',{className:'inbox-original'},n.originalText||'图片原文保存在上方原图中。'),
      n.ocrText?h('details',{className:'detail-details'},h('summary',null,'本机 OCR 提取原文'),h('pre',{className:'inbox-original'},n.ocrText)):null),
    processed?h('section',{className:'detail-section detail-settled'},h('h2',null,'处理结果'),h('h3',null,n.targetEntityType==='notice'?'普通通知 · 已处理':`已转为${typeLabels[n.detectedType||'UNKNOWN']}`),h('p',null,n.parsedData?.title||n.title),h('p',{className:'muted'},n.parsedData?`${n.parsedData.date} ${n.parsedData.startTime}`:''),n.text!==n.originalText?h('pre',{className:'inbox-original'},n.text):null,n.targetEntityType!=='notice'?button('查看事项',target,'primary'):null):ignored?h('section',{className:'detail-section detail-settled'},h('h2',null,'处理结果'),h('p',null,'已忽略，原始通知仍然保留。'),button('重新处理',()=>run(()=>api().change({type:'inboxStatus',noticeId:n.id,status:'UNPARSED'})),'secondary',working)):
    h(React.Fragment,null,
      h('section',{className:'detail-section'},h('h2',null,'识别与校对'),
        field(n.image?'提取文字 / 补充文字':'用于整理的文字（原文保留）',h('textarea',{rows:4,value:text,onChange:(e:React.ChangeEvent<HTMLTextAreaElement>)=>setText(e.target.value)})),
        h('div',{className:'actions'},button(working?'正在整理通知……':'保存文字并重新整理',()=>run(()=>api().parseNotice(n.id,text)),'secondary',working||!text.trim()),n.image?button('本机提取图片文字',()=>run(async()=>{const extracted=await ocr.recognize(n.image!);return api().parseNotice(n.id,extracted,true);}),'ghost',working):null),
        n.parseStatus==='FAILED'?h('p',{className:'warning'},n.parseError||'自动整理失败，原始通知已保存。你仍可以手动填写。'):null),
      h('section',{className:'detail-section'},h('h2',null,'整理结果'),draft.confidence<0.6?h('p',{className:'muted'},'部分信息可能需要确认。'):null,...draft.warnings.map((w,i)=>h('p',{className:'muted',key:i},w)),
      field('类型',options('type',typeLabels)),field('标题',input('title')),
      ['TODO','EVENT','COURSE_CHANGE'].includes(draft.type)?h('div',{className:'form-grid'},field(draft.type==='TODO'?'截止日期（可不填）':draft.type==='COURSE_CHANGE'?'原课程日期':'日期',input('date','date')),
        draft.type!=='COURSE_CHANGE'?field(draft.type==='TODO'?'截止时间':'开始时间',input('startTime','time')):null,
        draft.type==='EVENT'?field('结束时间（可不填）',input('endTime','time')):null):null,
      draft.type==='COURSE_CHANGE'?h(React.Fragment,null,field('关联课程（请核对所属人和节次）',h('select',{value:draft.courseId,onChange:(e:React.ChangeEvent<HTMLSelectElement>)=>{const c=state.courses.find(c=>c.id===e.target.value),calendar=academicOf(state.profiles.find(p=>p.id===c?.person));setDraft(d=>({...d,courseId:e.target.value,...(d.first&&d.last&&calendar?{startTime:calendar.periods[d.first-1]?.start||'',endTime:calendar.periods[d.last-1]?.end||''}:{})}));setAllow(false);}},h('option',{value:''},'请选择已有课程'),...state.courses.map(c=>{const p=state.profiles.find(p=>p.id===c.person)!,calendar=academicOf(p);const slot=calendar?`${calendar.periods[c.first-1].start}—${calendar.periods[c.last-1].end}`:'节次未配置';return h('option',{key:c.id,value:c.id},`${p.name} · ${c.title} · 周${'一二三四五六日'[c.weekday-1]} ${slot} · ${c.place}`);}))),field('调整方式',options('operation',{CANCEL:'停课',RESCHEDULE:'调课 / 补课',LOCATION_CHANGE:'换教室 / 地点'})),draft.operation==='RESCHEDULE'?h('div',{className:'form-grid'},field('新日期',input('newDate','date')),field('新开始时间',input('startTime','time')),field('新结束时间',input('endTime','time'))):null,h('p',{className:'muted'},'仅调整原日期这一次课程，不修改整学期模板。')):null,
      draft.type==='EVENT'||draft.type==='COURSE_CHANGE'&&draft.operation!=='CANCEL'?field('地点',input('location')):null,
      draft.type==='EVENT'||draft.type==='TODO'?field('提醒建议（确认事务时才创建）',h('select',{value:draft.reminderMinutes??'',onChange:(e:React.ChangeEvent<HTMLSelectElement>)=>change('reminderMinutes',e.target.value===''?null:Number(e.target.value))},...['','0','10','20','30','60','120','1440',...(draft.reminderMinutes!==null?[String(draft.reminderMinutes)]:[])].filter((v,i,a)=>a.indexOf(v)===i).map(v=>h('option',{key:v,value:v},v===''?'不提醒':`提前 ${v} 分钟`)))):null,
      field('备注',h('textarea',{rows:4,value:draft.note,onChange:(e:React.ChangeEvent<HTMLTextAreaElement>)=>change('note',e.target.value)}))),
      // 只有警告、重复、更正与错误才用明显容器，其余内容靠标题与分隔线成段。
      matches.length||errors.length?h('section',{className:'detail-section detail-confirm is-notice'},
        h('h2',null,draft.correction?'可能是在修改已有事项':'可能已经存在相似事项'),
        ...matches.map(m=>h('div',{key:m.id},h('p',null,`${m.title} · ${m.detail}`),button('查看已有',()=>open(m.entity,(state[m.entity] as any[]).find(x=>x.id===m.id)),'text-button'),draft.type==='EVENT'&&draft.correction?button(updateId===m.id?'已选择更新此事项':'更新已有事项',()=>{const e=state.events.find(e=>e.id===m.id)!;setUpdate(m.id);setDraft(d=>({...d,title:e.title,date:d.date||e.start.slice(0,10),location:d.location||e.place}));},'secondary'):null)),
        h('label',{className:'check-row'},h('input',{type:'checkbox',checked:allow,onChange:(e:React.ChangeEvent<HTMLInputElement>)=>{setAllow(e.target.checked);setUpdate('');}}),draft.type==='COURSE_CHANGE'?'确认覆盖已有单次调整':'仍然创建新事项'),
        ...errors.map((e,i)=>h('p',{className:'muted',key:'err'+i},e))):null),
    // 固定操作条：无论详情多长，忽略 / 保存草稿 / 主操作都在手边。
    // 已确认或已忽略的通知是只读结果，不再显示创建按钮。
    processed||ignored?null:h('div',{className:'inbox-detail-actions'},
      button('忽略',()=>run(()=>api().change({type:'inboxStatus',noticeId:n.id,status:'IGNORED'})),'ghost',working),
      h('span',{className:'head-spacer'}),
      button('保存草稿',()=>run(()=>api().change({type:'draft',noticeId:n.id,draft})),'secondary',working),
      button(primaryLabel,()=>run(()=>api().change({type:'review',noticeId:n.id,draft,allowDuplicate:allow,updateId:updateId||undefined})),'primary',working||errors.length>0||matches.length>0&&!allow&&!updateId)),
    error?h('p',{className:'error',role:'alert'},error):null);
}
