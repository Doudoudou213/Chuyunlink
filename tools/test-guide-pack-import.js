'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const {fakeDb}=require('./lib/fake-material-db');
const {createGuidePackService}=require('../cloudfunctions/adminSubmissions/domains/guide-packs');
const {createCulturalGuideService}=require('../cloudfunctions/appCore/domains/cultural-guide');
const {createGuideFragmentService}=require('../cloudfunctions/adminSubmissions/domains/guide-fragments');
const {resolve}=require('../cloudfunctions/appCore/domains/visit-records');
const bundle=require('../cloudfunctions/adminSubmissions/data/guide-pack.v1.json');
const root=require('node:path').resolve(__dirname,'..');
function seed(){return {resources:Object.fromEntries(bundle.records.map(r=>[r.id,{id:r.id,type:'landmark',title:r.title,status:'published'}]))};}
function review(d){return {action:'publishGuidePackDraft',fragmentId:d.id,revision:d.revision,evidenceFingerprint:d.sourceFingerprint,bindingConfirmed:true,factsConfirmed:true,paraphraseConfirmed:true,reviewedSourceIds:d.reviewEvidence.sources.map(s=>s.id),reviewNote:'本地测试固定审核响应，不代表真实审核',groundingResolution:{fingerprint:d.grounding.fingerprint,reasons:Object.fromEntries(d.grounding.issues.filter(i=>i.severity==='warning').map(i=>[i.id,'本地测试保留说明，真实审核仍未进行']))}};}
async function fixture(db=fakeDb(seed()),recordId='yellow-crane-tower'){
 const service=createGuidePackService({db}),publicService=createCulturalGuideService({db});
 const p=await service.handle({action:'previewGuidePack',recordId},'local-admin');
 const imported=await service.handle({action:'importGuidePack',recordId,fingerprint:p.fingerprint,bindingConfirmed:true},'local-admin');
 const draft=(await service.handle({action:'getGuidePackDraft',fragmentId:imported.fragmentIds[0]},'local-admin')).draft;
 return {db,service,publicService,p,imported,draft};
}
async function main(){
 assert.deepEqual(bundle,JSON.parse(fs.readFileSync(root+'/docs/content-packs/all-points-guide-v1.json','utf8')));
 assert.equal(fs.readFileSync(root+'/cloudfunctions/adminSubmissions/lib/guide-pack-evidence.js','utf8'),fs.readFileSync(root+'/cloudfunctions/appCore/lib/guide-pack-evidence.js','utf8'));
 let {db,service,publicService,p,imported,draft}=await fixture();
 const catalog=await service.handle({action:'getGuidePackCatalog'},'local-admin');assert.equal(catalog.records.length,19);
 await assert.rejects(service.handle({action:'getGuidePackCatalog'},''),{code:'FORBIDDEN'});
 assert.equal((await publicService.station({resourceId:draft.resourceId})).items.length,0);
 assert.equal((await createGuideFragmentService({db}).handle({action:'getGuideWorkspace'},'admin')).fragments.length,0);
 await assert.rejects(createGuideFragmentService({db}).handle({action:'archiveGuideFragment',fragmentId:draft.id,revision:draft.revision},'admin'),{code:'GUIDE_SCOPE'});
 await assert.rejects(service.handle({action:'importGuidePack',recordId:'yellow-crane-tower',fingerprint:'stale',bindingConfirmed:true},'admin'),{code:'GUIDE_CONFLICT'});
 assert.equal((await service.handle({action:'importGuidePack',recordId:'yellow-crane-tower',fingerprint:p.fingerprint,bindingConfirmed:true},'admin')).alreadyImported,true);
 assert.equal(Object.keys(db.data().guide_fragments).length,2);
 for(const r of bundle.records.filter(r=>r.status!=='draft_ready')){
   const q=await service.handle({action:'previewGuidePack',recordId:r.id},'admin');assert.equal(q.canImport,false);
   await assert.rejects(service.handle({action:'importGuidePack',recordId:r.id,fingerprint:q.fingerprint,bindingConfirmed:true},'admin'),{code:'GUIDE_PACK_INELIGIBLE'});
 }
 assert.equal((await service.handle({action:'previewGuidePack',recordId:'yellow-crane-tower',resourceId:'missing'},'admin')).canImport,false);
 const good=review(draft);
 for(const patch of [{factsConfirmed:false},{bindingConfirmed:false},{paraphraseConfirmed:false},{reviewedSourceIds:[]},{evidenceFingerprint:'stale'},{reviewNote:'短'}]){
   await assert.rejects(service.handle({...good,...patch},'admin'));
   assert.equal((await publicService.station({resourceId:draft.resourceId})).items.length,0);
 }
 await assert.rejects(service.handle({action:'saveGuidePackDraft',fragmentId:draft.id,revision:1,draft:{resourceId:'other'}},'admin'),{code:'GUIDE_SCOPE'});
 await assert.rejects(service.handle({action:'saveGuidePackDraft',fragmentId:draft.id,revision:1,draft:{title:draft.title,interests:[],sentences:[{text:'外部无依据的讲解内容，不能引用另外一个点位的事实。',claimIds:['other-f1']}]}},'admin'),{code:'GUIDE_OUTPUT_INVALID'});
 await service.handle(good,'admin');
 let pub=(await publicService.station({resourceId:draft.resourceId})).items[0];assert(pub);assert.equal(pub.evidenceKind,'official_pack');
 assert.equal(pub.storyId,undefined);assert.equal(pub.sources[0].contributorName,'官方公开资料整理，非用户投稿');
 assert(!JSON.stringify(pub).includes('local-admin'));assert(!JSON.stringify(pub).includes('reviewNote'));assert(!('quote' in pub.officialEvidence.items[0]));
 assert.equal((await resolve(db,{kind:'guide',targetId:pub.id,resourceId:pub.resourceId},{stops:[{resourceId:pub.resourceId}]})).version,pub.versionId);
 assert.equal(await resolve(db,{kind:'guide',targetId:pub.id,resourceId:pub.resourceId},{stops:[]}),null);
 const firstVersion=pub.versionId,source=draft.reviewEvidence.sources[0];
 draft=(await service.handle({action:'getGuidePackDraft',fragmentId:draft.id},'admin')).draft;
 await service.handle({action:'disableGuidePackSource',fragmentId:draft.id,revision:draft.revision,sourceId:source.id,sourceVersion:source.version,reviewNote:'测试来源失效，暂停公开全部关联讲解'},'admin');
 assert.equal((await publicService.station({resourceId:draft.resourceId})).items.length,0);
 assert.equal(await resolve(db,{kind:'guide',targetId:pub.id,resourceId:pub.resourceId},{stops:[{resourceId:pub.resourceId}]}),null);
 draft=(await service.handle({action:'getGuidePackDraft',fragmentId:draft.id},'admin')).draft;
 await service.handle(review(draft),'admin');
 assert.equal((await publicService.station({resourceId:draft.resourceId})).items.length,1);
 assert(db.data().guide_fragment_versions[firstVersion]);
 await db.collection('guide_reference_sources').doc(source.id).update({validUntil:'2000-01-01T00:00:00Z'});
 assert.equal((await publicService.station({resourceId:draft.resourceId})).items.length,0);
 draft=(await service.handle({action:'getGuidePackDraft',fragmentId:draft.id},'admin')).draft;await service.handle(review(draft),'admin');
 await db.collection('resources').doc(draft.resourceId).update({status:'archived'});
 assert.equal((await publicService.station({resourceId:draft.resourceId})).items.length,0);
 await db.collection('resources').doc(draft.resourceId).update({status:'published'});
 draft=(await service.handle({action:'getGuidePackDraft',fragmentId:draft.id},'admin')).draft;
 await service.handle({action:'archiveGuidePackDraft',fragmentId:draft.id,revision:draft.revision},'admin');
 assert.equal((await publicService.station({resourceId:draft.resourceId})).items.length,0);
 assert(db.data().guide_fragment_versions[firstVersion]);assert.equal(Object.keys(db.data().submissions||{}).length,0);
 assert.equal(Object.keys(db.data().story_chains||{}).length,0);
 // Catalog changes and concurrent retries cannot silently change resource mappings or overwrite manual edits.
 const isolated=fakeDb(seed());isolated.failOn('guide_fragments');
 await assert.rejects(fixture(isolated));assert.equal(Object.keys(isolated.data().guide_content_packages||{}).length,0);
 for(const r of bundle.records.filter(r=>r.status==='draft_ready')){
   const f=await fixture(fakeDb(seed()),r.id);await f.service.handle(review(f.draft),'admin');
   const item=(await f.publicService.station({resourceId:r.id})).items[0];assert(item,r.id);
   if(r.id==='wuhan-art-hankou-exterior')assert(item.visitNotice.includes('闭馆'));
 }
 // Shared-source invalidation cannot revive a different old interest version after re-review.
 const shared=await fixture();
 const second=(await shared.service.handle({action:'getGuidePackDraft',fragmentId:shared.imported.fragmentIds[1]},'admin')).draft;
 await shared.service.handle(review(shared.draft),'admin');await shared.service.handle(review(second),'admin');
 assert.equal((await shared.publicService.station({resourceId:shared.draft.resourceId})).items.length,2);
 const latest=(await shared.service.handle({action:'getGuidePackDraft',fragmentId:shared.draft.id},'admin')).draft;
 const src=latest.reviewEvidence.sources[0];
 await shared.service.handle({action:'disableGuidePackSource',fragmentId:latest.id,revision:latest.revision,sourceId:src.id,sourceVersion:src.version,reviewNote:'同源两份讲解停用测试，等待重新核对'},'admin');
 assert.equal((await shared.publicService.station({resourceId:latest.resourceId})).items.length,0);
 const renewed=(await shared.service.handle({action:'getGuidePackDraft',fragmentId:latest.id},'admin')).draft;
 await shared.service.handle(review(renewed),'admin');
 const renewedItems=(await shared.publicService.station({resourceId:latest.resourceId})).items;
 assert.equal(renewedItems.length,1);assert.equal(renewedItems[0].id,latest.id);
 // Retry must not overwrite an edited draft. Source content and resource changes invalidate previews.
 const edited=(await shared.service.handle({action:'getGuidePackDraft',fragmentId:latest.id},'admin')).draft;
 await shared.service.handle({action:'saveGuidePackDraft',fragmentId:edited.id,revision:edited.revision,draft:{title:'黄鹤楼讲解待审新版',sentences:edited.sentences,interests:['建筑']}},'admin');
 await shared.service.handle({action:'importGuidePack',recordId:'yellow-crane-tower',fingerprint:shared.p.fingerprint,bindingConfirmed:true},'admin');
 const preserved=(await shared.service.handle({action:'getGuidePackDraft',fragmentId:edited.id},'admin')).draft;
 assert.equal(preserved.title,'黄鹤楼讲解待审新版');
 await assert.rejects(shared.service.handle({...review(edited)},'admin'),{code:'GUIDE_CONFLICT'});
 await shared.db.collection('resources').doc('yellow-crane-tower').update({title:'已修改名称'});
 await assert.rejects(shared.service.handle({action:'importGuidePack',recordId:'yellow-crane-tower',fingerprint:shared.p.fingerprint,bindingConfirmed:true},'admin'),{code:'GUIDE_CONFLICT'});
 // No reserved CloudBase document IDs are sent back through set().
 for(const table of ['guide_fragments','guide_fragment_versions'])for(const record of Object.values(shared.db.data()[table]||{}))assert(!('_id' in record));

 console.log('Guide pack tests passed: 19 previews, 13 eligible point flows, review gates, idempotence, scope, rollback, source disable/expiry, privacy, archive and private bookmarks. Local fake DB only.');
}
if(require.main===module)main().catch(e=>{console.error(e);process.exit(1)});module.exports={seed,review,fixture};
