'use strict';
const assert=require('node:assert/strict');
const m=require('./lib/material-evidence');
async function main(){
const s={_id:'s',status:'approved',fileID:'cloud://private/image',size:10,mimeType:'image/png',
materialAnalysisConsent:true,materialConsentVersion:'multimodal-material-consent-v1',materialConsentScope:'approved_original_file_extraction',
aiAnalysisConsent:true,aiConsentVersion:'ai-analysis-consent-v1',aiConsentScope:'approved_public_submission_text',
materialResearchConsent:true,materialResearchConsentVersion:m.VERSION,materialResearchConsentScope:m.SCOPE,materialExcerptConsent:true};
assert.equal(m.hasResearchConsent({...s,materialResearchConsent:undefined}),false);
const a={status:'approved',simulated:false,usableForStory:true,submissionId:'s',sourceFingerprint:m.fileFingerprint(s),reviewVersion:1,reviewedFragments:[{id:'f',text:'校对文字',usable:true,publicExcerpt:true}]};
const db={collection:()=>({doc:()=>({get:async()=>({data:[a]})})})};
const l={status:'confirmed',sourceType:'material_fragment',submissionId:'s',materialAnalysisId:'a',materialReviewVersion:1,materialFragmentId:'f',evidenceSummary:'校对文字'};
assert.equal(await m.materialLinkValid(db,l,s,true),true);
for(const patch of [{materialAnalysisConsent:false},{materialResearchConsent:false},{aiAnalysisConsent:false},{materialConsentRevokedAt:'now'},{fileID:'cloud://changed'}]) assert.equal(await m.materialLinkValid(db,l,{...s,...patch}),false);
assert.equal(await m.materialLinkValid(db,l,{...s,materialExcerptConsent:false},true),false);
assert.equal(await m.materialLinkValid(db,{...l,materialReviewVersion:2},s),false);
a.simulated=true;assert.equal(await m.materialLinkValid(db,l,s),false);
console.log('Material evidence: explicit consent, revocation, file/version changes, public scope and mock exclusion passed.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
