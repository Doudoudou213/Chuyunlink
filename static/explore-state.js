(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.ExploreState=factory();})(globalThis,function(){
'use strict';
function validate(value){if(!value||!value.walk||!value.map||!Array.isArray(value.map.objects)||value.map.objects.length<1||value.map.objects.length>12)throw Error('探索地图尚未配置');const ids=new Set();for(const o of value.map.objects){if(typeof o.id!=='string'||ids.has(o.id)||!value.walk.points.some(p=>p.id===o.pointId)||![o.x,o.y].every(n=>Number.isFinite(n)&&n>=0&&n<=1000))throw Error('地图对象与材料不匹配');ids.add(o.id);}return value;}
function object(value,id){return value.map.objects.find(o=>o.id===id)||null;}
function point(value,id){const o=object(value,id);return o?value.walk.points.find(p=>p.id===o.pointId):null;}
function record(old,value,pointId,now){if(!value.walk.points.some(p=>p.id===pointId))throw Error('观察点已变化');return {id:old?.id||now,status:'active',resourceId:value.walk.resourceId,version:value.walk.version,fingerprint:value.walk.fingerprint,simulated:value.walk.simulated===true,visited:[...new Set([...(old?.fingerprint===value.walk.fingerprint?old.visited:[]),pointId])],updatedAt:now};}
function camera(x,y,scale){return {x:Math.max(-700,Math.min(700,Number(x)||0)),y:Math.max(-600,Math.min(600,Number(y)||0)),scale:Math.max(.8,Math.min(3.2,Number(scale)||1))};}
return {validate,object,point,record,camera};
});
