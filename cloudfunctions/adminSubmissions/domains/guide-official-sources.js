'use strict';
const crypto=require('node:crypto');
const {read,checkGuideEvidence}=require('../lib/guide-evidence');
const {hash}=require('../lib/guide-source-context');
const {fingerprint}=require('../lib/guide-official-evidence');
const {catalogSearch,allowedUrl}=require('../lib/official-source-registry');
const {fetchOfficial,extractArticle}=require('../lib/official-source-fetch');
const fail=(code,message)=>{throw Object.assign(Error(message),{code});};
const grams=s=>new Set((String(s).match(/[\p{L}\p{N}]+/gu)||[]).flatMap(w=>Array.from({length:Math.max(0,w.length-1)},(_,i)=>w.slice(i,i+2))));
function score(a,b){const x=grams(a),y=grams(b);return [...x].filter(g=>y.has(g)).length/Math.max(1,x.size);}
function passages(paragraphs){return paragraphs.flatMap(p=>p.text.length<=400?[{...p,quote:p.text,quoteStart:0,quoteEnd:p.text.length}]:[...p.text.matchAll(/[^。！？]+[。！？]?/gu)].filter(m=>m[0].length>=12&&m[0].length<=400).map(m=>({...p,quote:m[0],quoteStart:m.index,quoteEnd:m.index+m[0].length})));}
function createOfficialSourceService({db,mode=process.env.OFFICIAL_SOURCE_MODE||'off',search=catalogSearch,fetchPage=fetchOfficial,simulated=false,now=Date.now}) {
  async function draft(e,database=db){if(!/^[\w-]{1,128}$/.test(e.fragmentId||''))fail('GUIDE_ID','先保存讲解草稿');const f=await read(database,'guide_fragments',e.fragmentId);if(!f||f.status!=='draft'||f.revision!==Number(e.revision))fail('GUIDE_CONFLICT','请读取最新草稿后再检索');if(f.needsSourceReview)fail('GUIDE_SOURCE_INVALID','来源待复核');const checked=await checkGuideEvidence(database,f);return {f,checked};}
  async function handle(e,reviewer){
    if(e.action==='refreshGuideOfficialSources'){
      if(mode!=='catalog')fail('OFFICIAL_DISABLED','官网检索尚未启用');
      if(!/^[\w-]{1,128}$/.test(e.fragmentId||''))fail('GUIDE_ID','讲解编号无效');
      const root=await read(db,'guide_fragments',e.fragmentId);
      if(!root||root.status==='archived'||root.revision!==Number(e.revision)||!root.publishedVersionId)fail('GUIDE_CONFLICT','请重新读取已发布讲解');
      const version=await read(db,'guide_fragment_versions',root.publishedVersionId);
      if(!version||version.status!=='published')fail('GUIDE_SOURCE_INVALID','已发布讲解版本不可用');
      await checkGuideEvidence(db,version);
      const searchId=version.officialEvidence?.searchId,row=searchId?await read(db,'guide_official_searches',searchId):null;
      if(!row||row.status!=='active'||row.simulated)fail('OFFICIAL_REVIEW','此版本没有可更新的官网依据，请保存新草稿重新检索');
      const selected=row.items.filter(i=>version.officialEvidence.selectedIds.includes(i.id));
      const urls=[...new Set(selected.map(i=>i.url))];if(!urls.length||urls.length>3)fail('OFFICIAL_REVIEW','官网记录不完整');
      let state='unchanged';
      for(const url of urls){
        await checkGuideEvidence(db,version);
        try{const article=extractArticle(await fetchPage(url));if(selected.some(i=>i.url===url&&(i.url!==article.url||i.pageHash!==article.pageHash)))state='needs_review';}
        catch(err){if(err.code==='OFFICIAL_GONE')state='needs_review';else if(state==='unchanged')state='check_failed';}
      }
      await db.runTransaction(async tx=>{const current=await read(tx,'guide_fragments',e.fragmentId);if(current?.revision!==root.revision||current?.publishedVersionId!==root.publishedVersionId)fail('GUIDE_CONFLICT','讲解版本已变化');await checkGuideEvidence(tx,version);const fresh=await read(tx,'guide_official_searches',searchId);if(!fresh||fresh.status!=='active'||fresh.digest!==row.digest)fail('GUIDE_CONFLICT','原文记录已变化');if(state!=='check_failed')await tx.collection('guide_official_searches').doc(searchId).update(state==='needs_review'?{status:'needs_review'}:{validUntil:now()+7*86400000,lastCheckedAt:new Date(now()).toISOString()});await tx.collection('guide_fragment_logs').add({action:e.action,fragmentId:root.id,searchId,state,reviewer,createdAt:db.serverDate()});});
      return {ok:true,state,message:state==='unchanged'?'官网原文未变化，已更新核对记录':state==='needs_review'?'原文已变化或下架，相关讲解已停止公开，请保存新草稿核对':'暂时无法读取官网，未延长旧依据的有效期'};
    }
    const {f,checked}=await draft(e);
    if(e.action==='getGuideOfficialSources'){
      const row=f.officialSearchId?await read(db,'guide_official_searches',f.officialSearchId):null;
      return {ok:true,enabled:mode==='catalog',search:row&&row.fingerprint===fingerprint(f)?row:null,note:'首批目录：黄鹤楼、晴川阁、曾侯乙编钟。只在已登记官网文章内匹配；候选不自动代表支持。'};
    }
    if(e.action!=='searchGuideOfficialSources')fail('OFFICIAL_ACTION','未知检索操作');
    if(mode!=='catalog')fail('OFFICIAL_DISABLED','官网检索尚未启用；不会使用模拟结果冒充原文');
    await db.createCollection('guide_official_searches').catch(err=>{if(!/exist/i.test(String(err.code)+err.message))throw err;});
    const recent=f.officialSearchId?await read(db,'guide_official_searches',f.officialSearchId):null;
    if(recent&&recent.fingerprint===fingerprint(f)&&recent.status==='active'&&!recent.failures?.length&&recent.items?.length&&recent.validUntil>now())return {ok:true,search:recent,cached:true};
    // Only the public resource title is sent to a search adapter. No submission text/UID/location.
    const urls=[...new Set(await search(String(checked.resource.title||'').slice(0,100)))].filter(allowedUrl).slice(0,3);
    const started=now(),items=[],failures=[];
    for(const url of urls){
      await draft(e); // Recheck before each external read.
      try{
        const fetched=await fetchPage(url);const article=extractArticle(fetched);
        for(const claim of checked.claims){
          const found=passages(article.paragraphs).map(p=>({...p,score:score(claim.claimText,p.quote)})).filter(p=>p.score>=0.2).sort((a,b)=>b.score-a.score).slice(0,1);
          for(const p of found){const quote=p.quote;items.push({id:hash([claim.id,article.url,article.pageHash,p.paragraph,quote]).slice(0,24),claimId:claim.id,claimText:claim.claimText,url:article.url,title:article.title,publisher:article.publisher,pageHash:article.pageHash,paragraph:p.paragraph,paragraphText:p.text,quoteStart:p.quoteStart,quoteEnd:p.quoteEnd,normalization:'html-text-v1',quote,quoteHash:hash(quote),retrievedAt:new Date(started).toISOString(),match:'candidate_only'});}
        }
      }catch(err){failures.push({host:new URL(url).hostname,code:['OFFICIAL_TIMEOUT','OFFICIAL_SIZE','OFFICIAL_NO_TEXT'].includes(err.code)?err.code:'OFFICIAL_UNAVAILABLE'});}
    }
    const selected=items.slice(0,24),searchId='official_'+crypto.randomBytes(12).toString('hex');
    const result={id:searchId,fragmentId:f.id,fingerprint:fingerprint(f),digest:hash(selected),status:'active',simulated:simulated===true||f.simulated===true,provider:'approved-official-catalog-v1',items:selected,failures,searchedPages:urls.length,createdAt:new Date(started).toISOString(),validUntil:started+7*86400000};
    await db.runTransaction(async tx=>{const current=await draft(e,tx);if(fingerprint(current.f)!==fingerprint(f))fail('GUIDE_CONFLICT','内容已变化，请重新检索');await tx.collection('guide_official_searches').doc(searchId).set(result);await tx.collection('guide_fragments').doc(f.id).update({officialSearchId:searchId});await tx.collection('guide_fragment_logs').add({action:'official_source_search',fragmentId:f.id,searchId,reviewer,createdAt:db.serverDate()});});
    return {ok:true,search:result,cached:false};
  }
  return {handle};
}
module.exports={createOfficialSourceService,score,passages};
