'use strict';

const first = r => Array.isArray(r && r.data) ? r.data[0] : r && r.data;
const text = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const TYPES = new Set(['located_at', 'documents', 'depicts', 'uses_craft', 'associated_with_person', 'associated_with_event', 'mentioned_in', 'changed_over_time', 'visually_similar_to', 'influenced_or_transmitted_to']);

async function loadGraphContext(db, resourceId, sources, selectedRows) {
  const allowed = new Set(sources.map(s => s.linkId));
  let rows;
  try { rows = selectedRows || (await db.collection('story_relations').where({ resourceId, status: 'confirmed' }).limit(60).get()).data || []; }
  catch (e) {
    // Older environments may not have initialized the optional graph collections.
    if (/DATABASE_COLLECTION_NOT_EXIST|collection.*not exist/i.test(`${e.code} ${e.message}`)) return [];
    throw e;
  }
  const result = [];
  for (const row of rows.sort((a,b) => String(a._id).localeCompare(String(b._id)))) {
    if (row.status !== 'confirmed' || row.resourceId !== resourceId) continue;
    const evidenceLinkIds = [...new Set(row.evidenceLinkIds || [])];
    if (!TYPES.has(row.relationType) || !evidenceLinkIds.length || evidenceLinkIds.some(key => !allowed.has(key))) continue;
    if (!row.fromEntityId || !row.toEntityId) continue;
    const from = first(await db.collection('story_entities').doc(row.fromEntityId).get());
    const to = first(await db.collection('story_entities').doc(row.toEntityId).get());
    if (!from || !to || from.status !== 'confirmed' || to.status !== 'confirmed' || from.resourceId !== resourceId || to.resourceId !== resourceId) continue;
    result.push({ relationId: row._id, version: Number(row.version) || 1, relationType: row.relationType,
      from: text(from.name, 100), to: text(to.name, 100), why: text(row.why, 500), evidenceLinkIds,
      interpretation: row.relationType === 'visually_similar_to' ? '仅外观相似，不代表同源、传播或传承' : '管理员确认的关联线索；具体断言仍须由所引原始资料支持' });
    if (result.length >= 12) break;
  }
  return result;
}
module.exports = { loadGraphContext };
