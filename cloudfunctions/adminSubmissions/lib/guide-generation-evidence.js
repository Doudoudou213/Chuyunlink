'use strict';
const {checkGuideEvidence,read}=require('./guide-evidence');
const {materialLinkValid,referenceFor}=require('./material-evidence');
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const validId=x=>typeof x==='string'&&/^[\w-]{1,128}$/.test(x);
async function prepareGuideInput(db,selection){
  if(!validId(selection.storyId)||!Array.isArray(selection.claimIds)||!selection.claimIds.length||selection.claimIds.length>12||selection.claimIds.some(x=>!validId(x)))fail('GUIDE_SELECTION','请选择故事和最多十二条事实');
  const story=await read(db,'story_chains',selection.storyId);
  if(!story)fail('GUIDE_SOURCE_INVALID','故事不可用');
  const interest=String(selection.interest||'通用');
  if(!['通用','建筑','碑刻','地方故事'].includes(interest))fail('GUIDE_INTEREST','请选择支持的讲解重点');
  const fragment={resourceId:story.resourceId,storyId:selection.storyId,storyVersion:Number(story.version||1),claimIds:[...new Set(selection.claimIds)].sort()};
  const checked=await checkGuideEvidence(db,fragment);
  const allLinks=[...new Set([...(story.sourceLinkIds||[]),...(story.chapters||[]).flatMap(c=>c.sourceLinkIds||[])])];
  for(const linkId of allLinks){const link=await read(db,'story_evidence_links',linkId);const s=await read(db,'submissions',link.submissionId);
    if(s.aiAnalysisConsent!==true||s.aiConsentVersion!=='ai-analysis-consent-v1'||s.aiConsentScope!=='approved_public_submission_text'||s.aiConsentRevokedAt||s.aiAnalysisStatus==='consent_revoked'||!await materialLinkValid(db,link,s,true))fail('GUIDE_CONSENT','来源当前未授权用于 AI 讲解，请先补齐有效资料');
  }
  const claims=checked.claims.map(c=>({id:c.id,text:String(c.claimText||''),sourceLinkIds:c.sourceLinkIds}));
  const sources=checked.sources.map(s=>({id:s.id,excerpt:String(s.link.evidenceSummary||''),material:referenceFor(s.link),context:require('./guide-source-context').contextFor(s.link),contextBaseFingerprint:require('./guide-source-context').baseFingerprint(s.link)}));
  if(claims.some(c=>!c.text||c.text.length>1200)||sources.some(s=>!s.excerpt||s.excerpt.length>2000)||JSON.stringify({claims,sources}).length>16000)fail('GUIDE_INPUT_SIZE','材料不足或过长，请减少所选事实；不会自动截断证据');
  require('./guide-contract').checkGuidePrivacy({resourceTitle:checked.resource.title,claims,sources});
  return {...fragment,interest,resourceTitle:String(checked.resource.title||''),sourceFingerprint:checked.fingerprint,sourceContextFingerprint:checked.contextFingerprint,claims,sources};
}
module.exports={prepareGuideInput};
