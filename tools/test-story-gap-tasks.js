'use strict';

const assert = require('assert');
const { createStoryGapTaskService, contributionIdFor, publicTask } = require('../cloudfunctions/adminSubmissions/domains/story-gap-tasks');

function createFakeDb(seed) {
  const data = new Map(Object.entries(seed).map(([name, rows]) => [name, new Map(Object.entries(rows))]));
  let sequence = 0;
  function collection(name) {
    if (!data.has(name)) data.set(name, new Map());
    const rows = data.get(name);
    return {
      doc(id) {
        return {
          async get() { return { data: rows.has(id) ? [{ _id: id, ...rows.get(id) }] : [] }; },
          async update(patch) { rows.set(id, { ...(rows.get(id) || {}), ...patch }); },
          async set(record) { rows.set(id, record); }
        };
      },
      limit() { return { async get() { return { data: [...rows].map(([id, row]) => ({ _id: id, ...row })) }; } }; },
      async add(record) { const id = `generated-${++sequence}`; rows.set(id, record); return { id }; }
    };
  }
  return { collection, serverDate() { return 'SERVER_DATE'; }, async runTransaction(handler) { return handler({ collection }); }, data };
}

(async () => {
  const db = createFakeDb({
    story_chains: { 'story-1': { status: 'published', resourceId: 'resource-1', version: 2, chapters: [{ title: '第一章' }] } },
    submissions: { 'submission-1': { status: 'approved', gapTaskId: 'generated-1', userId: 'user-1', contributorName: '记录者' } },
    story_gap_tasks: {},
    story_gap_task_logs: {},
    story_contributions: {},
    interaction_notifications: {},
    point_ledger: {},
    user_profiles: { 'user-1': { uid: 'user-1', nickname: '记录者', points: 100, uploadCount: 1, approvedCount: 1 } }
  });
  const service = createStoryGapTaskService({ db });
  const published = await service.publish({ storyId: 'story-1', title: '补拍木窗背面结构', description: '请拍摄无遮挡、可辨认连接方式的近景照片。', requestedAssetType: 'image', rewardPoints: 200, chapterIndex: 0 }, 'admin-1');
  assert.strictEqual(published.task.status, 'published');
  assert.strictEqual(published.task.resourceId, 'resource-1');
  assert.strictEqual(published.task.rewardPoints, 200);
  assert.strictEqual(publicTask({ _id: 'x', rewardPoints: 999 }).rewardPoints, 999);

  const fulfilled = await service.fulfill({ taskId: published.task.id, submissionId: 'submission-1' }, 'admin-1');
  assert.strictEqual(fulfilled.rewardStatus, 'pending_manual_confirmation');
  assert.strictEqual(db.data.get('story_gap_tasks').get(published.task.id).status, 'fulfilled');
  assert.notStrictEqual(db.data.get('story_gap_tasks').get(published.task.id).rewardStatus, 'awarded');
  assert.strictEqual(db.data.get('story_contributions').get(contributionIdFor(published.task.id, 'submission-1')).status, 'adopted');

  const awarded = await service.award({ taskId: published.task.id }, 'admin-1');
  assert.strictEqual(awarded.rewardPoints, 200);
  assert.strictEqual(db.data.get('user_profiles').get('user-1').points, 300);
  assert.strictEqual(db.data.get('story_gap_tasks').get(published.task.id).rewardStatus, 'awarded');
  const repeated = await service.award({ taskId: published.task.id }, 'admin-1');
  assert.strictEqual(repeated.cached, true);
  assert.strictEqual(db.data.get('user_profiles').get('user-1').points, 300, '重复确认不得重复发分');

  await assert.rejects(
    service.publish({ storyId: 'story-1', title: '太短', description: '也太短', requestedAssetType: 'image' }, 'admin-1'),
    (error) => error.code === 'INVALID_GAP_TASK_TEXT'
  );
  console.log('Story gap task checks passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
