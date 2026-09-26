'use strict';
const fail=m=>{throw Object.assign(new Error(m),{code:'GUIDE_OUTPUT_INVALID'});};
const str=(v,min,max)=>{if(typeof v!=='string'||v.trim().length<min||v.length>max)fail('讲解内容长度或格式不合要求');return v.trim();};
const keys=(o,names)=>{if(!o||typeof o!=='object'||Array.isArray(o)||Object.keys(o).some(k=>!names.includes(k)))fail('模型返回了范围之外的内容');};
function validateGuideOutput(raw,input){
 keys(raw,['title','sentences','observations','gaps']);
 const title=str(raw.title,2,100);
 const refs=(v)=>{if(!Array.isArray(v)||!v.length||v.length>12||v.some(x=>typeof x!=='string'||!input.claims.some(c=>c.id===x)))fail('引用了未提供的事实');return [...new Set(v)];};
 if(!Array.isArray(raw.sentences)||!raw.sentences.length||raw.sentences.length>12)fail('讲解必须逐句保留依据');
 const sentences=raw.sentences.map(s=>{keys(s,['text','claimIds']);return {text:str(s.text,2,200),claimIds:refs(s.claimIds)};});
 const text=sentences.map(s=>s.text).join('');str(text,20,500);
 if(!Array.isArray(raw.observations)||raw.observations.length>3||!Array.isArray(raw.gaps)||raw.gaps.length>5)fail('观察或缺口格式错误');
 const observations=raw.observations.map(o=>{keys(o,['text','claimIds','locator','locationEvidence']);const claimIds=refs(o.claimIds),locator=str(o.locator,0,100),locationEvidence=str(o.locationEvidence,0,200);const allowed=input.claims.filter(c=>claimIds.includes(c.id)).flatMap(c=>c.sourceLinkIds);
 if(locator&&(!locationEvidence||!locationEvidence.includes(locator)||!input.sources.some(s=>allowed.includes(s.id)&&s.excerpt.includes(locationEvidence))))fail('具体位置必须来自所引用的材料原句');
 return {text:str(o.text,2,160),claimIds,locator,locationEvidence};});
 if(/https?:\/\/|cloud:\/\//i.test(JSON.stringify(raw)))fail('讲解不得包含文件或外部链接');
 return {title,text,sentences,observations,gaps:raw.gaps.map(g=>str(g,2,180))};
}
const string={type:'string'};const refs={type:'array',items:string};
const object=properties=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)});
const GUIDE_SCHEMA=object({title:string,sentences:{type:'array',items:object({text:string,claimIds:refs})},observations:{type:'array',items:object({text:string,claimIds:refs,locator:string,locationEvidence:string})},gaps:{type:'array',items:string}});
module.exports={validateGuideOutput,GUIDE_SCHEMA};
