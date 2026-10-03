'use strict';
const assert=require('node:assert/strict');
const {fakeDb}=require('./lib/fake-material-db');
const {fixture,selection}=require('./test-guide-generation');
const {prepareGuideInput}=require('../cloudfunctions/storyWorker/lib/guide-generation-evidence');
const {contextFor,baseFingerprint}=require('../cloudfunctions/storyWorker/lib/guide-source-context');
const {createGuideFragmentService}=require('../cloudfunctions/adminSubmissions/domains/guide-fragments');
async function main(){
 const db=fakeDb(fixture()), service=createGuideFragmentService({db});
 const before=await prepareGuideInput(db,selection);
 assert.equal(before.sources[0].context.kind,'unknown');
 assert.equal(before.sources[0].context.excerptType,'reviewed_evidence_summary');
 const link=db.data().story_evidence_links.l;
 const event={action:'saveGuideSourceContext',sourceLinkId:'l',baseFingerprint:baseFingerprint(link),contextVersion:0,context:{kind:'observation',attribution:'投稿者',qualifiers:[]}};
 await service.handle(event,'admin');
 const after=await prepareGuideInput(db,selection);
 assert.equal(after.sources[0].context.kind,'observation');
 assert.equal(after.sourceFingerprint,before.sourceFingerprint); // Legacy published fingerprints remain stable.
 assert.notEqual(after.sourceContextFingerprint,before.sourceContextFingerprint);
 assert(!JSON.stringify(after).includes('private-user'));
 await assert.rejects(service.handle(event,'admin'),{code:'GUIDE_CONFLICT'});
 const current=db.data().story_evidence_links.l;
 assert.equal(contextFor({...current,version:2}).kind,'unknown');
 assert.equal(contextFor({...current,version:2}).stale,true);
 assert.equal(contextFor({...current,materialAnalysisId:'m',materialKind:'image_ocr'}).kind,'image_ocr');
 await assert.rejects(service.handle({...event,contextVersion:1,context:{kind:'official',qualifiers:['不存在']}},'admin'),{code:'GUIDE_CONTEXT'});
 console.log('Guide source context passed: unknown compatibility, reviewed boundaries, stale versions, material kind, conflict and no private identity.');
}
if(require.main===module)main().catch(e=>{console.error(e);process.exit(1)});
