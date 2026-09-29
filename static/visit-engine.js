(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.VisitEngine=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const text=(x,n=128)=>String(x||'').trim().slice(0,n);
const id=x=>{const s=text(x);if(!/^[\w-]{1,128}$/.test(s))fail('VISIT_ID','记录编号无效');return s;};
const number=(x,min,max,fallback)=>Number.isFinite(Number(x))?Math.max(min,Math.min(max,Number(x))):fallback;
function point(p){if(!p)return null;if(p.latitude==null||p.longitude==null||String(p.latitude).trim()===''||String(p.longitude).trim()==='')fail('VISIT_POINT','位置数据缺失');const latitude=Number(p.latitude),longitude=Number(p.longitude);if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||Math.abs(latitude)>90||Math.abs(longitude)>180)fail('VISIT_POINT','请填写有效起终点坐标');return {city:text(p.city,80),coordinateSystem:text(p.coordinateSystem,16)||'gcj02',title:text(p.title,80)||'手动指定位置',latitude,longitude};}
function normalize(raw,catalog,old){
 const resources=new Map(catalog.map(r=>[r.id||r._id,r]));const list=Array.isArray(raw.stops)?raw.stops:[];
 if(!list.length||list.length>8)fail('VISIT_STOPS','请选择 1～8 个站点');
 const seen=new Set();const stops=list.map(s=>{const resourceId=id(s.resourceId);if(seen.has(resourceId))fail('VISIT_DUPLICATE','同一站不能重复');seen.add(resourceId);const r=resources.get(resourceId);const prior=old?.stops.find(x=>x.resourceId===resourceId);if(prior&&['visited','skipped'].includes(prior.state))return {...prior,locked:s.locked===true};if(!r||r.status!=='published'||['closed','unavailable'].includes(r.visitInfo?.status))fail('VISIT_UNAVAILABLE','站点当前不适合参观，请移除后再保存');const before=old?.stops.find(x=>x.resourceId===resourceId);return {resourceId,title:text(r.title,100),city:text(r.region?.city,80),location:r.location?point(r.location):null,visitStatus:r.visitInfo?.status==='verified'&&r.visitInfo?.source&&r.visitInfo?.checkedAt?'verified':'unknown',visitNote:text(r.visitInfo?.note,240),visitSource:text(r.visitInfo?.source,240),visitCheckedAt:text(r.visitInfo?.checkedAt,40),locked:s.locked===true,stayMinutes:Math.round(number(s.stayMinutes,5,240,60)),state:before?.state||'pending'};});
 if(new Set(stops.map(s=>s.city).filter(Boolean)).size>1)fail('VISIT_CROSS_CITY','第一版只安排同城行程，请分开保存');
 if(old){if(old.status==='ended')fail('VISIT_ENDED','游览已经结束，请新建行程');for(const s of old.stops){const next=stops.find(x=>x.resourceId===s.resourceId);if(s.locked&&!next)fail('VISIT_LOCKED','请先解除必去锁定');if(s.state!=='pending'&&(!next||stops.indexOf(next)!==old.stops.indexOf(s)))fail('VISIT_HISTORY','已开始或已完成部分保持原位，请只调整后续站点');}}
 return {depth:['quiet','short','deep'].includes(raw.depth)?raw.depth:'short',mode:['walk','transit','car'].includes(raw.mode)?raw.mode:'walk',minutes:Math.round(number(raw.minutes,30,720,120)),intensity:['relaxed','balanced','active'].includes(raw.intensity)?raw.intensity:'balanced',interests:[...new Set((Array.isArray(raw.interests)?raw.interests:[]).map(x=>text(x,30)))].slice(0,6),origin:point(raw.origin),destination:point(raw.destination),bufferMinutes:Math.round(number(raw.bufferMinutes,0,120,15)),stops};
}
function routeKey(plan){return JSON.stringify([plan.mode,plan.origin,plan.destination,plan.stops.filter(s=>!['visited','skipped'].includes(s.state)).map(s=>[s.resourceId,s.location,s.city])]);}
function routePoints(plan){const city=plan.stops.find(s=>s.city)?.city||'';return [plan.origin&&{...plan.origin,city:plan.origin.city||city},...plan.stops.filter(s=>!['visited','skipped'].includes(s.state)).map(s=>s.location&&({...s.location,title:s.title,city:s.city})),plan.destination&&{...plan.destination,city:plan.destination.city||city}].filter(Boolean);}
function assess(plan,route,now=Date.now()){
 const remaining=plan.stops.filter(s=>!['visited','skipped'].includes(s.state)); const issues=[];
 if(!plan.origin&&remaining.length)issues.push('未指定起点：前往第一站的交通时间尚未计入');
 if(remaining.some(s=>!s.location))issues.push('有站点缺少位置，无法完整核算交通');
 if(remaining.some(s=>!s.city))issues.push('有站点城市尚未核实');if(remaining.some(s=>s.location?.coordinateSystem!=='gcj02'))issues.push('站点坐标系尚未核实');if(remaining.some(s=>s.visitStatus!=='verified'))issues.push('部分参观条件尚未核实');
 const valid=route&&route.key===routeKey(plan)&&now-Number(route.checkedAt)<15*60*1000&&now>=Number(route.checkedAt)&&(route.provider==='amap-web-service'||route.provider==='no-travel'&&routePoints(plan).every(p=>p.latitude===routePoints(plan)[0]?.latitude&&p.longitude===routePoints(plan)[0]?.longitude))&&!route.simulated&&Number.isFinite(route.duration)&&route.duration>=0;
 const stay=remaining.reduce((n,s)=>n+s.stayMinutes,0),traffic=valid?Math.ceil(route.duration/60):null;
 const total=traffic===null?null:stay+traffic+plan.bufferMinutes;
 const elapsed=plan.startedAt?Math.max(0,Math.floor((now-Date.parse(plan.startedAt))/60000)):0; const available=Math.max(0,plan.minutes-elapsed);
 if(!valid)issues.push('真实道路与交通时间待核实');
 if(total!==null&&total>available)issues.push('预计超出可用时间 '+(total-available)+' 分钟，请调整剩余行程');
 const walking=valid?(plan.mode==='walk'?route.distance:route.walkingDistance):null;
 if(!Number.isFinite(walking))issues.push('步行强度待核实');
 else if(walking>({relaxed:3000,balanced:7000,active:12000}[plan.intensity]))issues.push('预计步行超过所选强度');
 return {stayMinutes:stay,trafficMinutes:traffic,bufferMinutes:plan.bufferMinutes,totalMinutes:total,walkingMeters:Number.isFinite(walking)?walking:null,feasible:issues.length===0,issues};
}
function transition(session,type,resourceId,now=new Date().toISOString()){
 if(session.status==='ended')fail('VISIT_ENDED','游览已经结束');const copy=JSON.parse(JSON.stringify(session));const stop=copy.stops.find(s=>s.resourceId===resourceId);
 if(type==='end'){copy.status='ended';copy.endedAt=now;}
 else {if(!stop)fail('VISIT_STOP','请选择本次行程中的站点');if(type==='skip'&&stop.locked)fail('VISIT_LOCKED','请先解除必去锁定再跳过');const states={arrive:'arrived',complete:'visited',skip:'skipped',undo:'pending'};if(!states[type])fail('VISIT_EVENT','不支持的操作');if(stop.state===states[type])return session;if(type==='arrive'&&copy.stops.some(s=>s.resourceId!==resourceId&&s.state==='arrived'))fail('VISIT_ACTIVE','请先完成或跳过当前站点');if(type==='complete'&&stop.state!=='arrived')fail('VISIT_ARRIVAL','请先手动确认到达');if(type!=='undo'&&['visited','skipped'].includes(stop.state))fail('VISIT_HISTORY','请先纠正该站状态');stop.state=states[type];copy.status='active';if(type==='arrive'||type==='complete')copy.startedAt ||= now;if(['arrive','complete'].includes(type)&&stop.location)copy.origin={...stop.location,title:'上一站（非实时定位）'};}
 copy.events=[...(copy.events||[]),{type,resourceId:resourceId||'',at:now}].slice(-300);copy.route=null;return copy;
}
return {normalize,point,routeKey,routePoints,assess,transition,id,text};
});
