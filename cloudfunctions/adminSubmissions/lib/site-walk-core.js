'use strict';
const crypto = require('node:crypto');
const {read, checkGuideEvidence} = require('./guide-evidence');
const {publishedGuideValid} = require('./guide-grounding');
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (code, message) => { throw Object.assign(new Error(message), {code}); };
const id = value => { if (typeof value !== 'string' || !/^[\w-]{1,128}$/.test(value)) fail('WALK_INPUT','记录编号无效'); return value; };
const text = (value, max=200) => { const s=String(value||'').trim(); if(s.length>max) fail('WALK_INPUT','文字过长，请精简'); return s; };
const active = r => r && r.status==='published' && !r.disabledAt && !r.withdrawnAt && !r.needsSourceReview && !r.sourceUnavailable && !['closed','unavailable'].includes(r.visitInfo?.status);
const rootId = resourceId => 'sw_'+hash(id(resourceId)).slice(0,32);
async function guide(db, versionId, resourceId) {
 const f=await read(db,'guide_fragment_versions',id(versionId));
 const root=f && await read(db,'guide_fragments',f.id);
 if(!f || !root || root.status==='archived' || root.needsSourceReview || root.publishedVersionId!==versionId || f.status!=='published' || f.resourceId!==resourceId || f.simulated || f.needsSourceReview) fail('WALK_SOURCE','讲解已变更或停止公开，请重新选取');
 const c=await checkGuideEvidence(db,f);
 if(!publishedGuideValid(f,c)) fail('WALK_SOURCE','讲解依据需要重新核对');
 const sources=[];
 if(f.evidenceKind==='official_pack') sources.push(...require('./guide-pack-evidence').publicPack(f,c).sources);
 else for(const s of c.sources) sources.push({id:s.id,title:String(s.submission.title||'社区文化记录').slice(0,120),excerpt:String(s.link.evidenceSummary||'').slice(0,400),contributorName:await require('./public-attribution').contributorNameFor(db,s.submission)});
 return {f,c,sources,observations:(f.observations||[]).map((o,index)=>({key:hash([versionId,o]),index,text:o.text,locator:o.locator,located:!!o.locator && o.locator!=='具体位置尚未确认' && (f.evidenceKind==='official_pack'||!!o.locationEvidence)}))};
}
function draft(raw) {
 if(!Array.isArray(raw.points)||!raw.points.length||raw.points.length>12) fail('WALK_INPUT','请选择 1～12 处观察点');
 const points=raw.points.map(p=>({id:id(p.id),guideVersionId:id(p.guideVersionId),observationKey:id(p.observationKey),title:text(p.title,100),direction:text(p.direction),accessNote:text(p.accessNote,500)}));
 if(new Set(points.map(p=>p.id)).size!==points.length) fail('WALK_INPUT','观察点编号不能重复');
 // No arbitrary photo URL or unreviewed narrative is accepted in this editor.
 return {title:text(raw.title,100),points,...(raw.exploration ? {exploration:require('./exploration-core').normalize(raw.exploration,points)} : {})};
}
async function resolve(db, resourceId, value) {
 const resource=await read(db,'resources',id(resourceId));
 if(!active(resource)) fail('WALK_SOURCE','地点暂不适合公开导览');
 const points=[], cache=new Map();
 for(const p of value.points) {
  if(!cache.has(p.guideVersionId)) cache.set(p.guideVersionId,await guide(db,p.guideVersionId,resourceId));
  const g=cache.get(p.guideVersionId),o=g.observations.find(x=>x.key===p.observationKey);
  if(!o?.located) fail('WALK_SOURCE','观察内容或位置已变化，请重新选取');
  points.push({id:p.id,title:p.title||g.f.title,text:o.text,locator:o.locator,direction:p.direction,photo:null,sources:g.sources,guideVersionId:p.guideVersionId});
 }
 return {points,sourceFingerprint:hash([...cache.values()].map(g=>[g.f.versionId,g.c.fingerprint,g.c.contextFingerprint])),title:value.title||String(resource.title||'景点导览').slice(0,100)};
}
function review(raw, reviewer, now) {
 const checked=Date.parse(raw?.checkedAt),until=Date.parse(raw?.validUntil);
 if(raw?.onsiteConfirmed!==true||!Number.isFinite(checked)||!Number.isFinite(until)||checked>now||until<=now||until-checked>7*86400000||text(raw.note,500).length<4) fail('WALK_REVIEW','请确认每处位置、顺序与通行条件，并填写核实说明和不超过 7 天的有效期');
 return {onsiteConfirmed:true,checkedAt:new Date(checked).toISOString(),validUntil:new Date(until).toISOString(),note:text(raw.note,500),reviewedBy:reviewer};
}
async function publicWalk(db, resourceId, now) {
 let root;
 try {root=await read(db,'site_walks',rootId(resourceId));}
 catch(e){if(/ResourceNotFound|COLLECTION_NOT_EXIST|collection.*not.*exist/i.test(String(e.code)+e.message))return null;throw e;}
 if(!root) return null; // Legacy fallback only when no managed route exists.
 const empty={ok:true,available:false,reason:'本站导览正在核对，暂不提供行走方向。'};
 if(root.paused || !root.publishedVersionId) return empty;
 const v=await read(db,'site_walk_versions',root.publishedVersionId);
 if(!v || v.resourceId!==resourceId || v.simulated || !v.review?.onsiteConfirmed || !v.review.reviewedBy || Date.parse(v.review.checkedAt)>now || !(Date.parse(v.review.validUntil)>now)) return empty;
 try {
  const resolved=await resolve(db,resourceId,v);
  if(resolved.sourceFingerprint!==v.sourceFingerprint) return empty;
  const walk={id:root.id,resourceId,title:resolved.title,version:v.version,simulated:false,points:resolved.points};
  // Public attribution is deliberately part of the read result, not persisted in sessions.
  return {ok:true,available:true,walk:{...walk,fingerprint:hash(walk)},checkedAt:v.review.checkedAt,validUntil:v.review.validUntil};
 } catch(e) { if(['WALK_SOURCE','GUIDE_SOURCE_INVALID'].includes(e.code)) return empty; throw e; }
}
module.exports={read,hash,fail,id,text,active,rootId,guide,draft,resolve,review,publicWalk};
