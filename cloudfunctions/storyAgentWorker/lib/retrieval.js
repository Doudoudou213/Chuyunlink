'use strict';

function cleanText(value, maxLength = 500) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function regionText(value) {
  if (!value) return '';
  if (typeof value === 'object') {
    return cleanText([value.country, value.province, value.city, value.district, value.name]
      .filter(Boolean).join(' · '), 120);
  }
  return cleanText(value, 120);
}

function sanitizeSubmission(item) {
  return {
    title: cleanText(item && (item.title || item.description || '社区投稿'), 120),
    description: cleanText(item && item.description, 2400),
    assetType: cleanText(item && (item.assetType || 'text'), 30),
    regionName: cleanText(item && (item.regionName || regionText(item.region)), 120),
    boundResourceId: cleanText(item && (item.resourceId || item.boundResourceId), 128)
  };
}

function sanitizeResource(item) {
  return {
    id: cleanText(item && (item._id || item.id), 128),
    title: cleanText(item && item.title, 120),
    type: cleanText(item && (item.type || 'article'), 40),
    summary: cleanText(item && (item.summary || item.description), 360),
    region: regionText(item && item.region),
    aliases: [...new Set((Array.isArray(item && item.aliases) ? item.aliases : [])
      .map((value) => cleanText(value, 80)).filter(Boolean))].slice(0, 8)
  };
}

function normalizeSearchText(value) {
  return cleanText(value, 5000).normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function normalizeRegionText(value) {
  return normalizeSearchText(regionText(value)).replace(/特别行政区|自治区|自治州|地区|省|市|盟|区|县/gu, '');
}

function regionCompatibility(left, right) {
  const a = normalizeRegionText(left);
  const b = normalizeRegionText(right);
  if (!a || !b) return 'unknown';
  return a.includes(b) || b.includes(a) ? 'match' : 'conflict';
}

function characterOverlap(left, right) {
  const a = new Set(normalizeSearchText(left));
  const b = new Set(normalizeSearchText(right));
  if (!a.size || !b.size) return 0;
  let shared = 0;
  a.forEach((value) => { if (b.has(value)) shared += 1; });
  return shared / Math.max(a.size, b.size);
}

function nameMatch(leftValues, rightValues) {
  let best = { kind: '', score: 0, reason: '' };
  for (const leftValue of leftValues) {
    const left = normalizeSearchText(leftValue);
    if (!left) continue;
    for (const rightValue of rightValues) {
      const right = normalizeSearchText(rightValue);
      if (!right) continue;
      let current = { kind: '', score: 0, reason: '' };
      if (left === right) current = { kind: 'exact', score: 100, reason: '名称或别名完全一致' };
      else if (Math.min(left.length, right.length) >= 2 && (left.includes(right) || right.includes(left))) {
        current = { kind: 'contained', score: 62, reason: '一个名称包含另一个名称' };
      } else {
        const overlap = characterOverlap(left, right);
        if (overlap >= 0.66) current = { kind: 'similar', score: Math.round(overlap * 70), reason: '名称中的主要文字高度重合' };
      }
      if (current.score > best.score) best = current;
    }
  }
  return best;
}

function entityResourceIds(entity) {
  return [...new Set([entity && entity.resourceId,
    ...(Array.isArray(entity && entity.resourceIds) ? entity.resourceIds : []),
    ...(Array.isArray(entity && entity.relationResourceIds) ? entity.relationResourceIds : [])]
    .map((value) => cleanText(value, 128)).filter(Boolean))];
}

function rankEntityMatches(candidate, entities, context = {}) {
  const candidateType = cleanText(candidate && candidate.entityType, 40);
  const candidateValues = [candidate && candidate.name,
    ...(Array.isArray(candidate && candidate.aliases) ? candidate.aliases : [])].filter(Boolean);
  const candidateResourceIds = [...new Set([context.resourceId,
    ...(Array.isArray(context.resourceIds) ? context.resourceIds : []),
    ...(Array.isArray(context.relationResourceIds) ? context.relationResourceIds : [])]
    .map((value) => cleanText(value, 128)).filter(Boolean))];
  return (Array.isArray(entities) ? entities : []).map((entity) => {
    const entityType = cleanText(entity && entity.entityType, 40);
    if (candidateType && entityType && candidateType !== entityType) return null;
    const match = nameMatch(candidateValues, [entity && entity.name,
      ...(Array.isArray(entity && entity.aliases) ? entity.aliases : [])].filter(Boolean));
    if (!match.score) return null;
    const resources = entityResourceIds(entity);
    const sameResource = candidateResourceIds.some((resourceId) => resources.includes(resourceId));
    const regionState = regionCompatibility(context.region, entity && entity.region);
    if (regionState === 'conflict' && !sameResource) return null;
    const reasons = [match.reason];
    let score = match.score;
    if (sameResource) { score += 25; reasons.push('关联同一文化资源'); }
    if (regionState === 'match') { score += 10; reasons.push('地区信息一致'); }
    const relationAligned = (Array.isArray(entity && entity.relationResourceIds) ? entity.relationResourceIds : [])
      .some((resourceId) => candidateResourceIds.includes(resourceId));
    if (relationAligned) { score += 8; reasons.push('已有关系指向同一资源'); }
    const contextKnown = Boolean(candidateResourceIds.length || normalizeRegionText(context.region));
    const level = match.kind === 'exact' && (sameResource || regionState === 'match' || !contextKnown)
      ? 'strong' : 'review';
    return {
      entityId: cleanText(entity && (entity._id || entity.id), 128),
      name: cleanText(entity && entity.name, 100),
      entityType,
      resourceId: cleanText(entity && entity.resourceId, 128),
      level,
      score,
      reasons: [...new Set(reasons)]
    };
  }).filter((item) => item && item.entityId && item.score >= 45)
    .sort((left, right) => (left.level === right.level ? 0 : left.level === 'strong' ? -1 : 1)
      || right.score - left.score || left.entityId.localeCompare(right.entityId))
    .slice(0, 5);
}

function grams(value) {
  const normalized = normalizeSearchText(value);
  const output = new Set();
  if (normalized.length < 2) {
    if (normalized) output.add(normalized);
    return output;
  }
  for (let index = 0; index < normalized.length - 1; index += 1) {
    output.add(normalized.slice(index, index + 2));
  }
  return output;
}

function overlapScore(left, right) {
  const a = grams(left);
  const b = grams(right);
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  a.forEach((value) => { if (b.has(value)) intersection += 1; });
  return intersection / Math.max(1, Math.min(a.size, b.size));
}

function selectRelevantResources(submissionInput, resources, limit = 12) {
  const submission = sanitizeSubmission(submissionInput || {});
  const sourceText = [submission.title, submission.description, submission.regionName, submission.assetType].join(' ');
  return (Array.isArray(resources) ? resources : [])
    .map(sanitizeResource)
    .filter((item) => item.id && item.title)
    .map((item) => {
      const targetText = [item.title, item.summary, item.region, item.type, ...item.aliases].join(' ');
      let score = overlapScore(sourceText, targetText) * 60;
      if (submission.boundResourceId && item.id === submission.boundResourceId) score += 1000;
      if (submission.regionName && item.region && (
        normalizeSearchText(submission.regionName).includes(normalizeSearchText(item.region)) ||
        normalizeSearchText(item.region).includes(normalizeSearchText(submission.regionName))
      )) score += 24;
      if (submission.assetType && item.type === submission.assetType) score += 5;
      return { item, score };
    })
    .sort((left, right) => right.score - left.score || left.item.id.localeCompare(right.item.id))
    .slice(0, Math.max(1, Math.min(20, Number(limit) || 12)))
    .map(({ item }) => item);
}

function resolveEntityMatches(candidates, entities, contexts = {}) {
  return (Array.isArray(candidates) ? candidates : []).map((candidate) => {
    const context = contexts[candidate.temporaryId] || {};
    const duplicateMatches = rankEntityMatches(candidate, entities, context);
    const strongest = duplicateMatches.find((item) => item.level === 'strong');
    return { ...candidate, matchedEntityId: strongest && strongest.entityId || '',
      matchReason: strongest ? strongest.reasons.join('；') : '', duplicateMatches };
  });
}

module.exports = {
  cleanText,
  regionText,
  sanitizeSubmission,
  sanitizeResource,
  normalizeSearchText,
  normalizeRegionText,
  rankEntityMatches,
  overlapScore,
  selectRelevantResources,
  resolveEntityMatches
};
