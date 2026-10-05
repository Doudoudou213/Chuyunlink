'use strict';
// Official editorial evidence is isolated from user submissions and their consent.
const crypto = require('node:crypto');
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const read = async (db, collection, id) => { const r = await db.collection(collection).doc(String(id || '')).get(); const row = Array.isArray(r?.data) ? r.data[0] : r?.data; if (!row) return row; const {_id, ...doc} = row; return doc; };
const fail = message => { throw Object.assign(Error(message || '官网资料或点位已变化，请重新核对'), { code: 'GUIDE_SOURCE_INVALID' }); };
const sourceId = source => 'official_' + hash([source.url]).slice(0,32);
const sourceBody = s => [s.url, s.title, s.publisher, s.origin || '', s.section || '', s.pageDate || null];
const sourceFingerprint = (pkg, sources) => hash([pkg.id, pkg.resourceId, pkg.claims, sources.map(s => [s.id, sourceBody(s), s.version])]);
async function checkOfficialPackEvidence(db, f, { draft = false, now = Date.now() } = {}) {
  const resource = await read(db, 'resources', f.resourceId);
  const pkg = await read(db, 'guide_content_packages', f.evidencePackageId);
  if (!resource || resource.status !== 'published' || resource.withdrawnAt || resource.disabledAt || resource.sourceUnavailable || !pkg || pkg.status !== 'prepared' || pkg.needsSourceReview || f.needsSourceReview || pkg.resourceId !== f.resourceId || f.generation || f.simulated) fail();
  if (!Array.isArray(f.claimIds) || !f.claimIds.length || f.claimIds.length > 12 || f.claimIds.some(id => !pkg.claims.some(c => c.id === id))) fail();
  const sources = [];
  for (const id of pkg.sourceIds) {
    const s = await read(db, 'guide_reference_sources', id);
    if (!s || s.kind !== 'official_editorial' || s.id !== id || sourceId(s) !== id || s.sourceUnavailable || s.withdrawnAt) fail();
    if (!draft && (s.status !== 'confirmed' || !Number.isFinite(Date.parse(s.validUntil)) || Date.parse(s.validUntil) <= now)) fail();
    sources.push({ ...s, id, link: { evidenceSummary: pkg.claims.filter(c => c.sourceLinkIds.includes(id)).map(c => c.claimText).join('；') } });
  }
  const fingerprint = sourceFingerprint(pkg, sources);
  if (!draft && (!f.officialReview || f.officialReview.evidenceFingerprint !== fingerprint || f.sourceFingerprint !== fingerprint)) fail();
  const claims = pkg.claims.filter(c => f.claimIds.includes(c.id));
  if (claims.some(c => !c.sourceLinkIds.length || c.sourceLinkIds.some(id => !sources.some(s => s.id === id)))) fail();
  // Do not forge a user-source classification. Both review and public screening use this same input.
  const contextFingerprint = require('./guide-source-context').contextFingerprint(sources);
  return {resource, claims, sources, fingerprint, contextFingerprint, pkg};
}
function inputFor(c) {
  return { resourceTitle: c.resource.title, sourceFingerprint:c.fingerprint, sourceContextFingerprint:c.contextFingerprint,
    claims:c.claims.map(x => ({id:x.id,text:x.claimText,sourceLinkIds:x.sourceLinkIds})),
    sources:c.sources.map(x => ({id:x.id,excerpt:x.link.evidenceSummary,context:require('./guide-source-context').contextFor(x.link)})) };
}
function publicPack(f,c) {
  return {id:f.id,versionId:f.versionId,resourceId:f.resourceId,evidenceKind:'official_pack',title:f.title,text:f.text,
    interests:f.interests || [],observations:(f.observations || []).map(o => ({text:o.text,locator:o.locator || '具体位置尚未确认'})),
    sentences:f.sentences.map(s => ({text:s.text,claimIds:s.claimIds,sourceLinkIds:[...new Set(c.claims.filter(x => s.claimIds.includes(x.id)).flatMap(x => x.sourceLinkIds))]})),
    officialEvidence:{state:'editorial_reviewed',items:c.sources.map(s => ({id:s.id,url:s.url,title:s.title,publisher:s.publisher,origin:s.origin || '',section:s.section || ''}))},
    claims:c.claims.map(x => ({id:x.id,text:x.claimText,sourceLinkIds:x.sourceLinkIds})),
    sources:c.sources.map(s => ({id:s.id,title:s.title,excerpt:s.link.evidenceSummary,contributorName:'官方公开资料整理，非用户投稿',url:s.url})),
    visitNotice:c.pkg.visitNotice || ''};
}
module.exports = {hash,read,sourceId,sourceBody,sourceFingerprint,checkOfficialPackEvidence,inputFor,publicPack};
