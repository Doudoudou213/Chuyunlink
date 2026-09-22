'use strict';
const crypto = require('node:crypto');
const first = r => Array.isArray(r && r.data) ? r.data[0] : r && r.data;
const VERSION = 'confirmed-material-use-v1';
const SCOPE = 'reviewed_material_research_and_public_excerpt';
const hash = x => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function hasMaterialConsent(s) {
  return Boolean(s && s.status === 'approved' && s.materialAnalysisConsent === true
    && s.materialConsentVersion === 'multimodal-material-consent-v1'
    && s.materialConsentScope === 'approved_original_file_extraction' && !s.materialConsentRevokedAt);
}
function hasResearchConsent(s) {
  return hasMaterialConsent(s) && s.aiAnalysisConsent === true && !s.aiConsentRevokedAt
    && s.aiConsentVersion === 'ai-analysis-consent-v1' && s.aiConsentScope === 'approved_public_submission_text'
    && s.materialResearchConsent === true && s.materialResearchConsentVersion === VERSION
    && s.materialResearchConsentScope === SCOPE && !s.materialResearchConsentRevokedAt;
}
function fileFingerprint(s) {
  return hash({sourceType:'submission',sourceId:String(s._id || s.id || ''),
    fileID:String(s.imageFileID || s.fileID || ''),mimeType:String(s.mimeType || ''),size:Math.max(0,Number(s.size)||0)});
}
function isMaterialLink(link) { return Boolean(link && (link.sourceType === 'material_fragment' || link.materialAnalysisId)); }
async function materialLinkValid(db, link, submission, publicRead = false) {
  if (!isMaterialLink(link)) return true;
  if (!hasResearchConsent(submission) || link.status !== 'confirmed' || link.needsSourceReview === true) return false;
  if (publicRead && submission.materialExcerptConsent !== true) return false;
  const a = first(await db.collection('material_analyses').doc(link.materialAnalysisId || '').get());
  if (!a || a.status !== 'approved' || a.simulated !== false || a.usableForStory !== true
    || a.submissionId !== link.submissionId || a.sourceFingerprint !== fileFingerprint(submission)
    || a.reviewVersion !== link.materialReviewVersion || a.invalidatedAt) return false;
  const fragment = (a.reviewedFragments || []).find(f => f.id === link.materialFragmentId);
  return Boolean(fragment && fragment.usable === true && fragment.text === link.evidenceSummary
    && (!publicRead || fragment.publicExcerpt === true));
}
function referenceFor(link) {
  return isMaterialLink(link) ? {analysisId:link.materialAnalysisId,reviewVersion:link.materialReviewVersion,
    fragmentId:link.materialFragmentId,kind:link.materialKind,locator:link.materialLocator} : null;
}
module.exports = {VERSION,SCOPE,hash,first,hasMaterialConsent,hasResearchConsent,fileFingerprint,isMaterialLink,materialLinkValid,referenceFor};
