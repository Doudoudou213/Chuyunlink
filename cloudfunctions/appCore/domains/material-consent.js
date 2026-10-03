'use strict';
const {VERSION,SCOPE,first}=require('../lib/material-evidence');
function createMaterialConsentService({db}) {
  async function change(event,uid) {
    const submissionId=String(event.submissionId||'');
    if(!/^[\w-]+$/.test(submissionId)) throw Error('投稿编号无效');
    const revoke=event.action==='withdrawMaterialConsent';
    try { await db.createCollection('material_consent_logs'); } catch(e) { if(!/exist/i.test(e.message+' '+e.code)) throw e; }
    await db.runTransaction(async tx=>{
      const ref=tx.collection('submissions').doc(submissionId), s=first(await ref.get());
      if(!s||s.userId!==uid) throw Error('只能管理自己的材料授权');
      if(!revoke && (!s.materialAnalysisConsent || !s.aiAnalysisConsent || s.materialConsentRevokedAt || s.aiConsentRevokedAt)) throw Error('请先授予材料识别和 AI 分析权限');
      if(!revoke && (event.consentVersion!==VERSION || event.researchConsent!==true)) throw Error('请阅读并确认材料用途');
      const revision=Number(s.materialConsentRevision||0)+1;
      await tx.collection('material_consent_logs').doc(submissionId+'_'+revision).set({submissionId,revision,action:revoke?'withdraw':'grant_research',consentVersion:VERSION,publicExcerpt:!revoke&&event.publicExcerptConsent===true,createdAt:db.serverDate()});
      await ref.update({materialConsentRevision:revision});
      await ref.update(revoke ? {materialAnalysisConsent:false,materialResearchConsent:false,materialExcerptConsent:false,
        materialConsentRevokedAt:db.serverDate(),materialResearchConsentRevokedAt:db.serverDate(),updatedAt:db.serverDate()}
        : {materialResearchConsent:true,materialResearchConsentVersion:VERSION,materialResearchConsentScope:SCOPE,
          materialResearchConsentRevokedAt:null,materialExcerptConsent:event.publicExcerptConsent===true,
          materialResearchConsentAt:db.serverDate(),updatedAt:db.serverDate()});
    });
    // Source reads fail closed immediately after the transaction; propagation is retryable.
    if(revoke) {
      for(const name of ['material_analyses','material_analysis_jobs','story_evidence_links']) {
        let offset=0;
        for(;;) {
          let rows;
          try { rows=(await db.collection(name).where({submissionId}).skip(offset).limit(100).get()).data||[]; }
          catch(e) { if(/collection.*not.*exist|DATABASE_COLLECTION_NOT_EXIST/i.test(e.message+' '+e.code)) break;throw e; }
          for(const item of rows) {
            if(name==='story_evidence_links'&&!item.materialAnalysisId) continue;
            await db.collection(name).doc(item._id).update({needsSourceReview:true,usableForStory:false,
              invalidatedAt:db.serverDate(),sourceReviewReason:'material_consent_revoked',updatedAt:db.serverDate()});
          }
          if(rows.length<100) break;offset+=rows.length;
        }
      }
    }
    if(revoke) await require('../lib/material-impacts').propagateMaterialImpacts(db,submissionId,'material_consent_revoked');
    return {ok:true,submissionId,revoked:revoke};
  }
  return {change};
}
module.exports={createMaterialConsentService};
