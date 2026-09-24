'use strict';
const assert=require('node:assert/strict'),{fakeDb}=require('./lib/fake-material-db');
const {createMaterialConsentService}=require('../cloudfunctions/appCore/domains/material-consent');
async function main(){
 const links={},jobs={},candidates={};for(let i=0;i<205;i++){links['e'+i]={submissionId:'s',materialAnalysisId:'a'};jobs['j'+i]={input:{evidenceLinks:[{id:'e'+i}]}};candidates['c'+i]={jobId:'j'+i,status:'pending_review'};}
 const db=fakeDb({submissions:{s:{userId:'owner',materialAnalysisConsent:true}},story_evidence_links:links,story_agent_jobs:jobs,story_agent_candidates:candidates,story_chains:{story:{sourceLinkIds:['e204'],status:'published'}},story_relations:{rel:{evidenceLinkIds:['e204'],status:'confirmed'}},story_claims:{claim:{sourceLinkIds:['e204']}},story_themes:{theme:{status:'published',publishedVersionId:'theme_v1'}},story_theme_versions:{theme_v1:{sources:[{id:'e204'}]}}});
 const service=createMaterialConsentService({db});
 await assert.rejects(service.change({action:'withdrawMaterialConsent',submissionId:'s'},'other'),/自己/);
 await service.change({action:'withdrawMaterialConsent',submissionId:'s'},'owner');
 assert.equal(db.data().submissions.s.materialAnalysisConsent,false);assert.equal(db.data().story_agent_candidates.c204.status,'source_invalid');
 assert.equal(db.data().story_chains.story.needsSourceReview,true);assert.equal(db.data().story_relations.rel.needsSourceReview,true);assert.equal(db.data().story_claims.claim.needsSourceReview,true);
 assert.equal(db.data().story_themes.theme.needsSourceReview,true);
 await service.change({action:'withdrawMaterialConsent',submissionId:'s'},'owner');
 assert.equal(Object.keys(db.data().material_consent_logs).length,2);
 console.log('Material withdrawal: ownership, paginated 205 dependants, pending candidates, stories, relations, claims and repeatability passed.');
}main().catch(e=>{console.error(e);process.exitCode=1;});
