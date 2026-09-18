'use strict';
const assert = require('node:assert/strict');
const { fakeDb, fixture } = require('./test-story-agent-reviews');
const { loadGraphContext } = require('../cloudfunctions/storyWorker/lib/graph-context');
const { createStoryRevisionImpactService, suggestImpactedChapter } = require('../cloudfunctions/adminSubmissions/domains/story-revision-impact');
function seed() {
  const data = fixture();
  data.story_entities = { from: { name: '凤纹', status: 'confirmed', resourceId: 'r1' }, to: { name: '花窗', status: 'confirmed', resourceId: 'r1' } };
  data.story_relations = { rel: { status: 'confirmed', resourceId: 'r1', fromEntityId: 'from', toEntityId: 'to', relationType: 'visually_similar_to', why: '仅存在外观上的相似', evidenceLinkIds: ['ev1'], reviewedAt: '2026-09-06', reviewedBy: 'private-admin' } };
  data.story_chains = { story: { status: 'published', resourceId: 'r1', publishedAt: '2026-09-01', sourceLinkIds: ['ev1'], chapters: [{ title: '纹样', body: '窗上的纹样', sourceLinkIds: ['ev1'] }, { title: '位置', body: '现场位置', sourceLinkIds: [] }] } };
  return data;
}
async function main() {
  const db = fakeDb(seed());
  const context = await loadGraphContext(db, 'r1', [{ linkId: 'ev1' }]);
  assert.equal(context.length, 1); assert.match(context[0].interpretation, /不代表同源/);
  assert.equal(JSON.stringify(context).includes('private-admin'), false);
  assert.equal((await loadGraphContext(db, 'r1', [])).length, 0);
  for (const mutate of [s => { s.story_relations.rel.status = 'pending'; }, s => { s.story_entities.from.status = 'archived'; }, s => { s.story_relations.rel.evidenceLinkIds = ['fake']; }, s => { s.story_relations.rel.relationType = 'same_origin'; }]) {
    const data = seed(); mutate(data);
    assert.equal((await loadGraphContext(fakeDb(data), 'r1', [{ linkId: 'ev1' }])).length, 0);
  }
  const svc = createStoryRevisionImpactService({ db });
  const workspace = await svc.workspace();
  const suggestion = workspace.stories[0].candidates.find(c => c.relationId === 'rel');
  assert.equal(suggestion.suggestedChapterIndex, 0);
  db.data().story_chains.story.chapters[1].sourceLinkIds = ['ev1'];
  const ambiguous = (await svc.workspace()).stories[0].candidates.find(c => c.relationId === 'rel');
  assert.equal(ambiguous.suggestedChapterIndex, null);
  db.data().story_evidence_links.ev1.status = 'archived';
  assert.equal((await svc.workspace()).stories.length, 0);
  const tied = suggestImpactedChapter({ chapters: [{title:'纹样',body:'纹样'}, {title:'纹样',body:'纹样'}], link: {relationType:'documents_feature', evidenceSummary:'纹样'}, linkById:new Map(), submission:{} });
  assert.equal(tied.chapterIndex, null);
  console.log('Graph story context passed: valid sources only, archived/unknown exclusion, private fields omitted, precise and ambiguous chapter impacts.');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
