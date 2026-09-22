'use strict';
const {first,hash,hasMaterialConsent,hasResearchConsent,fileFingerprint}=require('./material-evidence');
const {redactSensitiveText}=require('./privacy');
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
function blocksFor(a) {
  return (a.blocks && a.blocks.length ? a.blocks : [{text:a.extractedText||'',boundingBox:null}]).slice(0,40).map((b,i)=>({
    id:'fragment_'+i,text:String(b.text||''),kind:a.kind||'image_ocr',uncertainty:String(b.uncertainty||''),
    locator:b.locator || {type:'image_region',blockIndex:i,boundingBox:b.boundingBox||null}}));
}
function createReviewService({db}) {
  async function review(event,uid) {
    if(!['approved','rejected'].includes(event.decision)) fail('INVALID_REVIEW_DECISION','请选择确认或退回');
    const key=String(event.analysisId||'');
    if(!/^[\w-]+$/.test(key)) fail('INVALID_ID','材料编号无效');
    return db.runTransaction(async tx=>{
      const ref=tx.collection('material_analyses').doc(key),a=first(await ref.get());
      if(!a) fail('ANALYSIS_NOT_FOUND','材料不存在');
      const s=first(await tx.collection('submissions').doc(a.submissionId).get());
      if(!hasMaterialConsent(s)||a.invalidatedAt||a.sourceFingerprint!==fileFingerprint(s)) fail('MATERIAL_SOURCE_CHANGED','来源文件或授权已变化');
      if(!['needs_review','approved','rejected'].includes(a.status)||Number(event.reviewVersion||0)!==Number(a.reviewVersion||0)) fail('MATERIAL_VERSION_CHANGED','材料已被其他管理员更新，请刷新');
      const sourceBlocks=blocksFor(a),submitted=event.fragments;
      if(event.decision==='approved'&&(!Array.isArray(submitted)||!submitted.length||submitted.length>40)) fail('FRAGMENTS_REQUIRED','请逐段校对材料');
      const seen=new Set();
      const fragments=(submitted||[]).map(f=>{
        const base=sourceBlocks.find(b=>b.id===f.id);
        if(!base||seen.has(f.id)) fail('INVALID_FRAGMENT','材料片段不存在或重复');seen.add(f.id);
        const text=redactSensitiveText(String(f.text||'').trim()).text;
        if(text.length>1600||f.usable===true&&!text) fail('INVALID_FRAGMENT','可用片段必须有校对内容，且不超过 1600 字');
        return {...base,text,usable:f.usable===true,publicExcerpt:f.publicExcerpt===true};
      });
      const usable=event.decision==='approved'&&a.simulated===false&&hasResearchConsent(s)&&fragments.some(f=>f.usable);
      const version=Number(a.reviewVersion||0)+1;
      let resourceId=a.resourceId||s.resourceId||'';
      let binding=null;
      if(usable) {
        const links=(await tx.collection('story_evidence_links').where({submissionId:a.submissionId,status:'confirmed'}).limit(100).get()).data||[];
        binding=links.find(l=>!l.materialAnalysisId&&!l.needsSourceReview&&(!resourceId||l.resourceId===resourceId));
        if(!binding) fail('MATERIAL_BINDING_REQUIRED','请先确认投稿与文化资源的证据关联');
        resourceId=binding.resourceId;
        const resource=first(await tx.collection('resources').doc(resourceId).get());
        if(!resource||resource.status!=='published') fail('RESOURCE_UNAVAILABLE','文化资源尚未发布');
      }
      const now=db.serverDate();
      // Revision snapshots are immutable. Old links fail live revision checks immediately.
      await tx.collection('material_analysis_logs').doc('review_'+hash([key,version]).slice(0,40)).set({
        action:'material_review',analysisId:key,reviewVersion:version,previousVersion:a.reviewVersion||0,
        fragments,decision:event.decision,reviewerId:uid,createdAt:now});
      await ref.update({status:event.decision,reviewDecision:event.decision,reviewedFragments:fragments,
        reviewedText:fragments.filter(f=>f.usable).map(f=>f.text).join('\n'),reviewVersion:version,
        reviewedBy:uid,reviewedAt:now,updatedAt:now,usableForStory:usable,resourceId});
      const evidenceIds=[];
      if(usable) for(const f of fragments.filter(f=>f.usable)) {
        const id='material_'+hash([key,version,f.id,resourceId]).slice(0,40);evidenceIds.push(id);
        await tx.collection('story_evidence_links').doc(id).set({sourceType:'material_fragment',submissionId:a.submissionId,
          resourceId,status:'confirmed',relationType:'supports_story',evidenceSummary:f.text,
          materialAnalysisId:key,materialReviewVersion:version,materialFragmentId:f.id,materialKind:f.kind,
          materialLocator:f.locator,publicExcerpt:f.publicExcerpt&&s.materialExcerptConsent===true,
          parentEvidenceLinkId:binding._id||binding.id,reviewedAt:now,createdAt:now});
      }
      await tx.collection('submissions').doc(a.submissionId).update({materialAnalysisStatus:usable?'confirmed':event.decision,
        materialAnalysisId:key,materialDerivedTextReady:usable,materialAnalysisUpdatedAt:now,updatedAt:now});
      return {ok:true,analysisId:key,reviewVersion:version,usableForStory:usable,evidenceIds};
    });
  }
  return {review};
}
module.exports={blocksFor,createReviewService};
