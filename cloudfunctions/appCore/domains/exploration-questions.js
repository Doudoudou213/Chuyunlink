'use strict';
const E=require('../lib/exploration-core'),C=require('../lib/site-walk-core');
const {checkGuideEvidence}=require('../lib/guide-evidence');
const {configFromEnv}=require('../lib/guide-question-client');
const {createGuideQuestionService}=require('./guide-questions');
async function evidence(db,resourceId,objectId){
 const live=await E.get(db,C.id(resourceId));const o=live.map?.objects.find(o=>o.id===objectId),p=o&&live.walk.points.find(p=>p.id===o.pointId);
 if(!live.available||!p)C.fail('QA_SOURCE','当前景物或来源已变化，请重新选择');
 const g=await C.guide(db,p.guideVersionId,resourceId);let checked;
 try{checked=await checkGuideEvidence(db,g.f.evidenceKind==='official_pack'?g.f:{...g.f,generatedBy:'guide_agent'});}catch(e){if(e.code!=='GUIDE_SOURCE_INVALID')throw e;return {resourceId,title:p.title,pieces:[],sources:[],fingerprint:E.hash([live.walk.fingerprint,'no-ai-consent',objectId])};}
 const observation=g.f.observations.find(o=>o.text===p.text&&o.locator===p.locator),selectedIds=observation?.claimIds||[];
 const claims=checked.claims.filter(c=>selectedIds.includes(c.id)),ids=claims.length?[...new Set(claims.flatMap(c=>c.sourceLinkIds))]:observation?.locationEvidence?[observation.locationEvidence]:g.sources.map(s=>s.id);
 const sources=g.sources.filter(s=>ids.includes(s.id)),pieces=sources.length?[{id:'observation_'+objectId,text:p.text,sourceIds:sources.map(s=>s.id)},...claims.filter(c=>c.sourceLinkIds.every(id=>sources.some(s=>s.id===id))).slice(0,12).map(c=>({id:c.id,text:c.claimText,sourceIds:c.sourceLinkIds}))]:[];
 const result={resourceId,title:p.title,pieces,sources};result.fingerprint=E.hash([result,objectId,live.walk.fingerprint,checked.fingerprint,checked.contextFingerprint]);if(Buffer.byteLength(JSON.stringify(result))>32000)C.fail('QA_SOURCE','本次材料较多，请先查看来源');return result;
}
function createExplorationQuestionService({db,config,client,clock}){
 const base=config||configFromEnv();const scopedConfig=config||{...base,mode:process.env.EXPLORATION_QA_ENABLED==='true'?base.mode:'off'};
 function scoped(e){const objectId=C.id(e.objectId);const qa=createGuideQuestionService({db,config:scopedConfig,...(client?{client}:{}),...(clock?{clock}:{}),evidenceLoader:(d,id)=>evidence(d,id,objectId)});return {objectId,qa};}
 return {
  // Public read only: use the same object-scoped evidence and consent checks as
  // ask(), without reserving quota or calling a provider.
  async context(e){const {objectId,qa}=scoped(e);return {...await qa.context(e),objectId};},
  async ask(e,uid){const {objectId,qa}=scoped(e);return {...await qa.ask(e,uid),objectId};}
 };
}
module.exports={evidence,createExplorationQuestionService};
