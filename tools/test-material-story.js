'use strict';
const assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const {fakeDb}=require('./lib/fake-material-db'),m=require('./lib/material-evidence');
const source=fs.readFileSync(require.resolve('../cloudfunctions/storyWorker/index.js'),'utf8');
async function main(){
const s={_id:'s',status:'approved',fileID:'cloud://private',size:1,mimeType:'image/png',description:'投稿描述',
aiAnalysisConsent:true,aiConsentVersion:'ai-analysis-consent-v1',aiConsentScope:'approved_public_submission_text',
materialAnalysisConsent:true,materialConsentVersion:'multimodal-material-consent-v1',materialConsentScope:'approved_original_file_extraction',
materialResearchConsent:true,materialResearchConsentVersion:m.VERSION,materialResearchConsentScope:m.SCOPE};
const text='碑刻记载了当地居民参与修缮的经过';
const link={status:'confirmed',resourceId:'r',submissionId:'s',sourceType:'material_fragment',materialAnalysisId:'a',materialReviewVersion:1,materialFragmentId:'f',materialKind:'image_ocr',materialLocator:{type:'image_region',blockIndex:0},evidenceSummary:text};
const db=fakeDb({submissions:{s},story_evidence_links:{l:link},material_analyses:{a:{status:'approved',simulated:false,usableForStory:true,submissionId:'s',sourceFingerprint:m.fileFingerprint(s),reviewVersion:1,reviewedFragments:[{id:'f',text,usable:true}]}}});
const code=source.slice(source.indexOf('async function loadSectionSources('),source.indexOf('async function buildSectionRevisionInput('));
const load=vm.runInNewContext(code+';loadSectionSources',{...m,LINK_COLLECTION:'story_evidence_links',SUBMISSION_COLLECTION:'submissions',firstDocument:m.first,hasCurrentAiConsent:x=>x&&x.aiAnalysisConsent,cleanText:(x,n)=>String(x||'').slice(0,n)});
const sources=await load(db,'r',['l']);assert.equal(sources[0].submission.description,text);assert.equal(sources[0].materialReference.locator.blockIndex,0);
assert.equal(JSON.stringify(sources).includes('cloud://'),false);
db.data().material_analyses.a.reviewVersion=2;await assert.rejects(load(db,'r',['l']),/来源/);
db.data().material_analyses.a.reviewVersion=1;db.data().submissions.s.materialResearchConsent=false;await assert.rejects(load(db,'r',['l']),/来源/);
console.log('Material story sources: reviewed fragment input, locator, privacy, changed version and withdrawal passed.');
}main().catch(e=>{console.error(e);process.exitCode=1;});
