const TYPE_LABELS = {
  landmark: '文化点位',
  hotspot: '守护热点',
  activity: '活动',
  article: '图文',
  experience: '体验',
  route: '路线'
};

function resourceCard(item) {
  const region = item.region || {};
  return Object.assign({}, item, {
    typeLabel: TYPE_LABELS[item.type] || '文化资源',
    regionLabel: [region.city, region.district].filter(Boolean).join(' · ') || '湖北',
    tagPreview: (item.tags || []).slice(0, 3)
  });
}

function submissionCard(item) {
  return Object.assign({}, item, {
    summary: item.description || '一份正在被继续补充的荆楚文化记录。',
    storyLead: item.storyCard && (item.storyCard.lead || item.storyCard.summary) || ''
  });
}

module.exports = { resourceCard, submissionCard };
