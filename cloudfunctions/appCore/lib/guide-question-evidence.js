'use strict';
const crypto = require('node:crypto');
const {read, checkGuideEvidence} = require('./guide-evidence');
const {createCulturalGuideService} = require('../domains/cultural-guide');
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (code, message) => { throw Object.assign(Error(message), {code}); };
function resourceId(value) {
  if (typeof value !== 'string' || !/^[\w-]{1,128}$/.test(value)) fail('QA_INPUT', '请先选择一个地点');
  return value;
}
function safeUrl(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password ? u.href : ''; } catch { return ''; }
}
// Reuse public publication checks, then tighten AI consent even for manually written guides.
// Only published, reviewed public excerpts enter the model. Original files and private fields never do.
async function loadEvidence(db, id) {
  resourceId(id);
  const resource = await read(db, 'resources', id);
  if (!resource || resource.status !== 'published' || resource.withdrawnAt || resource.disabledAt || resource.sourceUnavailable || resource.needsSourceReview) fail('QA_SOURCE', '这个地点的资料暂不可用');
  const publicItems = (await createCulturalGuideService({db}).station({resourceId:id})).items;
  const pieces = [], sources = new Map(), dependencies = [];
  for (const item of publicItems) {
    const version = await read(db, 'guide_fragment_versions', item.versionId);
    try {
      const checked = await checkGuideEvidence(db, version.evidenceKind === 'official_pack' ? version : {...version, generatedBy:'guide_agent'});
      for (const c of item.claims) {
        if (pieces.length >= 24 || pieces.some(p => p.id === c.id)) continue;
        const refs = item.sources.filter(s => c.sourceLinkIds.includes(s.id));
        if (!refs.length || refs.length !== c.sourceLinkIds.length) continue;
        pieces.push({id:c.id, text:c.text, sourceIds:c.sourceLinkIds});
        for (const s of refs) sources.set(s.id, {id:s.id, title:s.title, excerpt:s.excerpt, url:safeUrl(s.url), contributorName:s.contributorName || ''});
      }
      dependencies.push([item.versionId, checked.fingerprint, checked.contextFingerprint, item.text]);
    } catch (e) { if (e.code !== 'GUIDE_SOURCE_INVALID') throw e; }
  }
  const result = {resourceId:id, title:String(resource.title || '').slice(0,100), pieces, sources:[...sources.values()]};
  // Attribution changes also invalidate cached answers and source displays.
  result.fingerprint = hash([result, dependencies]);
  if (Buffer.byteLength(JSON.stringify(result),'utf8') > 32000) fail('QA_SOURCE', '本次资料较多，请稍后再试');
  return result;
}
function input(value) {
  if (!value || typeof value.question !== 'string' || !value.question.trim() || value.question.length > 400) fail('QA_INPUT','请用400字以内描述问题');
  const history = value.history === undefined ? [] : value.history;
  if (!Array.isArray(history) || history.length > 3 || history.some(t => typeof t !== 'string' || t.length > 400)) fail('QA_INPUT','对话过长，请重新提问');
  if (typeof value.requestId !== 'string' || !/^[a-zA-Z0-9_-]{16,80}$/.test(value.requestId)) fail('QA_INPUT','请重新发送问题');
  return {resourceId:resourceId(value.resourceId), question:value.question.trim(), history, requestId:value.requestId};
}
function staticReply(reason, context) {
  const messages = {off:'即时问答暂未开启，你可以先阅读已审核介绍。', insufficient:'目前收录的资料不足以回答这个问题，暂不猜测。', practical:'开放、票务、实时交通和具体行走方向需要现场或官方最新信息，目前不能据历史资料确认。', limited:'今天的问答额度暂时用完了，已有介绍仍可阅读。', unavailable:'问答暂时连接不上，已有介绍仍可阅读。', source:'相关来源刚刚变化，请重新打开后再问。'};
  return {ok:true, outcome:reason, text:messages[reason] || messages.insufficient, sentences:[], sources:[], resourceId:context.resourceId, title:context.title, fingerprint:context.fingerprint, aiGenerated:false};
}
module.exports = {hash, fail, input, loadEvidence, staticReply, safeUrl};
