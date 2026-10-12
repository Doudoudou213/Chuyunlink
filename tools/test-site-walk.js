'use strict';
const assert=require('node:assert/strict');
const {fakeDb}=require('./lib/fake-material-db'),{seed}=require('./test-guide-evidence');
const {createGuideFragmentService}=require('../cloudfunctions/adminSubmissions/domains/guide-fragments');
const {createCulturalGuideService}=require('../cloudfunctions/appCore/domains/cultural-guide');
const {createSiteWalkService}=require('../cloudfunctions/appCore/domains/site-walks');
const E=require('../static/site-walk-engine');
async function fixture(){
 const db=fakeDb(seed()),admin=createGuideFragmentService({db});
 const draft=(await admin.handle({action:'saveGuideFragment',draft:{resourceId:'r',storyId:'story',storyVersion:1,claimIds:['c'],title:'石刻观察',text:'这份已经确认的材料记录了可见的石刻，可展开来源阅读记录。',observations:[{text:'观察材料记录的石刻。',locator:'材料记录的石刻',locationEvidence:'l'}]}},'test-admin')).draft;
 await admin.handle({action:'publishGuideFragment',fragmentId:draft.id,revision:draft.revision,humanReviewed:true,reviewNote:'仅本地模拟审核，不代表现场核实'},'test-admin');
 const g=(await createCulturalGuideService({db}).station({resourceId:'r'})).items[0];
 const route={id:'walk-r',status:'published',version:1,review:{onsiteConfirmed:true,reviewedBy:'test-admin',checkedAt:new Date(Date.now()-1000).toISOString(),validUntil:new Date(Date.now()+86400000).toISOString()},points:[{id:'point1',title:'石刻',guideVersionId:g.versionId,observationIndex:0,accessConfirmed:true}]};
 await db.collection('resources').doc('r').update({siteWalk:route});return {db,route};
}
async function main(){
 const {db,route}=await fixture(),service=createSiteWalkService({db});const result=await service.get({resourceId:'r'});assert(result.available);assert(!JSON.stringify(result).includes('private-user'));assert(!JSON.stringify(result).includes('test-admin'));
 const w=result.walk;w.points.push({...w.points[0],id:'point2'});
 let s=E.create(w,'local');assert.throws(()=>E.act(s,w,'complete'));s=E.act(s,w,'arrive');assert.equal(E.summary(s).visited,0);s=E.act(s,w,'complete');assert.equal(E.current(s).resourceId,'point2');s=E.act(s,w,'skip');assert.equal(s.status,'ended');assert.deepEqual(E.summary(s),{visited:1,arrived:0,skipped:1,planned:0,simulated:false});assert.throws(()=>E.act(s,w,'arrive'));
 const partial=E.act(E.create(w,'two'),w,'end');assert.equal(E.summary(partial).visited,0);assert.equal(E.summary(partial).planned,2);assert(!JSON.stringify(E.snapshot(s)).includes('石刻'));
 assert.throws(()=>E.act(E.create(w,'three'),{...w,fingerprint:'changed'},'arrive'));
 for(const change of [{status:'draft'},{simulated:true},{review:{...route.review,onsiteConfirmed:false}},{review:{...route.review,validUntil:new Date(0).toISOString()}},{points:[{...route.points[0],accessConfirmed:false}]},{points:[{...route.points[0],guideVersionId:'old'}]},{points:[{...route.points[0],observationIndex:8}]}]){await db.collection('resources').doc('r').update({siteWalk:{...route,...change}});assert.equal((await service.get({resourceId:'r'})).available,false);}
 await db.collection('resources').doc('r').update({siteWalk:route});await db.collection('submissions').doc('s').update({aiConsentRevokedAt:'now'});assert.equal((await service.get({resourceId:'r'})).available,false);
 console.log('Site walk passed: current public evidence, field review/expiry, draft/mock rejection, pinned version, manual arrival, skip/end, minimal private snapshot and withdrawal.');
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});module.exports={fixture};
