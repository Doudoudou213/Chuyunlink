(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./visit-engine'));else root.VisitPlanner=factory(root.VisitEngine);})(typeof globalThis!=='undefined'?globalThis:this,function(E){
'use strict';
const keywords={architecture:['建筑','楼','阁','木构','牌楼','城墙'],museum:['博物馆','展陈','文物','编钟','考古','馆藏'],inscription:['题刻','碑刻','铭文','题记'],local_story:['故事','口述','民俗'],community:['村寨','民俗','口述','土家','社区'],landscape:['东湖','山地','临江','景观','自然']};
const clone=x=>JSON.parse(JSON.stringify(x));
const pending=s=>s.state==='pending';
function distance(a,b){if(!a||!b)return Infinity;const rad=x=>x*Math.PI/180,dlat=rad(b[0]-a[0]),dlon=rad(b[1]-a[1]);const h=Math.sin(dlat/2)**2+Math.cos(rad(a[0]))*Math.cos(rad(b[0]))*Math.sin(dlon/2)**2;return 6371*2*Math.asin(Math.sqrt(Math.min(1,h)));}
// The map basket and the guide share this deterministic selection and ordering.
// Straight-line distance is only a selection aid, never a road/time result.
function selectEntries(entries,{minutes=120,intensity='balanced',anchor=null,maxDistance=Infinity,buffer=15}={}){
 const ranked=[...entries].sort((a,b)=>b.score-a.score||String(a.item.id).localeCompare(String(b.item.id)));
 const limit=Math.min({relaxed:2,balanced:4,active:6}[intensity]||4,Math.max(1,Math.floor(minutes/65)),8);
 const chosen=[];let used=0;const start=anchor||ranked[0]?.item.coords;
 for(const entry of ranked){if(chosen.length>=limit)break;if(distance(start,entry.item.coords)>maxDistance)continue;if(chosen.length&&used+entry.stayMinutes+buffer>minutes)continue;chosen.push(entry);used+=entry.stayMinutes;}
 const ordered=[];let at=start;
 while(chosen.length){chosen.sort((a,b)=>distance(at,a.item.coords)-distance(at,b.item.coords)||b.score-a.score);const next=chosen.shift();ordered.push(next);at=next.item.coords;}
 return ordered;
}
function eligible(r){const p=r.location;return ['landmark','hotspot'].includes(r.type)&&r.status==='published'&&!['closed','unavailable'].includes(r.visitInfo?.status)&&!!r.region?.city&&p&&Number.isFinite(p.latitude)&&Number.isFinite(p.longitude)&&Math.abs(p.latitude)<=90&&Math.abs(p.longitude)<=180&&(!p.coordinateSystem||p.coordinateSystem==='gcj02');}
function recommend(catalog,preferences){
 const city=String(preferences.city||'');if(!city)throw Error('先选一个城市，我再安排。');
 const minutes=Number(preferences.minutes||120);if(minutes<30||minutes>720)throw Error('请安排 30 分钟到 12 小时内的行程。');
 const interests=preferences.interests||[],intensity=preferences.intensity||'balanced',mode=preferences.mode||'walk';
 const entries=catalog.filter(r=>eligible(r)&&r.region.city===city).map(r=>{const words=[r.title,r.summary,...(r.tags||[])].join(' ');const matches=interests.filter(k=>(keywords[k]||[]).some(w=>words.includes(w)));return {item:{id:r.id,coords:[r.location.latitude,r.location.longitude]},score:matches.length*36+Math.max(0,Math.min(100,Number(r.completeness)||0))/5+(r.visitInfo?.status==='verified'?10:0),stayMinutes:Math.min(60,Math.max(15,minutes-15)),reasons:matches.length?['与你的兴趣相符']:['同城文化地点']};});
 if(!entries.length)throw Error('这个城市暂缺可用的游览地点，请换个城市或稍后再试。');
 const ordered=selectEntries(entries,{minutes,intensity,maxDistance:mode==='walk'?3:mode==='transit'?20:40});
 const plan=E.normalize({minutes,intensity,mode,interests,bufferMinutes:15,stops:ordered.map(e=>({resourceId:e.item.id,stayMinutes:e.stayMinutes}))},catalog);
 return {plan,reasons:ordered.map(e=>({resourceId:e.item.id,text:e.reasons.join('、')}))};
}
function elapsed(s,now){return s.startedAt?Math.max(0,Math.floor((now-Date.parse(s.startedAt))/60000)):0;}
function mutableIndex(s){const lastHistory=s.stops.reduce((n,x,i)=>pending(x)?n:i,-1);for(let i=s.stops.length-1;i>lastHistory;i--)if(pending(s.stops[i])&&!s.stops[i].locked)return i;return -1;}
async function adjust(session,intent,calculate,now=Date.now()){
 if(session.status==='ended')throw Error('这次游览已经结束，可以另选一程。');
 const plan=clone(session),removed=[];let route=null,routeError='';
 if(intent.type==='time'){const remaining=Number(intent.minutes);if(!Number.isInteger(remaining)||remaining<30||remaining>720)throw Error('请输入 30～720 分钟的剩余时间。');plan.minutes=remaining+elapsed(session,now);if(plan.minutes>720)throw Error('本次总行程已接近 12 小时，请结束后另开一程。');}
 if(intent.type==='less'){const index=mutableIndex(plan);if(index<0||plan.stops.length<=1)throw Error('已没有可减少的后续站点。必去点和已到达的站点都保留了。');removed.push(plan.stops.splice(index,1)[0].title);plan.intensity='relaxed';}
 // At most three checks; preserve all visited/arrived/skipped positions and locked stops.
 for(let attempt=0;attempt<3;attempt++){
  try{route=await calculate(plan);}catch(_){routeError='交通暂时查不到，暂不保证时间和步行强度。';route=null;break;}
  const a=E.assess(plan,route,now),available=plan.minutes-elapsed(session,now);
  if(intent.type!=='time'||a.totalMinutes===null||a.totalMinutes<=available||attempt===2)break;
  const index=mutableIndex(plan);if(index<0||plan.stops.length<=1)break;
  removed.push(plan.stops.splice(index,1)[0].title);
 }
 const assessment=E.assess(plan,route,now);
 return {plan,route,removed,assessment,notice:routeError|| (assessment.totalMinutes===null?'真实交通时间待核实。':assessment.totalMinutes>plan.minutes-elapsed(session,now)?'保留必去点后仍超时，可减少必去点或提前结束。':'已按地图结果重新检查；停留时长仍为估计。')};
}
function parse(input,catalog,session){
 const text=String(input||'').trim().slice(0,300).replace(/[。！!？?]$/,'');
 if(/^(少走一点|我累了|走累了|想少走一点)$/.test(text))return {type:'less'};
 if(/^(跳过(这一站|本站|下一站)?|这一站不去了)$/.test(text))return {type:'skip'};
 if(/^(提前结束|结束(本次)?游览|不逛了)$/.test(text))return {type:'end'};
 if(/^(讲讲这里|介绍(这里|这一站)|看(看)?(来源|出处)|为什么(推荐|来)这里)$/.test(text))return {type:'explain'};
 if(/不要|不想|不是|取消|不跳|别/.test(text))return {type:'unknown'};
 const number=raw=>({'半':.5,'一':1,'两':2,'二':2,'三':3,'四':4,'五':5,'六':6}[raw]??Number(raw));
 const time=text.match(/(\d{1,3}|半|一|两|二|三|四|五|六)\s*(小时|分钟)/);
 const minutes=time?number(time[1])*(time[2]==='小时'?60:1):null;
 const city=[...new Set(catalog.filter(eligible).map(r=>r.region.city))].find(c=>text.includes(c));
 const interests=Object.keys(keywords).filter(k=>keywords[k].some(w=>text.includes(w)));
 if(session&&time&&/^(我)?(现在)?(只剩|只有|剩余|还有)/.test(text))return {type:'time',minutes};
 if(!session&&city)return {type:'recommend',city,minutes:minutes||120,interests,mode:'walk'};
 return {type:'unknown'};
}
return {recommend,selectEntries,eligible,adjust,parse,distance};
});
