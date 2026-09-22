'use strict';
const assert=require('node:assert/strict');
const {fakeDb}=require('./lib/fake-material-db');
const m=require('./lib/material-evidence');
const {createReviewService}=require('../cloudfunctions/materialWorker/lib/review-evidence');
async function main(){
 const s={_id:'s',status:'approved',resourceId:'r',fileID:'cloud://private',size:1,mimeType:'image/png',
 aiAnalysisConsent:true,aiConsentVersion:'ai-analysis-consent-v1',aiConsentScope:'approved_public_submission_text',
 materialAnalysisConsent:true,materialConsentVersion:'multimodal-material-consent-v1',materialConsentScope:'approved_original_file_extraction',
 materialResearchConsent:true,materialResearchConsentVersion:m.VERSION,materialResearchConsentScope:m.SCOPE,materialExcerptConsent:true};
 const a={status:'needs_review',simulated:false,provider:'tencent_ocr',submissionId:'s',sourceFingerprint:m.fileFingerprint(s),blocks:[{text:'碑刻文字'}]};
 const seed={submissions:{s},material_analyses:{a},resources:{r:{status:'published'}},story_evidence_links:{base:{submissionId:'s',resourceId:'r',status:'confirmed'}}};
 const db=fakeDb(seed),review=createReviewService({db}).review;
 const event={analysisId:'a',decision:'approved',fragments:[{id:'fragment_0',text:'碑刻记录地方修缮经过',usable:true,publicExcerpt:true}]};
 const result=await review(event,'admin');assert.equal(result.evidenceIds.length,1);
 const link=db.data().story_evidence_links[result.evidenceIds[0]];
 assert.equal(await m.materialLinkValid(db,link,s,true),true);
 await assert.rejects(review(event,'admin'),/更新/);
 await review({...event,reviewVersion:1,fragments:[{...event.fragments[0],text:'重新校对后的文字'}]},'admin');
 assert.equal(await m.materialLinkValid(db,link,s),false);
 assert.equal(Object.keys(db.data().material_analysis_logs).length,2);
 const revoked=fakeDb({...seed,submissions:{s:{...s,materialAnalysisConsent:false}}});
 await assert.rejects(createReviewService({db:revoked}).review(event,'admin'),/授权/);
 const mock=fakeDb({...seed,material_analyses:{a:{...a,simulated:true}}});
 assert.equal((await createReviewService({db:mock}).review(event,'admin')).evidenceIds.length,0);
 const failure=fakeDb(seed);failure.failOn('story_evidence_links');
 await assert.rejects(createReviewService({db:failure}).review(event,'admin'),/injected/);
 assert.equal(failure.data().material_analyses.a.status,'needs_review');
 console.log('Material review: atomic fragments, immutable revisions, stale edits, withdrawal and mock exclusion passed.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
