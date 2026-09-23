'use strict';
const {materialLinkValid,referenceFor}=require('../lib/material-evidence');

const crypto = require('crypto');
const { ENTITY_TYPES, RELATION_TYPES, entityIdFor, relationIdFor } = require('./story-graph');
const COLLECTIONS = ['story_agent_candidates', 'story_agent_jobs', 'story_agent_reviews', 'story_gap_tasks', 'story_gap_task_logs'];
const HIGH_RISK = new Set(['associated_with_person', 'associated_with_event', 'changed_over_time', 'influenced_or_transmitted_to']);
const REASON_CATEGORIES = new Set(['accepted_as_is', 'wording_adjusted', 'type_corrected', 'duplicate_merged',
  'source_insufficient', 'unsupported_claim', 'wrong_target', 'missing_context', 'other']);
const text = (v, n = 500) => String(v == null ? '' : v).trim().slice(0, n);
const first = r => Array.isArray(r && r.data) ? r.data[0] : r && r.data;
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const id = v => { const result = text(v, 128); if (!/^[\w-]+$/.test(result)) fail('INVALID_ID', '记录编号无效'); return result; };
const regionOf = r => Object.fromEntries(['country', 'province', 'city', 'district'].map(k => [k, text(r && r[k], 40)]));
const hasCurrentAiConsent = item => Boolean(item && item.status === 'approved' && item.aiAnalysisConsent === true
  && item.aiConsentVersion === 'ai-analysis-consent-v1'
  && item.aiConsentScope === 'approved_public_submission_text'
  && !item.aiConsentRevokedAt && item.aiAnalysisStatus !== 'consent_revoked');
const candidateId = (jobId, key) => 'agent_candidate_' + crypto.createHash('sha256')
  .update(JSON.stringify({ candidateKey: key, candidateType: 'entity', jobId })).digest('hex').slice(0, 40);

const normalizedName = value => text(value, 500).normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
const normalizedRegion = value => normalizedName(typeof value === 'object'
  ? [value && value.country, value && value.province, value && value.city, value && value.district].filter(Boolean).join('')
  : value).replace(/特别行政区|自治区|自治州|地区|省|市|盟|区|县/gu, '');
const charOverlap = (left, right) => {
  const a = new Set(normalizedName(left));
  const b = new Set(normalizedName(right));
  if (!a.size || !b.size) return 0;
  let shared = 0;
  a.forEach(value => { if (b.has(value)) shared += 1; });
  return shared / Math.max(a.size, b.size);
};

function bestNameMatch(candidate, entity) {
  const leftValues = [candidate && candidate.name, ...(Array.isArray(candidate && candidate.aliases) ? candidate.aliases : [])];
  const rightValues = [entity && entity.name, ...(Array.isArray(entity && entity.aliases) ? entity.aliases : [])];
  let best = { kind: '', score: 0, reason: '' };
  leftValues.forEach((leftValue) => rightValues.forEach((rightValue) => {
    const left = normalizedName(leftValue);
    const right = normalizedName(rightValue);
    if (!left || !right) return;
    let current = { kind: '', score: 0, reason: '' };
    if (left === right) current = { kind: 'exact', score: 100, reason: '名称或别名完全一致' };
    else if (Math.min(left.length, right.length) >= 2 && (left.includes(right) || right.includes(left))) {
      current = { kind: 'contained', score: 62, reason: '一个名称包含另一个名称' };
    } else {
      const overlap = charOverlap(left, right);
      if (overlap >= 0.66) current = { kind: 'similar', score: Math.round(overlap * 70), reason: '名称中的主要文字高度重合' };
    }
    if (current.score > best.score) best = current;
  }));
  return best;
}

function rankEntityMatches(candidate, entities, context = {}) {
  return (Array.isArray(entities) ? entities : []).map((entity) => {
    if (candidate.entityType && entity.entityType && candidate.entityType !== entity.entityType) return null;
    const match = bestNameMatch(candidate, entity);
    if (!match.score) return null;
    const sameResource = Boolean(context.resourceId && entity.resourceId === context.resourceId);
    const relationAligned = Boolean(context.resourceId && Array.isArray(entity.relationResourceIds)
      && entity.relationResourceIds.includes(context.resourceId));
    const candidateRegion = normalizedRegion(context.region);
    const entityRegion = normalizedRegion(entity.region);
    const regionMatches = Boolean(candidateRegion && entityRegion
      && (candidateRegion.includes(entityRegion) || entityRegion.includes(candidateRegion)));
    if (candidateRegion && entityRegion && !regionMatches && !sameResource) return null;
    const reasons = [match.reason];
    let score = match.score;
    if (sameResource) { score += 25; reasons.push('关联同一文化资源'); }
    if (regionMatches) { score += 10; reasons.push('地区信息一致'); }
    if (relationAligned) { score += 8; reasons.push('已有关系指向同一资源'); }
    const level = match.kind === 'exact' && (sameResource || regionMatches || relationAligned || (!context.resourceId && !candidateRegion))
      ? 'strong' : 'review';
    return { entityId: entity.id || entity._id, name: entity.name, entityType: entity.entityType,
      resourceId: entity.resourceId || '', level, score, reasons: [...new Set(reasons)] };
  }).filter(item => item && item.entityId && item.score >= 45)
    .sort((left, right) => (left.level === right.level ? 0 : left.level === 'strong' ? -1 : 1)
      || right.score - left.score || String(left.entityId).localeCompare(String(right.entityId)))
    .slice(0, 5);
}

function mergedAliases(existing, candidate, editedName) {
  const canonical = normalizedName(existing && existing.name);
  const seen = new Set();
  return [existing && existing.aliases || [], [candidate && candidate.name, editedName], candidate && candidate.aliases || []]
    .flat().map(value => text(value, 80)).filter(Boolean).filter((value) => {
      const key = normalizedName(value);
      if (!key || key === canonical || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 10);
}

function changedFields(candidateType, payload, final, edits, originalResourceId = '') {
  if (!final) return [];
  const pairs = candidateType === 'relation'
    ? [['relationType', payload.relationType, final.relationType], ['why', payload.reason, final.why]]
    : [['name', payload.name, final.name], ['entityType', payload.entityType, final.entityType],
      ['summary', payload.summary, final.summary], ['resourceId', originalResourceId || payload.toResourceId || '', final.resourceId || ''],
      ['mergeEntityId', '', final.mergedInto || '']];
  return pairs.filter(([key, before, after]) => Object.prototype.hasOwnProperty.call(edits || {}, key)
    && String(before == null ? '' : before).trim() !== String(after == null ? '' : after).trim()).map(([key]) => key);
}

function createStoryAgentReviewService({ db }) {
  let ready;
  async function ensure() {
    if (!ready) ready = Promise.all(COLLECTIONS.map(async name => {
      try { await db.createCollection(name); } catch (e) { if (!/exist/i.test(`${e.code} ${e.message}`)) throw e; }
    })).catch(e => { ready = null; throw e; });
    await ready;
  }
  async function workspace(event = {}) {
    await ensure();
    const offset = Math.max(0, Math.min(100000, Number(event.offset) || 0));
    const status = ['pending_review', 'approved', 'rejected'].includes(event.status) ? event.status : 'pending_review';
    const result = await db.collection('story_agent_candidates').where({ status }).orderBy('_id', 'asc').skip(offset).limit(31).get();
    const page = (result.data || []).slice(0, 30);
    const [entityResult, relationResult] = await Promise.all([
      db.collection('story_entities').where({ status: 'confirmed' }).limit(200).get(),
      db.collection('story_relations').where({ status: 'confirmed' }).limit(200).get()
    ]);
    const relationResources = new Map();
    (relationResult.data || []).forEach((relation) => [relation.fromEntityId, relation.toEntityId].filter(Boolean)
      .forEach((entityId) => {
        if (!relationResources.has(entityId)) relationResources.set(entityId, new Set());
        if (relation.resourceId) relationResources.get(entityId).add(relation.resourceId);
      }));
    const confirmedEntities = (entityResult.data || []).map(e => ({ id: e._id || e.id, name: e.name,
      aliases: Array.isArray(e.aliases) ? e.aliases : [], entityType: e.entityType, resourceId: e.resourceId,
      region: e.region || {}, relationResourceIds: [...(relationResources.get(e._id || e.id) || new Set())], status: e.status }));
    const get = async (collection, key) => first(await db.collection(collection).doc(id(key)).get());
    const candidates = await Promise.all(page.map(async c => {
      const job = await get('story_agent_jobs', c.jobId);
      const submission = await get('submissions', c.submissionId);
      const payload = c.payload || {};
      const resourceId = payload.toResourceId || job && job.input && job.input.submission && job.input.submission.boundResourceId || '';
      const resource = resourceId ? await get('resources', resourceId) : null;
      const evidence = await Promise.all((payload.evidenceLinkIds || []).slice(0, 8).map(async key => {
        const source = await get('story_evidence_links', key);
        const origin = source && source.submissionId ? await get('submissions', source.submissionId) : null;
        return { id: key, valid: Boolean(source && source.status === 'confirmed' && source.needsSourceReview !== true
          && source.resourceId === resourceId && hasCurrentAiConsent(origin) && await materialLinkValid(db,source,origin)),
          title: text(source && source.submissionTitle, 120), summary: text(source && source.evidenceSummary, 1000),
          materialReference: referenceFor(source),
          originalText: text(source && source.materialAnalysisId ? source.evidenceSummary : origin && origin.description, 2400) };
      }));
      const sourceCandidate = c.candidateType === 'relation' ? await get('story_agent_candidates', candidateId(c.jobId, payload.fromTemporaryId)) : null;
      const gap = c.candidateType === 'gap' ? await get('story_gap_tasks', require('./story-agent-gaps').taskIdFor(c._id)) : null;
      const duplicateMatches = c.candidateType === 'entity'
        ? rankEntityMatches(payload, confirmedEntities, { resourceId, region: resource && resource.region || {} }) : [];
      return { id: c._id, jobId: c.jobId, candidateType: c.candidateType, status: c.status, risk: c.risk,
        payload, duplicateMatches, resourceId, resourceTitle: text(resource && resource.title, 120),
        gapDraft: gap ? { ...require('./story-gap-tasks').publicTask(gap), draftVersion: gap.draftVersion } : null,
        submissionTitle: text(submission && submission.title, 120), submissionText: text(submission && submission.description, 2400),
        eligible: Boolean(job && ['awaiting_review', 'completed'].includes(job.status) && hasCurrentAiConsent(submission)),
        evidence, sourceName: text(sourceCandidate && sourceCandidate.payload && sourceCandidate.payload.name, 100),
        sourceReady: Boolean(sourceCandidate && sourceCandidate.status === 'approved'),
        formalEntityId: c.formalEntityId || '', formalRelationId: c.formalRelationId || '' };
    }));
    const resources = await db.collection('resources').where({ status: 'published' }).limit(100).get();
    const stories = await db.collection('story_chains').where({ status: 'published' }).limit(100).get();
    return { ok: true, candidates, nextOffset: (result.data || []).length > 30 ? offset + 30 : null,
      entities: confirmedEntities,
      resources: (resources.data || []).map(r => ({ id: r._id, title: r.title })),
      stories: (stories.data || []).map(s => ({ id: s._id, title: text(s.title, 100), resourceId: s.resourceId,
        chapters: (s.chapters || []).map((c, index) => ({ index, title: text(c.title, 100) })) })) };
  }

  async function reviewOne(request, reviewerId, batch = false) {
    id(reviewerId);
    const key = id(request.candidateId);
    if (!['approve', 'reject'].includes(request.decision)) fail('INVALID_DECISION', '请选择确认或驳回');
    const note = text(request.note, 500);
    if (request.decision === 'reject' && note.length < 4) fail('REVIEW_REASON_REQUIRED', '请填写至少四个字的驳回原因');
    return db.runTransaction(async tx => {
      const get = async (collection, key) => first(await tx.collection(collection).doc(id(key)).get());
      const c = await get('story_agent_candidates', key);
      if (!c) fail('CANDIDATE_NOT_FOUND', '建议不存在');
      const finalStatus = request.decision === 'approve' ? 'approved' : 'rejected';
      if (c.status === finalStatus) return { candidateId: key, ok: true, cached: true, status: c.status };
      if (c.status !== 'pending_review') fail('CANDIDATE_ALREADY_REVIEWED', '建议已经处理，请刷新列表');
      const job = await get('story_agent_jobs', c.jobId);
      if (!job || !['awaiting_review', 'completed'].includes(job.status)) fail('JOB_NOT_READY', '分析尚未完成，不能确认建议');
      const p = c.payload || {};
      const edits = request.edits || {};
      const writes = [];
      const updates = [];
      let final = null;
      let formalEntityId = '';
      let formalRelationId = '';
      if (request.decision === 'approve') {
        const submission = await get('submissions', c.submissionId);
        if (!hasCurrentAiConsent(submission)) fail('CONSENT_CHANGED', '投稿审核状态或 AI 授权已变化');
        for (const source of job.input && job.input.evidenceLinks || []) {
          const link = await get('story_evidence_links', source.id);
          const origin = link && link.submissionId ? await get('submissions', link.submissionId) : null;
          if (!link || link.status !== 'confirmed' || link.needsSourceReview === true
            || link.resourceId !== source.resourceId || !hasCurrentAiConsent(origin) || !await materialLinkValid(tx,link,origin)) {
            fail('SOURCE_UNAVAILABLE', '任务引用的来源已失效，不能确认建议');
          }
        }
        if (c.candidateType === 'gap') fail('GAP_NOT_PUBLISHABLE', '资料缺口保留待补充，不能确认成正式关系');
        const resourceId = id(edits.resourceId || p.toResourceId || job.input && job.input.submission && job.input.submission.boundResourceId);
        const resource = await get('resources', resourceId);
        if (!resource || resource.status !== 'published') fail('RESOURCE_UNAVAILABLE', '目标资源已下架或不存在');
        const region = regionOf(resource.region);
        const entityRecord = (entityType, name, summary) => ({ entityType, name, summary, aliases: [], resourceId,
          resourceTitle: resource.title, region, timeRange: {}, status: 'confirmed', isPrimary: false,
          proposedBy: 'agent_review', reviewedBy: reviewerId, reviewedAt: db.serverDate(), createdAt: db.serverDate(), version: 1 });
        if (c.candidateType === 'entity') {
          const entityType = text(edits.entityType || p.entityType, 40);
          const name = text(edits.name === undefined ? p.name : edits.name, 100);
          const summary = text(edits.summary === undefined ? p.summary : edits.summary, 600);
          if (!ENTITY_TYPES.has(entityType) || name.length < 2 || summary.length < 6) fail('INVALID_ENTITY', '请完整填写实体名称、类型和说明');
          formalEntityId = edits.mergeEntityId ? id(edits.mergeEntityId) : entityIdFor(entityType, name, resourceId, region);
          const existing = await get('story_entities', formalEntityId);
          if (edits.mergeEntityId && !existing) fail('MERGE_TARGET_MISSING', '合并目标不存在');
          if (existing && (existing.status !== 'confirmed' || existing.entityType !== entityType || existing.resourceId !== resourceId)) fail('MERGE_TARGET_MISMATCH', '只能合并到同资源、同类型的已确认实体');
          final = existing ? { name: existing.name, entityType, resourceId, mergedInto: formalEntityId } : entityRecord(entityType, name, summary);
          if (!existing) writes.push(['story_entities', formalEntityId, { ...final, aliases: mergedAliases({ name, aliases: [] }, p, name) }]);
          else {
            const aliases = mergedAliases(existing, p, name);
            if (JSON.stringify(aliases) !== JSON.stringify(Array.isArray(existing.aliases) ? existing.aliases : [])) {
              updates.push(['story_entities', formalEntityId, { aliases, updatedAt: db.serverDate(),
                version: Math.max(1, Number(existing.version) || 1) + 1 }]);
            }
          }
        } else if (c.candidateType === 'relation') {
          if (resourceId !== p.toResourceId) fail('RELATION_RESOURCE_CHANGED', '关系必须使用原候选资源，请重新分析其他资源');
          const relationType = text(edits.relationType || p.relationType, 60);
          const why = text(edits.why === undefined ? p.reason : edits.why, 500);
          if (!RELATION_TYPES.has(relationType) || why.length < 8) fail('INVALID_RELATION', '关系类型或说明不完整');
          const high = c.risk === 'high' || HIGH_RISK.has(p.relationType) || HIGH_RISK.has(relationType);
          if (high && (batch || request.highRiskAcknowledged !== true || note.length < 8)) fail('HIGH_RISK_REVIEW_REQUIRED', '高风险建议须逐条核对，并填写至少八个字的判断依据');
          const evidenceLinkIds = [...new Set((p.evidenceLinkIds || []).map(id))];
          if (!evidenceLinkIds.length || !Number.isFinite(Number(p.confidence)) || Number(p.confidence) < 0.6 || c.risk === 'insufficient' || c.risk === 'blocked') fail('INSUFFICIENT_EVIDENCE', '证据不足，请补充材料后重新分析');
          let onlyObservations=true;
          for (const evidenceId of evidenceLinkIds) {
            const evidence = await get('story_evidence_links', evidenceId);
            if (!evidence || evidence.status !== 'confirmed' || evidence.needsSourceReview === true
              || evidence.resourceId !== resourceId) fail('EVIDENCE_CHANGED', '来源已失效或不属于当前资源');
            if(!['image_observation','video_frames'].includes(evidence.materialKind)) onlyObservations=false;
            const origin = evidence.submissionId ? await get('submissions', evidence.submissionId) : null;
            if (!hasCurrentAiConsent(origin) || !await materialLinkValid(tx,evidence,origin)) fail('SOURCE_UNAVAILABLE', '来源投稿已不可用于 AI 建议');
          }
          if(onlyObservations && !['depicts','visually_similar_to'].includes(relationType)) fail('OBSERVATION_SCOPE','画面观察不能独立支持历史关系');
          const dependency = await get('story_agent_candidates', candidateId(c.jobId, p.fromTemporaryId));
          if (!dependency || dependency.status !== 'approved' || !dependency.formalEntityId) fail('ENTITY_REVIEW_REQUIRED', '请先确认这条关系涉及的实体');
          const fromEntityId = dependency.formalEntityId;
          const from = await get('story_entities', fromEntityId);
          if (!from || from.status !== 'confirmed' || from.resourceId !== resourceId) fail('ENTITY_UNAVAILABLE', '起点实体已归档或属于其他资源');
          const targetType = { article: 'text_or_archive', activity: 'event', route: 'place' }[resource.type] || 'building_or_site';
          const toEntityId = entityIdFor(targetType, resource.title, resourceId, region);
          if (fromEntityId === toEntityId) fail('SELF_RELATION_NOT_ALLOWED', '不能建立实体到自身的关系');
          const target = await get('story_entities', toEntityId);
          if (target && target.status !== 'confirmed') fail('ENTITY_UNAVAILABLE', '终点实体已归档');
          if (!target) writes.push(['story_entities', toEntityId, { ...entityRecord(targetType, resource.title, text(resource.summary || resource.description || `资源：${resource.title}`, 600)), isPrimary: true }]);
          formalRelationId = relationIdFor(resourceId, fromEntityId, relationType, toEntityId);
          const existing = await get('story_relations', formalRelationId);
          if (existing && existing.status !== 'confirmed') fail('RELATION_ARCHIVED', '该关系已归档，请在链迹管理中复核');
          if (existing && (existing.why !== why || JSON.stringify(existing.evidenceLinkIds) !== JSON.stringify(evidenceLinkIds))) fail('RELATION_CONFLICT', '已有关系内容不同，请在链迹管理中复核，不能覆盖');
          final = { resourceId, resourceTitle: resource.title, fromEntityId, fromEntityName: from.name, toEntityId,
            toEntityName: resource.title, relationType, why, evidenceLinkIds, confidenceNote: note, status: 'confirmed',
            proposedBy: 'agent_review', reviewedBy: reviewerId, reviewedAt: db.serverDate(), createdAt: db.serverDate(), version: 1 };
          if (!existing) writes.push(['story_relations', formalRelationId, final]);
        } else fail('UNKNOWN_CANDIDATE_TYPE', '不支持的建议类型');
      }
      // All validation reads finish before any transaction write. Review and formal data commit together.
      for (const [collection, recordId, record] of writes) await tx.collection(collection).doc(recordId).set(record);
      for (const [collection, recordId, record] of updates) await tx.collection(collection).doc(recordId).update(record);
      const originalResourceId = p.toResourceId || job.input && job.input.submission && job.input.submission.boundResourceId || '';
      const changes = changedFields(c.candidateType, p, final, edits, originalResourceId);
      const defaultReason = request.decision === 'reject' ? 'other'
        : final && final.mergedInto ? 'duplicate_merged' : changes.length ? 'wording_adjusted' : 'accepted_as_is';
      let reasonCategory = REASON_CATEGORIES.has(request.reasonCategory) ? request.reasonCategory : defaultReason;
      if (request.decision === 'reject' && reasonCategory === 'accepted_as_is') reasonCategory = 'other';
      if (request.decision === 'approve' && changes.length && reasonCategory === 'accepted_as_is') reasonCategory = 'wording_adjusted';
      await tx.collection('story_agent_reviews').doc(key).set({ candidateId: key, jobId: c.jobId, decision: request.decision,
        submissionId: c.submissionId, candidateType: c.candidateType, risk: c.risk || '', original: p, final, note,
        reasonCategory, changedFields: changes, evidenceLinkIds: p.evidenceLinkIds || [],
        model: job.model || '', promptVersion: job.promptVersion || '', codeVersion: job.codeVersion || 'legacy', inputFingerprint: job.idempotencyKey || '',
        reviewerId, createdAt: db.serverDate() });
      await tx.collection('story_agent_candidates').doc(key).update({ status: finalStatus, formalEntityId, formalRelationId, reviewedAt: db.serverDate() });
      await tx.collection('story_graph_logs').doc(`agent_${key}`).set({ action: final && final.mergedInto ? 'agent_merge_entity' : `agent_${request.decision}`, candidateId: key,
        entityId: formalEntityId, relationId: formalRelationId, reviewerId, createdAt: db.serverDate() });
      return { ok: true, candidateId: key, status: finalStatus, formalEntityId, formalRelationId };
    });
  }
  async function review(event, reviewerId) {
    await ensure();
    const requests = Array.isArray(event.items) ? event.items : [event];
    if (!requests.length || requests.length > 20) fail('BATCH_LIMIT', '每次选择 1 至 20 条建议');
    const results = [];
    for (const item of requests) {
      try { results.push(await reviewOne(item, reviewerId, requests.length > 1)); }
      catch (e) { results.push({ candidateId: item.candidateId, ok: false, code: e.code || 'REVIEW_FAILED', message: e.message }); }
    }
    return { ok: true, results };
  }
  return { workspace, review };
}
module.exports = { createStoryAgentReviewService, candidateId, HIGH_RISK, changedFields,
  normalizedName, rankEntityMatches, mergedAliases };
