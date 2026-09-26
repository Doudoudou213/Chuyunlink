'use strict';
const crypto=require('node:crypto');
const EVENTS=Object.freeze({story:['source_open','explore','contribute_start'],theme:['source_open','explore','contribute_start'],guide:['source_open','read_mark','bookmark','contribute_start'],route:['replan','reorder','skip','arrive','end_early','complete','contribute_start']});
const hash=x=>crypto.createHash('sha256').update(String(x)).digest('hex');
const first=r=>Array.isArray(r?.data)?r.data[0]:r?.data;
const read=async(db,c,id)=>first(await db.collection(c).doc(id).get());
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
function nonce(v){if(typeof v!=='string'||!/^([a-f0-9]{32}|[a-f0-9]{64})$/.test(v))fail('EFFECT_INPUT','事件凭据格式错误');return hash(v);}
function percent(n,d){return d>=20&&n>=5&&d-n>=5?Math.round(n/d*1000)/10:null;}
module.exports={EVENTS,hash,first,read,fail,nonce,percent};
