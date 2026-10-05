'use strict';
const catalog = require('../data/guide-pack.v1.json');
const E = require('../lib/guide-pack-evidence');
const C = require('../lib/guide-contract');
const G = require('../lib/guide-grounding');
const actions = ['getGuidePackCatalog','previewGuidePack','importGuidePack','getGuidePackDraft','saveGuidePackDraft','publishGuidePackDraft','archiveGuidePackDraft','disableGuidePackSource'];
const fail = (code,message) => {throw Object.assign(Error(message),{code});};
const id = value => {if(!/^[\w-]{1,128}$/.test(String(value || '')))fail('GUIDE_PACK_ID','编号无效');return value;};
const note = value => {if(typeof value !== 'string' || value.trim().length < 8 || value.length > 500)fail('GUIDE_REVIEW','请填写至少8字的核对说明');C.checkGuidePrivacy(value);return value.trim();};
const sameSet = (a,b) => Array.isArray(a) && a.length === b.length && new Set(a).size === b.length && a.every(x => b.includes(x));
function createGuidePackService({db, now = () => Date.now()}) {
  async function prepare() {for(const name of ['guide_content_packages','guide_reference_sources','guide_fragments','guide_fragment_versions','guide_fragment_logs'])await db.createCollection(name).catch(e=>{if(!/exist/i.test(String(e.code)+e.message))throw e;});}
  async function rows(name,where={}) {return (await db.collection(name).where(where).limit(100).get()).data || [];}
  async function preview(e, database=db) {
    const record = catalog.records.find(r => r.id === id(e.recordId));
    if(!record)fail('GUIDE_PACK_NOT_FOUND','讲解包不存在');
    const resourceId = id(e.resourceId || record.id);
    const resource = await E.read(database,'resources',resourceId);
    const eligible = record.status === 'draft_ready';
    const matched = !!resource && resource.status === 'published' && ['landmark','hotspot'].includes(resource.type) && !resource.disabledAt && !resource.withdrawnAt && !resource.sourceUnavailable;
    const sources = record.sourceIds.map(key => {const s = catalog.sources.find(s=>s.id===key);return {id:E.sourceId(s),kind:'official_editorial',url:s.url,title:s.title,publisher:s.publisher,origin:s.origin || '',section:s.section || '',pageDate:s.pageDate || null};});
    const claims = record.claims.map(c=>({id:c.id,claimText:c.text,sourceLinkIds:c.sourceIds.map(key=>E.sourceId(catalog.sources.find(s=>s.id===key)))}));
    const fingerprint = E.hash([catalog.packId,record,resourceId,resource?.title,resource?.status,resource?.type,sources]);
    const packageId = 'pack_' + fingerprint.slice(0,32);
    const pkg = {id:packageId,status:'prepared',packId:catalog.packId,recordId:record.id,resourceId,sourceIds:sources.map(s=>s.id),claims,scope:record.scope,
      visitNotice:record.visit.status==='needs_reopening_confirmation'?'本资料包保留闭馆提醒；入馆前请核实最新开放公告。':''};
    return {ok:true,record,resource:matched?{id:resourceId,title:resource.title}:null,canImport:eligible&&matched,
      reason:!eligible?'仅有背景或对象不明，暂不导入':!matched?'未匹配到已发布的实体点位，请先建立或选择正确资源':'',
      fingerprint,pkg,sources};
  }
  async function inspected(database,f) {
    const c = await E.checkOfficialPackEvidence(database,f,{draft:true,now:now()});
    const input = E.inputFor(c);
    const output = C.validateGuideOutput({title:f.title,sentences:f.sentences,observations:f.observations || [],gaps:f.gaps || []},input);
    const grounding = G.inspectGuide(output,input);
    return {...f,...output,sourceFingerprint:c.fingerprint,sourceContextFingerprint:c.contextFingerprint,grounding,
      reviewEvidence:{claims:input.claims,sources:c.sources.map(s=>({id:s.id,title:s.title,url:s.url,publisher:s.publisher,origin:s.origin,section:s.section,excerpt:s.link.evidenceSummary,status:s.status,version:s.version,validUntil:s.validUntil || null}))},
      visitNotice:c.pkg.visitNotice};
  }
  async function handle(e,reviewer) {
    if(!reviewer)fail('FORBIDDEN','需要管理员权限');
    await prepare();
    if(e.action==='getGuidePackCatalog') {
      const resources = (await rows('resources',{status:'published'})).filter(r=>['landmark','hotspot'].includes(r.type)).map(r=>({id:r._id || r.id,title:r.title}));
      const fragments = (await rows('guide_fragments',{evidenceKind:'official_pack'})).map(f=>({id:f._id || f.id,title:f.title,status:f.status,revision:f.revision,resourceId:f.resourceId}));
      return {ok:true,packId:catalog.packId,records:catalog.records.map(r=>({id:r.id,title:r.title,status:r.status,statusMeaning:r.statusMeaning,gaps:r.gaps,resourceId:resources.find(x=>x.id===r.id)?.id || ''})),resources,fragments,limit:100};
    }
    if(e.action==='previewGuidePack')return preview(e);
    if(e.action==='importGuidePack')return db.runTransaction(async tx=>{
      const p = await preview(e,tx);
      if(!p.canImport)fail('GUIDE_PACK_INELIGIBLE',p.reason);
      if(e.fingerprint!==p.fingerprint || e.bindingConfirmed!==true)fail('GUIDE_CONFLICT','请先预览并确认点位，资料变化后需重新预览');
      const existing = await E.read(tx,'guide_content_packages',p.pkg.id);
      if(!existing) {
        await tx.collection('guide_content_packages').doc(p.pkg.id).set(p.pkg);
        for(const source of p.sources) {
          const old = await E.read(tx,'guide_reference_sources',source.id);
          if(old && E.hash(E.sourceBody(old))!==E.hash(E.sourceBody(source)))fail('GUIDE_CONFLICT','来源版本发生变化，请先核对来源目录');
          if(!old)await tx.collection('guide_reference_sources').doc(source.id).set({...source,status:'pending',version:1,validUntil:null});
        }
      }
      const fragmentIds = [];
      for(const [index,d] of p.record.narrations.entries()) {
        const key = p.pkg.id + '_' + index;
        fragmentIds.push(key);
        if(await E.read(tx,'guide_fragments',key))continue; // Never overwrite edits, archives or a published version on retry.
        const f = {id:key,evidenceKind:'official_pack',evidencePackageId:p.pkg.id,resourceId:p.pkg.resourceId,
          title:p.record.title+' · '+d.interest,text:d.sentences.map(s=>s.text).join(''),sentences:d.sentences,claimIds:p.pkg.claims.map(c=>c.id),
          interests:d.interest==='通用'?[]:[d.interest],observations:[],gaps:p.record.gaps.slice(0,5),revision:1,status:'draft',publishedVersionId:'',simulated:false};
        const draft = await inspected(tx,f);
        // A prepared pack can contain review warnings; definite violations still stop the import.
        G.assertNoBlockers(draft.grounding);
        const {reviewEvidence,visitNotice,...stored} = draft;
        await tx.collection('guide_fragments').doc(key).set(stored);
      }
      await tx.collection('guide_fragment_logs').add({action:'pack_imported',packageId:p.pkg.id,fragmentIds,reviewer,createdAt:db.serverDate()});
      return {ok:true,fragmentIds,alreadyImported:!!existing};
    });
    const key=id(e.fragmentId);
    if(e.action==='getGuidePackDraft') {
      const f=await E.read(db,'guide_fragments',key);
      if(!f || f.evidenceKind!=='official_pack')fail('GUIDE_PACK_NOT_FOUND','讲解包草稿不存在');
      return {ok:true,draft:await inspected(db,f)};
    }
    return db.runTransaction(async tx=>{
      const f=await E.read(tx,'guide_fragments',key);
      if(!f || f.evidenceKind!=='official_pack')fail('GUIDE_PACK_NOT_FOUND','讲解包草稿不存在');
      if(f.revision!==Number(e.revision))fail('GUIDE_CONFLICT','草稿已被修改，请重新读取');
      const ref=tx.collection('guide_fragments').doc(key);
      if(e.action==='archiveGuidePackDraft') {
        await ref.update({status:'archived',revision:f.revision+1});
        await tx.collection('guide_fragment_logs').add({action:e.action,fragmentId:key,reviewer,createdAt:db.serverDate()});
        return {ok:true};
      }
      if(e.action==='disableGuidePackSource') {
        const pkg=await E.read(tx,'guide_content_packages',f.evidencePackageId),sourceId=id(e.sourceId);
        if(!pkg.sourceIds.includes(sourceId))fail('GUIDE_SCOPE','来源不属于这份讲解');
        const s=await E.read(tx,'guide_reference_sources',sourceId);
        if(s.version!==Number(e.sourceVersion))fail('GUIDE_CONFLICT','来源已更新，请重新读取');
        const reason=note(e.reviewNote);
        await tx.collection('guide_reference_sources').doc(sourceId).update({status:'disabled',version:s.version+1,validUntil:null});
        await tx.collection('guide_fragment_logs').add({action:e.action,sourceId,reason,reviewer,createdAt:db.serverDate()});
        return {ok:true};
      }
      if(e.action==='saveGuidePackDraft') {
        const raw=e.draft || {};
        if(Object.keys(raw).some(k=>!['title','sentences','interests'].includes(k)))fail('GUIDE_SCOPE','只能修改讲解和兴趣，不能更换点位或来源');
        if(!Array.isArray(raw.interests)||raw.interests.length>6||raw.interests.some(x=>typeof x!=='string'||x.length>30))fail('GUIDE_SCOPE','兴趣标签不正确');
        C.checkGuidePrivacy(raw.interests);
        const updated=await inspected(tx,{...f,title:raw.title,sentences:raw.sentences,interests:raw.interests});
        G.assertNoBlockers(updated.grounding);
        const {reviewEvidence,visitNotice,...stored}=updated;
        stored.status='draft';stored.revision=f.revision+1;stored.officialReview=null;
        if(f.status==='archived')stored.publishedVersionId='';
        await ref.set(stored);
        await tx.collection('guide_fragment_logs').add({action:e.action,fragmentId:key,revision:stored.revision,reviewer,createdAt:db.serverDate()});
        return {ok:true};
      }
      if(e.action==='publishGuidePackDraft') {
        const current=await inspected(tx,f);
        if(!['draft','published'].includes(f.status))fail('GUIDE_STATE','请先保存草稿');
        if(e.evidenceFingerprint!==current.sourceFingerprint || e.groundingResolution?.fingerprint!==current.grounding.fingerprint)fail('GUIDE_CONFLICT','来源或内容已变化，请重新读取再核对');
        const pkg=await E.read(tx,'guide_content_packages',f.evidencePackageId);
        if(e.bindingConfirmed!==true || e.factsConfirmed!==true || e.paraphraseConfirmed!==true || !sameSet(e.reviewedSourceIds,pkg.sourceIds))fail('GUIDE_REVIEW','请核对点位、全部事实、原创整理稿和每个官网来源');
        const reviewNote=note(e.reviewNote);
        G.assertPublishable(current.grounding,e.groundingResolution);
        // Explicit human review renews only these sources. Revoked versions do not revive old guide snapshots.
        for(const sourceId of pkg.sourceIds) {
          const s=await E.read(tx,'guide_reference_sources',sourceId);
          await tx.collection('guide_reference_sources').doc(sourceId).update({status:'confirmed',validUntil:new Date(now()+7*86400000).toISOString(),reviewedAt:new Date(now()).toISOString()});
        }
        const {reviewEvidence,visitNotice,...stored}=current;
        stored.officialReview={evidenceFingerprint:current.sourceFingerprint,reviewedAt:new Date(now()).toISOString()};
        stored.groundingResolution={fingerprint:current.grounding.fingerprint,reasons:e.groundingResolution.reasons || {}};
        stored.status='published';stored.versionId=key+'_v'+f.revision;stored.publishedAt=db.serverDate();
        await E.checkOfficialPackEvidence(tx,stored,{now:now()});
        await tx.collection('guide_fragment_versions').doc(stored.versionId).set(stored);
        await ref.set({...stored,publishedVersionId:stored.versionId,revision:f.revision+1});
        await tx.collection('guide_fragment_logs').add({action:e.action,fragmentId:key,versionId:stored.versionId,reviewNote,reviewer,createdAt:db.serverDate()});
        return {ok:true,versionId:stored.versionId};
      }
      fail('GUIDE_ACTION','未知讲解包操作');
    });
  }
  return {handle};
}
module.exports={createGuidePackService,actions};
