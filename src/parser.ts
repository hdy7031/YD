import { addDays, dateOf, epoch, weekday } from './core.ts';
import { academicOf } from './academic.ts';
import { blankDraft } from './inbox-types.ts';
import type { ParserAdapter, ParseContext, ParsedDraft } from './inbox-types.ts';
const number=(s:string):number=>/^\d+$/.test(s)?Number(s):s==='半'?30:s.includes('十')?(s.split('十')[0]?number(s.split('十')[0]):1)*10+(s.split('十')[1]?number(s.split('十')[1]):0):'零一二三四五六七八九'.indexOf(s.replace('两','二'));
const pad=(n:number)=>String(n).padStart(2,'0');
const datePattern=/(?:\d{4}年)?\d{1,2}月\d{1,2}[日号]|今天|明天|后天|(?:本周|这周|下周|周)[一二三四五六日天]|月底/;
export function parseDate(text:string,createdAt:number):{date:string;warnings:string[]} {
  const today=dateOf(createdAt),m=text.match(datePattern),warnings:string[]=[];
  if(!m)return {date:'',warnings};
  const token=m[0];let date='';
  if(token==='月底'){date=addDays(new Date(Date.UTC(Number(today.slice(0,4)),Number(today.slice(5,7)),1)).toISOString().slice(0,10),-1);warnings.push('月底前暂按月末当天理解，请核对截止时间。');}
  else if(['今天','明天','后天'].includes(token))date=addDays(today,['今天','明天','后天'].indexOf(token));
  else if(token.includes('周')){
    const day='一二三四五六日天'.indexOf(token.at(-1)!)+1,w=day===8?7:day;
    let offset=w-weekday(today);if(token.startsWith('下周'))offset+=7;
    else if(token.startsWith('周')&&offset<0){offset+=7;warnings.push(`已按下一个周${token.at(-1)}理解。`);}
    date=addDays(today,offset);
  } else {const parts=token.match(/(?:(\d{4})年)?(\d{1,2})月(\d{1,2})[日号]/)!;date=`${parts[1]||today.slice(0,4)}-${pad(+parts[2])}-${pad(+parts[3])}`;if(!parts[1])warnings.push('未写年份，暂按通知创建年份理解。');}
  if(!Number.isFinite(epoch(date))||dateOf(epoch(date))!==date)return {date:'',warnings:['日期无效，请手动填写。']};
  return {date,warnings};
}
export function parseTimes(text:string):{start:string;end:string;warnings:string[]} {
  const re=/(上午|中午|下午|晚上|晚间|早上)?\s*([零一二两三四五六七八九十\d]{1,3})(?:[:：]([0-5]\d)|点(?:(半|[零一二三四五六七八九十\d]{1,3})分?)?)/g;
  const matches=[...text.matchAll(re)],warnings:string[]=[];let period='';
  const values=matches.slice(0,2).map(m=>{period=m[1]||period;let h=number(m[2]),min=m[3]?+m[3]:m[4]?number(m[4]):0;
    if(['下午','晚上','晚间'].includes(period)&&h<12)h+=12;if(period==='中午'&&h<11)h+=12;
    if(!period&&h>=1&&h<=11&&!m[3])warnings.push('未明确上午或下午，请核对时间。');
    return h>=0&&h<24&&min>=0&&min<60?`${pad(h)}:${pad(min)}`:'';});
  if(!matches.length&&/上午|中午|下午|晚上/.test(text))warnings.push('只有时段，未提供具体时间。');
  return {start:values[0]||'',end:values[1]||'',warnings};
}
export class LocalRuleParser implements ParserAdapter {
  parse(input:{text:string;createdAt:number},context:ParseContext):ParsedDraft {
    const text=input.text.trim().replace(/(?<=[\p{Script=Han}\d])\s+(?=[\p{Script=Han}\d])/gu,''),d=blankDraft();d.note=input.text.trim();d.correction=/更正|改成|改为|更改/.test(text);
    const change=/停课|调课|补课|换教室|換教室|换地点|改到|调至|调到|课程取消/.test(text);
    d.type=change?'COURSE_CHANGE':/提交|前交|交(?!流|通)|完成|填写|报名|缴费|打卡|截止|记得做|报告.*交|交.*报告/.test(text)?'TODO':/开会|会议|大会|讲座|活动|答辩|培训|聚餐|集合|报到/.test(text)||d.correction?'EVENT':/通知|开放时间|详见|公告|放假/.test(text)?'GENERAL_NOTICE':'UNKNOWN';
    const split=text.split(/调到|调至|改到|改成|改为/),original=split[0],dest=split.slice(1).join(' ');
    const date=parseDate(d.type==='COURSE_CHANGE'?original:text,input.createdAt),times=parseTimes(d.type==='COURSE_CHANGE'?dest:text);
    Object.assign(d,{date:date.date,startTime:times.start,endTime:times.end,warnings:[...date.warnings,...times.warnings],confidence:d.type==='UNKNOWN'?0.2:0.75});
    d.title=text.split(/[，。！\n]/)[0].slice(0,200);
    if(d.type==='TODO'){
      const report=text.match(/([\u4e00-\u9fff]{1,12}报告)/);
      if(report){const clean=report[1].replace(/.*(?:前交|提交|交)/,'');d.title='提交'+clean;}
      d.reminderMinutes=d.date?120:null;
      if(d.date&&!d.startTime){d.startTime='23:59';d.warnings.push('未写截止时刻，暂建议当天 23:59，请确认。');}
    }
    if(d.type==='EVENT'){
      const title=text.match(/(?:进行|举行|参加|召开)([^，。！\n]+?(?:大会|会议|讲座|活动|答辩|培训|聚餐))/)||text.match(/(新生大会|开会|会议|讲座|答辩|培训|聚餐|集合|报到)/);
      if(title)d.title=title[1]==='开会'?'会议':title[1];
      d.location=text.match(/在\s*(.+?)(?=进行|举行|召开|参加|开会|集合|[,，。]|$)/)?.[1]?.trim()||'';
      d.reminderMinutes=20;
    }
    if(d.type==='COURSE_CHANGE'){
      d.operation=/停课|课程取消/.test(text)?'CANCEL':/调课|补课|调到|调至/.test(text)?'RESCHEDULE':'LOCATION_CHANGE';
      const nd=parseDate(dest,input.createdAt);d.newDate=nd.date;d.warnings.push(...nd.warnings);
      if(nd.date||times.start)d.operation='RESCHEDULE';
      const candidates=context.courses.filter(c=>{const calendar=academicOf(context.profiles.find(p=>p.id===c.person));const week=calendar&&d.date?Math.floor((epoch(d.date)-epoch(calendar.startDate))/86400000/7)+1:0;return text.includes(c.title)&&(!d.date||!!calendar&&weekday(d.date)===c.weekday&&c.weeks.includes(week));});
      if(candidates.length===1){d.courseId=candidates[0].id;d.title=candidates[0].title;}
      else d.warnings.push(candidates.length?'存在多个候选课程，请选择具体的一次课程。':'未找到唯一课程，请选择已有课程。');
      const periods=dest.match(/(\d{1,2})\s*[-—至到]\s*(\d{1,2})\s*节/);
      if(periods){d.first=+periods[1];d.last=+periods[2];const c=context.courses.find(c=>c.id===d.courseId),calendar=academicOf(context.profiles.find(p=>p.id===c?.person));d.startTime=calendar?.periods[d.first-1]?.start||'';d.endTime=calendar?.periods[d.last-1]?.end||'';}
      if(d.operation==='LOCATION_CHANGE')d.location=dest.replace(/[。！]$/,'').trim()||text.match(/(?:换教室|换地点)[为到至]?\s*(.+)/)?.[1]||'';
      if(d.operation==='RESCHEDULE')d.location=dest.match(/(?:在|地点[为：:]?|教室[为：:]?)\s*([^，。]+)/)?.[1]||'';
    }
    if(['EVENT','COURSE_CHANGE'].includes(d.type)&&!d.date)d.missingFields.push('日期');
    if(d.type==='EVENT'&&!d.startTime)d.missingFields.push('开始时间');
    if(d.type==='COURSE_CHANGE'&&!d.courseId)d.missingFields.push('关联课程');
    if(d.correction)d.warnings.push('这可能是在修改已有事项，请核对候选事项和日期。');
    return d;
  }
}
