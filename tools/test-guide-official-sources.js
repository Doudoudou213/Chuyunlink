'use strict';
const assert=require('node:assert/strict');
const {setup}=require('./test-guide-generation-review');
const {createOfficialSourceService,passages}=require('../cloudfunctions/adminSubmissions/domains/guide-official-sources');
const {createCulturalGuideService}=require('../cloudfunctions/appCore/domains/cultural-guide');
const {allowedUrl,ARTICLES,catalogSearch}=require('../cloudfunctions/adminSubmissions/lib/official-source-registry');
const {extractArticle,publicIPv4}=require('../cloudfunctions/adminSubmissions/lib/official-source-fetch');
const {publicView}=require('../cloudfunctions/adminSubmissions/lib/guide-official-evidence');
const url=ARTICLES[0].url;
const html='<html><title>测试原文</title><script>不得提取这个脚本</script><main><p>材料记录了可见的石刻。这是专门用于本地测试的固定响应，并非实际官网内容。</p></main></html>';
async function prepared(options={}) {
 const x=await setup();await x.db.collection('resources').doc('r').update({title:'黄鹤楼'});
 let calls=0;
 const service=createOfficialSourceService({db:x.db,mode:'catalog',fetchPage:async u=>{calls++;return {url:u,html};},...options});
 const event={action:'searchGuideOfficialSources',fragmentId:x.fragmentId,revision:1};
 return {...x,service,event,calls:()=>calls};
}
function publish(x,search,extra={}){return x.admin.handle({action:'publishGuideFragment',fragmentId:x.fragmentId,revision:1,humanReviewed:true,humanRating:'correct',reviewNote:'本地固定响应核对，不是实际来源审核',officialReview:{searchId:search.id,selectedIds:search.items.map(i=>i.id),supportReviewed:true,publicExcerptAllowed:true,...extra}},'admin');}
async function main(){
 assert.equal(catalogSearch('武汉黄鹤楼').length,1);assert.equal(catalogSearch('编钟').length,0);
 for(const bad of ['http://ylj.wuhan.gov.cn/a.html','https://ylj.wuhan.gov.cn.evil.example/a.html','https://evil.example/a.html','https://127.0.0.1/a.html','https://u:p@ylj.wuhan.gov.cn/a.html','https://ylj.wuhan.gov.cn:8443/a.html','https://ylj.wuhan.gov.cn/a.html?token=private','https://ylj.wuhan.gov.cn/a.html#private'])assert.equal(allowedUrl(bad),null);
 for(const bad of ['127.0.0.1','10.0.0.1','169.254.169.254','172.16.0.1','192.168.1.1','100.64.0.1','::1','224.1.1.1','999.1.1.1'])assert.equal(publicIPv4(bad),false);
 assert.equal(publicIPv4('1.1.1.1'),true);
 assert.equal(extractArticle({url,html}).paragraphs.length,1);
 assert(!JSON.stringify(extractArticle({url,html})).includes('不得提取'));
 const long='这是一句用于本地解析回归的背景材料。'.repeat(30)+'晴川阁与黄鹤楼隔江相望，可对照材料阅读。';
 const longArticle=extractArticle({url,html:'<main><p>'+long+'</p></main>'});assert.equal(longArticle.paragraphs[0].text,long);const anchored=passages(longArticle.paragraphs).find(p=>p.quote.includes('晴川阁'));assert(anchored);assert.equal(anchored.text.slice(anchored.quoteStart,anchored.quoteEnd),anchored.quote);assert(anchored.quote.length<=400);
 const disabled=await prepared({mode:'off'});await assert.rejects(disabled.service.handle(disabled.event,'a'),{code:'OFFICIAL_DISABLED'});assert.equal(disabled.calls(),0);
 const x=await prepared();const {search}=await x.service.handle(x.event,'admin');assert.equal(search.items.length,1);assert.equal(search.items[0].paragraph,1);
 assert.equal((await x.service.handle(x.event,'admin')).cached,true);assert.equal(x.calls(),1);
 assert.equal((await createCulturalGuideService({db:x.db}).station({resourceId:'r'})).items.length,0);
 await assert.rejects(publish(x,search,{supportReviewed:false}),{code:'OFFICIAL_REVIEW'});
 await assert.rejects(publish(x,search,{publicExcerptAllowed:false}),{code:'OFFICIAL_REVIEW'});
 await assert.rejects(publish(x,search,{selectedIds:['invented']}),{code:'GUIDE_SOURCE_INVALID'});
 await publish(x,search);const pub=createCulturalGuideService({db:x.db});let f=(await pub.station({resourceId:'r'})).items[0];assert.equal(f.officialEvidence.state,'verified');assert.equal(f.officialEvidence.items[0].quote,search.items[0].quote);assert(!JSON.stringify(f).includes('private-user'));assert(!JSON.stringify(f.officialEvidence).includes('reviewer'));
 assert.equal(publicView({state:'verified',items:search.items},['c','missing']).state,'unmatched');
 await x.db.collection('guide_official_searches').doc(search.id).update({validUntil:1});f=(await pub.station({resourceId:'r'})).items[0];assert.equal(f.officialEvidence.state,'expired');assert.equal(f.officialEvidence.items.length,0);
 await x.db.collection('guide_official_searches').doc(search.id).update({status:'unavailable'});assert.equal((await pub.station({resourceId:'r'})).items.length,0);
 const changed=await prepared();const saved=await changed.service.handle(changed.event,'admin');await changed.db.collection('guide_fragments').doc(changed.fragmentId).update({title:'已改标题'});await assert.rejects(publish(changed,saved.search),{code:'GUIDE_SOURCE_INVALID'});
 const mock=await prepared({simulated:true});await assert.rejects(publish(mock,(await mock.service.handle(mock.event,'a')).search),{code:'GUIDE_SOURCE_INVALID'});
 const revoked=await prepared();const r=await revoked.service.handle(revoked.event,'a');await revoked.db.collection('submissions').doc('s').update({aiConsentRevokedAt:'now'});await assert.rejects(publish(revoked,r.search),{code:'GUIDE_SOURCE_INVALID'});
 const race=await prepared();const raced=createOfficialSourceService({db:race.db,mode:'catalog',fetchPage:async u=>{await race.db.collection('submissions').doc('s').update({aiConsentRevokedAt:'now'});return {url:u,html};}});await assert.rejects(raced.handle(race.event,'a'),{code:'GUIDE_SOURCE_INVALID'});assert.equal(Object.keys(race.db.data().guide_official_searches||{}).length,0);
 const privacy=await prepared({search:async q=>{assert.equal(q,'黄鹤楼');assert(!q.includes('private-user'));return ['https://evil.example/a.html'];}});const no=await privacy.service.handle(privacy.event,'a');assert.equal(privacy.calls(),0);assert.equal(no.search.items.length,0);
 const errors=await prepared({fetchPage:async()=>{throw Object.assign(Error('private provider error'),{code:'NETWORK'});}});const failed=await errors.service.handle(errors.event,'a');assert.equal(failed.search.failures[0].code,'OFFICIAL_UNAVAILABLE');assert(!JSON.stringify(failed).includes('private provider error'));
 const tampered=await prepared();const t=(await tampered.service.handle(tampered.event,'a')).search;await tampered.db.collection('guide_official_searches').doc(t.id).update({items:[{...t.items[0],quote:'tampered'}]});await assert.rejects(publish(tampered,t),{code:'GUIDE_SOURCE_INVALID'});
 const refreshed=await prepared();const rs=(await refreshed.service.handle(refreshed.event,'a')).search;await publish(refreshed,rs);const refresh={action:'refreshGuideOfficialSources',fragmentId:refreshed.fragmentId,revision:2};
 assert.equal((await refreshed.service.handle(refresh,'a')).state,'unchanged');
 const oldExpiry=refreshed.db.data().guide_official_searches[rs.id].validUntil;
 const timeout=createOfficialSourceService({db:refreshed.db,mode:'catalog',fetchPage:async()=>{throw Object.assign(Error('timeout'),{code:'OFFICIAL_TIMEOUT'});}});assert.equal((await timeout.handle(refresh,'a')).state,'check_failed');assert.equal(refreshed.db.data().guide_official_searches[rs.id].validUntil,oldExpiry);
 const rewrite=createOfficialSourceService({db:refreshed.db,mode:'catalog',fetchPage:async u=>({url:u,html:html.replace('可见的石刻','已经修订的原文')})});assert.equal((await rewrite.handle(refresh,'a')).state,'needs_review');assert.equal((await createCulturalGuideService({db:refreshed.db}).station({resourceId:'r'})).items.length,0);
 console.log('Official sources passed: exact host catalog, address/URL restrictions, parsed anchors, candidate-only, human/public approval, no fabricated green, stale edits, consent race, source expiry/unavailability, mock isolation, privacy and cache. Fixed pages only; no live service.');
}
if(require.main===module)main().catch(e=>{console.error(e);process.exit(1)});
module.exports={prepared,publish,html,url};
