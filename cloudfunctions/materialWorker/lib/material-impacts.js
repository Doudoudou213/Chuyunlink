'use strict';
async function rows(db,name,filter={}) {
 const all=[];let offset=0;
 for(;;){let items;try{items=(await db.collection(name).where(filter).skip(offset).limit(100).get()).data||[];}
 catch(e){if(/collection.*not.*exist|DATABASE_COLLECTION_NOT_EXIST/i.test(e.message+' '+e.code))return all;throw e;}
 all.push(...items);if(items.length<100)return all;offset+=items.length;}
}
async function propagateMaterialImpacts(db,submissionId,reason,analysisId,keepVersion) {
 const links=(await rows(db,'story_evidence_links',{submissionId})).filter(l=>l.materialAnalysisId&&(!analysisId||l.materialAnalysisId===analysisId) && (!keepVersion||l.materialReviewVersion!==keepVersion));
 const ids=new Set(links.map(l=>l._id||l.id));
 const jobs=(await rows(db,'story_agent_jobs')).filter(j=>(j.input&&j.input.evidenceLinks||[]).some(s=>ids.has(s.id)));
 const jobIds=new Set(jobs.map(j=>j._id||j.id));
 const patch={needsSourceReview:true,sourceReviewReason:reason,updatedAt:db.serverDate()};
 const update=(name,row,data)=>db.collection(name).doc(row._id||row.id).update(data);
 for(const link of links)await update('story_evidence_links',link,patch);
 for(const j of jobs)await update('story_agent_jobs',j,{...patch,status:reason==='material_revision_changed'?'source_invalid':'consent_revoked',lockedAt:null});
 const candidates=(await rows(db,'story_agent_candidates')).filter(c=>jobIds.has(c.jobId)||(c.payload&&c.payload.evidenceLinkIds||[]).some(id=>ids.has(id)));
 for(const c of candidates){
   if(c.status==='pending_review')await update('story_agent_candidates',c,{...patch,status:'source_invalid'});
   if(c.formalEntityId){try{await db.collection('story_entities').doc(c.formalEntityId).update(patch);}catch(e){if(!/not.*exist|not.*found/i.test(e.message))throw e;}}
 }
 for(const [name,key] of [['story_relations','evidenceLinkIds'],['story_chains','sourceLinkIds'],['story_claims','sourceLinkIds']])
   for(const row of await rows(db,name))if((row[key]||[]).some(id=>ids.has(id)))await update(name,row,patch);
 for(const row of await rows(db,'story_gap_tasks'))if(candidates.some(c=>(c._id||c.id)===row.sourceAgentCandidateId))
   await update('story_gap_tasks',row,{...patch,status:'paused_source_review'});
 return {evidence:ids.size,jobs:jobs.length,candidates:candidates.length};
}
module.exports={rows,propagateMaterialImpacts};
