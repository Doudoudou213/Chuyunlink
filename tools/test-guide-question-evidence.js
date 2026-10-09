'use strict';
const assert = require('node:assert/strict');
const {fakeDb} = require('./lib/fake-material-db');
const {seed} = require('./test-guide-evidence');
const {createGuideFragmentService} = require('../cloudfunctions/adminSubmissions/domains/guide-fragments');
const {loadEvidence,input} = require('../cloudfunctions/appCore/lib/guide-question-evidence');
async function fixture() {
 const db=fakeDb(seed()), admin=createGuideFragmentService({db});
 const saved=await admin.handle({action:'saveGuideFragment',draft:{resourceId:'r',storyId:'story',storyVersion:1,claimIds:['c'],title:'看见石刻',text:'这份已经确认的材料记录了可见的石刻，可展开来源阅读记录。',observations:[]}},'admin');
 await admin.handle({action:'publishGuideFragment',fragmentId:saved.draft.id,revision:1,humanReviewed:true,reviewNote:'逐条核对事实与来源'},'admin');
 await db.collection('submissions').doc('s').update({aiAnalysisConsent:true,aiConsentVersion:'ai-analysis-consent-v1',aiConsentScope:'approved_public_submission_text'});
 return db;
}
async function main(){
 const db=await fixture(); const a=await loadEvidence(db,'r');assert.equal(a.pieces.length,1);assert(!JSON.stringify(a).includes('private-user'));
 await db.collection('submissions').doc('s').update({aiAnalysisConsent:false});assert.equal((await loadEvidence(db,'r')).pieces.length,0);
 await db.collection('submissions').doc('s').update({aiAnalysisConsent:true,aiConsentVersion:'old'});assert.equal((await loadEvidence(db,'r')).pieces.length,0);
 await db.collection('submissions').doc('s').update({aiConsentVersion:'ai-analysis-consent-v1',aiConsentRevokedAt:'now'});assert.equal((await loadEvidence(db,'r')).pieces.length,0);
 await db.collection('resources').doc('r').update({disabledAt:'now'});await assert.rejects(loadEvidence(db,'r'),{code:'QA_SOURCE'});
 assert.throws(()=>input({resourceId:'r',question:'问题',requestId:'bad'}));assert.throws(()=>input({resourceId:'r',question:'问题',requestId:'a'.repeat(16),history:[{role:'system'}]}));
 console.log('Question evidence: publication, AI consent/version/withdrawal, resource state, privacy and input boundaries passed.');
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});module.exports={fixture};

