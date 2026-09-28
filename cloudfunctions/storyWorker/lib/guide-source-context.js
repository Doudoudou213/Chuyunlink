'use strict';
const crypto = require('node:crypto');
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const KINDS = ['unknown', 'document', 'official', 'observation', 'oral'];
const LIMITS = {
  unknown: '来源性质尚未分类；仅转述已确认事实，不自称亲历。',
  document: '转述文献记载，保留原文中的限定和归属。',
  official: '转述已核对的官方记载；来源身份不等于历史结论已被独立证实。',
  observation: '观察属于材料提供者；不能改成讲解者亲眼见过。',
  oral: '口述属于讲述者，保留传说、据说等限定，不能改成历史定论。',
  image_ocr: '只证明图片材料写了什么，不证明文字中的历史说法为真。',
  image_observation: '只支持画面可见特征，不能推断年代、真伪或现场运营情况。',
  audio_transcript: '转写属于录音中的讲述者，不代表讲解者的经历或已证实事实。'
};
function baseFingerprint(link) {
  return hash([link.evidenceSummary || '', link.version || 1, link.materialAnalysisId || '', link.materialReviewVersion || 0, link.materialFragmentId || '']);
}
function contextFor(link) {
  const saved = link.guideSourceContext;
  const current = saved && saved.baseFingerprint === baseFingerprint(link);
  const material = link.materialAnalysisId ? String(link.materialKind || 'unknown') : '';
  const kind = material || (current ? saved.kind : 'unknown');
  return {
    kind, excerptType: material ? 'reviewed_material_fragment' : 'reviewed_evidence_summary',
    attribution: current ? saved.attribution : '', qualifiers: current ? saved.qualifiers : [],
    version: current ? saved.version : 0, sourceVersion: link.version || 1,
    locator: material ? link.materialLocator || null : null,
    boundary: LIMITS[kind] || LIMITS.unknown,
    stale: Boolean(saved && !current)
  };
}
function normalizeContext(raw, link) {
  const fail = () => { throw Object.assign(Error('请选择来源性质；归属最多80字，限定最多6项且必须出现在来源摘要中'), {code:'GUIDE_CONTEXT'}); };
  if (!KINDS.includes(raw?.kind)) fail();
  const attribution = String(raw.attribution || '').trim();
  const qualifiers = raw.qualifiers || [];
  if (attribution.length > 80 || !Array.isArray(qualifiers) || qualifiers.length > 6 || qualifiers.some(q => typeof q !== 'string' || !q.trim() || q.length > 40 || !String(link.evidenceSummary || '').includes(q))) fail();
  require('./guide-contract').checkGuidePrivacy({attribution, qualifiers});
  return {kind:raw.kind, attribution, qualifiers:[...new Set(qualifiers)], baseFingerprint:baseFingerprint(link), version:(link.guideSourceContext?.version || 0) + 1};
}
function contextFingerprint(sources) { return hash(sources.map(s => [s.id, contextFor(s.link)])); }
module.exports = {contextFor, contextFingerprint, baseFingerprint, normalizeContext, hash};
