'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const {fixture}=require('./test-site-walk');
const {createSiteWalkAdminService}=require('../cloudfunctions/adminSubmissions/domains/site-walks');
const {createSiteWalkService}=require('../cloudfunctions/appCore/domains/site-walks');
async function setup(){
 const {db}=await fixture(),admin=createSiteWalkAdminService({db}),call=e=>admin.handle(e,'admin-test');
 const options=(await call({action:'getSiteWalkDraft',resourceId:'r'})).options;
 const draft={title:'慢看石刻',points:[{id:'p1',...options[0],accessNote:'固定模拟通行核对，不代表真实现场'}]};
 return {db,admin,call,draft,publicService:createSiteWalkService({db})};
}
async function publish(s){
 await s.call({action:'saveSiteWalkDraft',resourceId:'r',revision:0,requestId:'save-1',draft:s.draft});
 const preview=await s.call({action:'previewSiteWalk',resourceId:'r'});
 const request={action:'publishSiteWalk',resourceId:'r',revision:1,requestId:'publish-1',previewFingerprint:preview.previewFingerprint,review:{onsiteConfirmed:true,note:'本地固定核对，仅验证流程',checkedAt:new Date(Date.now()-1000).toISOString(),validUntil:new Date(Date.now()+86400000).toISOString()}};
 return {request,result:await s.call(request)};
}
async function main(){
 assert.equal(fs.readFileSync('cloudfunctions/appCore/lib/site-walk-core.js','utf8'),fs.readFileSync('cloudfunctions/adminSubmissions/lib/site-walk-core.js','utf8'));
 const s=await setup();await assert.rejects(()=>s.admin.handle({action:'getSiteWalkWorkspace'},''),/登录/);
 const {request,result}=await publish(s);assert.equal(result.version,1);assert.deepEqual(await s.call(request),result);
 await assert.rejects(()=>s.call({...request,review:{}}),/重复请求/);
 assert((await s.publicService.get({resourceId:'r'})).available);
 assert.equal((await createSiteWalkService({db:s.db,clock:()=>Date.now()+8*86400000}).get({resourceId:'r'})).available,false);
 const publicJson=JSON.stringify(await s.publicService.get({resourceId:'r'}));assert(!publicJson.includes('admin-test'));assert(!publicJson.includes('private-user'));assert(!publicJson.includes('固定模拟'));
 await assert.rejects(()=>s.call({action:'saveSiteWalkDraft',resourceId:'r',revision:1,requestId:'stale',draft:s.draft}),/另一窗口/);
 await s.call({action:'pauseSiteWalk',resourceId:'r',revision:2,requestId:'pause',pointId:'p1',reason:'观察点临时无法通行'});
 assert.equal((await s.publicService.get({resourceId:'r'})).available,false,'must not fall back to legacy route');
 await s.call({action:'saveSiteWalkDraft',resourceId:'r',revision:3,requestId:'save2',draft:s.draft});
 assert.equal((await s.publicService.get({resourceId:'r'})).available,false);
 const preview=await s.call({action:'previewSiteWalk',resourceId:'r'});
 await s.call({...request,revision:4,requestId:'publish2',previewFingerprint:preview.previewFingerprint});
 assert.equal((await s.publicService.get({resourceId:'r'})).walk.version,2);
 assert.equal(Object.keys(s.db.data().site_walk_versions).length,2);
 await s.db.collection('submissions').doc('s').update({aiConsentRevokedAt:'now'});
 assert.equal((await s.publicService.get({resourceId:'r'})).available,false);
 const t=await setup();await t.call({action:'saveSiteWalkDraft',resourceId:'r',revision:0,requestId:'save',draft:t.draft});
 assert.equal((await t.publicService.get({resourceId:'r'})).available,false,'draft masks inline legacy');
 const p=await t.call({action:'previewSiteWalk',resourceId:'r'});
 await assert.rejects(()=>t.call({...request,previewFingerprint:p.previewFingerprint,review:{...request.review,onsiteConfirmed:false}}),/确认每处/);
 t.db.failOn('site_walk_logs');await assert.rejects(()=>t.call({...request,previewFingerprint:p.previewFingerprint}),/injected/);assert.equal(Object.keys(t.db.data().site_walk_versions).length,0,'atomic rollback');
 t.db.failOn('');await t.db.collection('submissions').doc('s').update({status:'rejected'});
 await assert.rejects(()=>t.call({...request,previewFingerprint:p.previewFingerprint}),/来源/);
 const concurrent=await setup();const outcomes=await Promise.allSettled(['one','two'].map(requestId=>concurrent.call({action:'saveSiteWalkDraft',resourceId:'r',revision:0,requestId,draft:concurrent.draft})));
 assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);assert.equal(outcomes.filter(r=>r.status==='rejected'&&r.reason.code==='WALK_CONFLICT').length,1);
 console.log('Site walk administration passed: review gate, current evidence, preview binding, conflicts, retries, immutable versions, pause, withdrawal, atomic rollback and private projection.');
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});module.exports={setup,publish};
