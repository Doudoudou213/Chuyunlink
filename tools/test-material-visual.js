'use strict';
const assert=require('node:assert/strict');
const {normalizeResult,createProcessingService}=require('../cloudfunctions/materialWorker/lib/processing');
const {validateAgentOutput}=require('../cloudfunctions/storyAgentWorker/lib/contract');
const {fakeDb}=require('./lib/fake-material-db');
async function main(){
const r=normalizeResult('image_observation',{blocks:[{text:'展开的双翼轮廓',region:{x:0.1,y:0.1,width:0.5,height:0.5},uncertainty:'不能确认年代'}]},1);
assert.equal(r[0].uncertainty,'不能确认年代');
assert.throws(()=>normalizeResult('image_observation',{blocks:[{text:'描述',region:{x:0.9,y:0,width:0.5,height:1}}]},1),/区域/);
const db=fakeDb({submissions:{s:{_id:'s',status:'approved',assetType:'image',fileID:'cloud://private',size:10,materialAnalysisConsent:true,materialConsentVersion:'multimodal-material-consent-v1',materialConsentScope:'approved_original_file_extraction'}}});
const x=await createProcessingService({db}).run({submissionId:'s',kind:'image_observation'},'admin');assert.equal(x.simulated,true);
const output={summary:'图片中有可见纹样，仍待核对',entities:[{temporaryId:'entity_1',name:'纹样',entityType:'detail_or_motif',summary:'图片中可见的双翼形纹样',aliases:[]}],relations:[{fromTemporaryId:'entity_1',toResourceId:'r',relationType:'influenced_or_transmitted_to',reason:'推测该纹样由另一地域传播而来',evidenceLinkIds:['v'],confidence:0.8}],missingEvidence:[]};
const context={allowedResourceIds:['r'],allowedEvidenceIds:['v'],observationEvidenceIds:['v']};
assert.throws(()=>validateAgentOutput(output,context),/画面观察/);
output.relations[0].relationType='visually_similar_to';assert.equal(validateAgentOutput(output,context).relations.length,1);
console.log('Visual observations: separate kind, bounded regions, uncertainty, mock processing and historical relation guard passed.');
}main().catch(e=>{console.error(e);process.exitCode=1;});
