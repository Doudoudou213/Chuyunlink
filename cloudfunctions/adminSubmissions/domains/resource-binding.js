'use strict';

function cleanText(value, maxLength = 160) {
  return String(value == null ? '' : value).trim().slice(0, maxLength);
}

function compactText(value) {
  return cleanText(value, 1200)
    .toLowerCase()
    .replace(/[\s·•，。！？、：；（）()《》【】\-_/]+/g, '');
}

function finiteCoordinate(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function distanceKm(left, right) {
  const lat1 = finiteCoordinate(left && left.latitude);
  const lon1 = finiteCoordinate(left && left.longitude);
  const lat2 = finiteCoordinate(right && right.latitude);
  const lon2 = finiteCoordinate(right && right.longitude);
  if ([lat1, lon1, lat2, lon2].some((value) => value === null)) return null;
  const radians = (degrees) => degrees * Math.PI / 180;
  const deltaLat = radians(lat2 - lat1);
  const deltaLon = radians(lon2 - lon1);
  const a = Math.sin(deltaLat / 2) ** 2 +
    Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(deltaLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function resourceRegionLabel(resource) {
  const region = resource && resource.region && typeof resource.region === 'object'
    ? resource.region
    : {};
  return [region.city, region.district].map((value) => cleanText(value, 40)).filter(Boolean).join(' · ');
}

function resourceBindingOption(resource) {
  return {
    id: cleanText(resource && (resource._id || resource.id), 128),
    title: cleanText(resource && resource.title, 120),
    type: cleanText(resource && resource.type, 24) || 'article',
    regionName: resourceRegionLabel(resource)
  };
}

function scoreSubmissionResource(submission, resource) {
  const reasons = [];
  let score = 0;
  const submissionText = compactText([
    submission && submission.title,
    submission && submission.description,
    submission && submission.regionName
  ].filter(Boolean).join(' '));

  const matchedTags = (Array.isArray(resource && resource.tags) ? resource.tags : [])
    .map((tag) => cleanText(tag, 40))
    .filter((tag) => tag && submissionText.includes(compactText(tag)))
    .slice(0, 3);
  if (matchedTags.length) {
    score += Math.min(42, matchedTags.length * 14);
    reasons.push(`文字匹配：${matchedTags.join('、')}`);
  }

  const resourceTitle = compactText(resource && resource.title);
  if (resourceTitle.length >= 4 && submissionText.includes(resourceTitle)) {
    score += 42;
    reasons.push('标题明确对应');
  }

  const region = resource && resource.region && typeof resource.region === 'object' ? resource.region : {};
  const matchedRegions = [region.city, region.district]
    .map((value) => cleanText(value, 40))
    .filter((value) => value && submissionText.includes(compactText(value)));
  if (matchedRegions.length) {
    score += Math.min(26, matchedRegions.length * 13);
    reasons.push(`地区匹配：${matchedRegions.join('、')}`);
  }

  const distance = distanceKm(
    { latitude: submission && submission.latitude, longitude: submission && submission.longitude },
    resource && resource.location
  );
  if (distance !== null) {
    if (distance <= 0.5) {
      score += 75;
      reasons.unshift(`距点位约 ${Math.max(10, Math.round(distance * 1000))} 米`);
    } else if (distance <= 3) {
      score += 58;
      reasons.unshift(`距点位约 ${distance.toFixed(1)} 公里`);
    } else if (distance <= 15) {
      score += 35;
      reasons.push(`距点位约 ${distance.toFixed(1)} 公里`);
    } else if (distance <= 50) {
      score += 12;
      reasons.push(`位于点位周边 ${Math.round(distance)} 公里`);
    }
  }

  return {
    score,
    reasons: [...new Set(reasons)].slice(0, 3),
    distanceKm: distance === null ? null : Number(distance.toFixed(2))
  };
}

function buildResourceBindingCandidates(submission, resources, limit = 6) {
  return (Array.isArray(resources) ? resources : [])
    .filter((resource) => resource && resource.status === 'published')
    .map((resource) => ({ resource, ...scoreSubmissionResource(submission, resource) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score ||
      Number(right.resource.completeness || 0) - Number(left.resource.completeness || 0) ||
      String(left.resource.title || '').localeCompare(String(right.resource.title || ''), 'zh-CN'))
    .slice(0, Math.max(1, Math.min(Number(limit) || 6, 12)))
    .map((entry) => ({
      ...resourceBindingOption(entry.resource),
      score: entry.score,
      reasons: entry.reasons,
      distanceKm: entry.distanceKm
    }));
}

module.exports = {
  buildResourceBindingCandidates,
  distanceKm,
  resourceBindingOption,
  scoreSubmissionResource
};
