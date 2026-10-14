'use strict';
const crypto = require('node:crypto');
const TYPES = Object.freeze({ submission: 'submissions', supplement: 'submission_supplements', feedback: 'system_feedback' });
const CATEGORIES = ['architecture', 'music', 'artifact', 'pattern', 'inscription', 'oral', 'landscape', 'document'];
const read = async (db, collection, id) => {
  const result = await db.collection(collection).doc(id).get();
  return Array.isArray(result.data) ? result.data[0] : result.data;
};
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const evidenceId = (type, id) => hash([type, id]);
const live = row => row && !row.withdrawnAt && !row.disabledAt && !row.deletedAt && !row.sourceUnavailable;
async function sourceFor(db, type, id) {
  if (!Object.hasOwn(TYPES, type) || !/^[\w-]{1,128}$/.test(id)) return null;
  const source = await read(db, TYPES[type], id);
  if (!live(source) || !source.userId) return null;
  if (type === 'feedback') {
    if (source.type !== 'story_correction' || !['resolved', 'accepted_for_revision'].includes(source.status) || !source.resolvedBy || !source.resolvedAt) return null;
  } else if (source.status !== 'approved' || !source.reviewerId || !source.reviewedAt) return null;
  if (type === 'submission' && source.source !== 'cloudbase_formal_web') return null;
  let parent = null;
  if (type === 'supplement') {
    if (!/^[\w-]{1,128}$/.test(String(source.submissionId || ''))) return null;
    parent = await read(db, 'submissions', String(source.submissionId || ''));
    if (!live(parent) || parent.status !== 'approved' || parent.source !== 'cloudbase_formal_web') return null;
  }
  // Any relevant source edit makes the attestation stale until a human reconfirms it.
  const snapshot = row => row ? [row.status, row.userId, row.title, row.description, row.content, row.response,
    row.fileID, row.imageFileID, row.resourceId, row.materialVersion,
    row.reviewedAt, row.resolvedAt, row.materialConsentRevokedAt] : null;
  return { source, parent, fingerprint: hash([snapshot(source), snapshot(parent)]) };
}
async function verify(db, record, uid) {
  if (!record || record.userId !== uid || record.status !== 'confirmed' || !record.reviewerId || !record.reviewedAt) return null;
  const resolved = await sourceFor(db, record.sourceType, record.sourceId);
  if (!resolved || resolved.source.userId !== uid || resolved.fingerprint !== record.fingerprint) return null;
  if (record.resourceId) {
    const resource = await read(db, 'resources', record.resourceId);
    if (!resource || resource.status !== 'published') return null;
  }
  if (record.placeId) {
    const place = await read(db, 'resources', record.placeId);
    if (!place || place.status !== 'published') return null;
  }
  return { ...record, parentOwner: resolved.parent?.userId || '', targetRecordId: resolved.source.submissionId || '' };
}
function metricsFrom(records) {
  const sets = Object.fromEntries(['approved_architecture_objects','approved_music_objects','approved_pattern_objects',
    'approved_inscription_objects','approved_authorized_oral_records','approved_onsite_places','approved_artifact_objects',
    'accepted_sourced_corrections','accepted_other_contributor_records','valid_contributions','valid_content_categories',
    'accepted_collaborative_supplements'].map(k => [k, new Set()]));
  for (const r of records) {
    const key = `${r.sourceType}:${r.sourceId}`;
    const collaborative = r.sourceType === 'supplement' && r.parentOwner && r.parentOwner !== r.userId;
    // The same correction to one issue cannot be split into several contributions.
    const contributionKey = r.sourceType === 'feedback' ? 'correction:' + r.issueKey : key;
    if (sets.valid_contributions.has(contributionKey)) continue;
    sets.valid_contributions.add(contributionKey);
    if (CATEGORIES.includes(r.category)) sets.valid_content_categories.add(r.category);
    if (r.sourceType === 'submission') {
      if (r.resourceId && r.category === 'architecture') sets.approved_architecture_objects.add(r.resourceId);
      if (r.resourceId && r.category === 'music') sets.approved_music_objects.add(r.resourceId);
      if (r.resourceId && r.patternDetails) sets.approved_pattern_objects.add(r.resourceId);
      if (r.resourceId && r.inscriptionTranscript) sets.approved_inscription_objects.add(r.resourceId);
      if (r.oralAuthorization) sets.approved_authorized_oral_records.add(r.sourceId);
      if (r.onsite && r.placeId) sets.approved_onsite_places.add(r.placeId);
      if (r.resourceId && r.category === 'artifact' && r.artifactDetails) sets.approved_artifact_objects.add(r.resourceId);
    }
    if (r.sourceType === 'feedback' && r.issueKey && r.citedCorrection) sets.accepted_sourced_corrections.add(r.issueKey);
    if (collaborative) {
      sets.accepted_other_contributor_records.add(r.targetRecordId);
      // Repeated files attached to the same target form one collaborative contribution.
      sets.accepted_collaborative_supplements.add(r.targetRecordId);
    }
  }
  return Object.fromEntries(Object.entries(sets).map(([metric, values]) => [metric, values.size]));
}
module.exports = { TYPES, CATEGORIES, read, hash, evidenceId, sourceFor, verify, metricsFrom };
