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
  return cleanText(value, 5000).toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
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

function resolveEntityMatches(candidates, entities) {
  const index = new Map();
  (Array.isArray(entities) ? entities : []).forEach((entity) => {
    const values = [entity.name, ...(Array.isArray(entity.aliases) ? entity.aliases : [])];
    values.forEach((value) => {
      const key = normalizeSearchText(value);
      if (key && !index.has(key)) index.set(key, cleanText(entity._id || entity.id, 128));
    });
  });
  return (Array.isArray(candidates) ? candidates : []).map((candidate) => {
    const values = [candidate.name, ...(Array.isArray(candidate.aliases) ? candidate.aliases : [])];
    const matchedEntityId = values.map(normalizeSearchText).map((key) => index.get(key)).find(Boolean) || '';
    return { ...candidate, matchedEntityId, matchReason: matchedEntityId ? 'exact_name_or_alias' : '' };
  });
}

module.exports = {
  cleanText,
  regionText,
  sanitizeSubmission,
  sanitizeResource,
  normalizeSearchText,
  overlapScore,
  selectRelevantResources,
  resolveEntityMatches
};
