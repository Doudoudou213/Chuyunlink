'use strict';

const assert = require('node:assert/strict');
const { fakeDb } = require('./lib/fake-material-db');
const { createSubmissionResourceService } = require('../cloudfunctions/adminSubmissions/domains/submission-resources');
const { publicResource } = require('../cloudfunctions/appCore/domains/resources');
const { resourceBindingOption } = require('../cloudfunctions/adminSubmissions/domains/resource-binding');

function fixture(extra = {}) {
  const source = { status: 'approved', title: '原始投稿标题', description: '仅供审核的原始文字',
    userId: 'private-owner', fileID: 'cloud://private-file', latitude: 30, longitude: 114,
    aiAnalysisConsent: false, rewardPoints: 100 };
  const db = fakeDb({ submissions: { s1: { ...source }, s2: { ...source } }, resources: {},
    user_profiles: { owner: { points: 100 } }, point_ledger: { original: { amount: 100 } }, ...extra });
  const originalCollection = db.collection;
  const queries = [];
  db.RegExp = function ({ regexp, options }) { return new RegExp(regexp, options); };
  db.collection = name => {
    if (name !== 'resources') return originalCollection(name);
    const query = { ...originalCollection(name) };
    let where = {}, offset = 0, limit = 100;
    query.where = value => { where = value; return query; };
    query.orderBy = () => query;
    query.skip = value => { offset = value; return query; };
    query.limit = value => { limit = value; return query; };
    query.get = async () => {
      queries.push({ where, offset, limit });
      const data = Object.entries(db.data().resources).sort(([a], [b]) => a.localeCompare(b))
        .map(([key, row]) => ({ ...row, _id: key }))
        .filter(row => Object.entries(where).every(([key, value]) =>
          value instanceof RegExp ? value.test(String(row[key] || '')) : row[key] === value));
      return { data: data.slice(offset, offset + limit) };
    };
    return query;
  };
  return { db, queries, service: createSubmissionResourceService({ db }) };
}

const request = { submissionId: 's1', title: '村落木雕记事', regionName: '湖北某村', confirmCreate: true };

async function main() {
  {
    const { db, service } = fixture();
    const before = structuredClone(db.data().submissions.s1);
    const response = await service.create(request, 'reviewer');
    assert.equal(response.cached, false);
    const resource = db.data().resources[response.resourceId];
    assert.equal(resource.status, 'published');
    assert.equal(resource.type, 'article');
    assert.equal(resource.title, request.title);
    assert.deepEqual(resource.region, { label: request.regionName });
    assert.equal(resource.location, null);
    assert.equal(resource.summary, '');
    assert.deepEqual(resource.media, []);
    assert(Object.values(resource.capabilities).every(value => value === false));
    assert.equal(resourceBindingOption(resource).regionName, request.regionName);
    const publicJson = JSON.stringify(publicResource(resource));
    for (const privateValue of ['private-owner', 'cloud://private-file', before.description, 'reviewer', 'identityFingerprint']) {
      assert(!publicJson.includes(privateValue), privateValue);
    }
    const submission = db.data().submissions.s1;
    for (const [key, value] of Object.entries(before)) assert.deepEqual(submission[key], value);
    assert.equal(submission.resourceId, response.resourceId);
    assert.equal(submission.resourceBindingStatus, 'confirmed');
    assert.equal(submission.resourceBindingSource, 'admin_resource_creation');
    assert.equal(db.data().user_profiles.owner.points, 100);
    assert.deepEqual(db.data().point_ledger, { original: { amount: 100 } });
    assert.equal(db.data().story_evidence_links, undefined);
    assert.equal(db.data().ai_jobs, undefined);
    assert.equal(Object.keys(db.data().moderation_logs).length, 1);
    assert.equal((await service.create(request, 'reviewer')).cached, true);
    assert.equal(Object.keys(db.data().moderation_logs).length, 1);
    await assert.rejects(service.create({ ...request, title: '第二个名称' }, 'reviewer'), { code: 'RESOURCE_CREATION_CONFLICT' });
    await db.collection('submissions').doc('s1').update({ resourceId: 'manually-rebound' });
    await assert.rejects(service.create(request, 'reviewer'), { code: 'RESOURCE_CREATION_CONFLICT' });
    assert.equal(db.data().submissions.s1.resourceId, 'manually-rebound');
  }

  {
    const { db, service } = fixture();
    const same = await Promise.all([service.create(request, 'r1'), service.create(request, 'r2')]);
    assert.equal(new Set(same.map(item => item.resourceId)).size, 1);
    assert.equal(same.filter(item => item.cached).length, 1);
    assert.equal(Object.keys(db.data().resources).length, 1);
    assert.equal(Object.keys(db.data().moderation_logs).length, 1);
  }
  {
    const { db, service } = fixture();
    const competing = await Promise.allSettled([
      service.create(request, 'r1'), service.create({ ...request, submissionId: 's2' }, 'r2')
    ]);
    assert.equal(competing.filter(item => item.status === 'fulfilled').length, 1);
    assert.equal(competing.find(item => item.status === 'rejected').reason.code, 'RESOURCE_ALREADY_EXISTS');
    assert.equal(Object.keys(db.data().resources).length, 1);
    assert.equal(Object.keys(db.data().moderation_logs).length, 1);
    assert.equal(Object.values(db.data().submissions).filter(item => item.resourceId).length, 1);
  }

  for (const patch of [{ status: 'pending' }, { status: 'rejected' }, { status: 'needs_revision' },
    { withdrawnAt: 'now' }, { disabledAt: 'now' }, { sourceUnavailable: true }]) {
    const { db, service } = fixture();
    await db.collection('submissions').doc('s1').update(patch);
    await assert.rejects(service.create(request, 'reviewer'), { code: 'APPROVED_SUBMISSION_REQUIRED' });
    assert.equal(Object.keys(db.data().resources).length, 0);
  }
  for (const [patch, code] of [
    [{ title: '' }, 'RESOURCE_TITLE_REQUIRED'], [{ title: '字'.repeat(121) }, 'INVALID_RESOURCE_INPUT'],
    [{ regionName: '字'.repeat(81) }, 'INVALID_RESOURCE_INPUT'], [{ resourceType: 'route' }, 'INVALID_RESOURCE_TYPE'],
    [{ confirmCreate: false }, 'RESOURCE_CONFIRMATION_REQUIRED'], [{ submissionId: '../s1' }, 'INVALID_ID']
  ]) {
    const { service } = fixture();
    await assert.rejects(service.create({ ...request, ...patch }, 'reviewer'), { code });
  }
  {
    const { service } = fixture();
    await assert.rejects(service.create(request, ''), { code: 'ADMIN_REQUIRED' });
    await assert.rejects(service.create({ ...request, submissionId: 'missing' }, 'reviewer'), { code: 'APPROVED_SUBMISSION_REQUIRED' });
  }
  {
    const { db, service } = fixture();
    await db.collection('submissions').doc('s1').update({ resourceId: 'already-bound' });
    await assert.rejects(service.create(request, 'reviewer'), { code: 'SUBMISSION_ALREADY_BOUND' });
  }
  {
    const { db, service } = fixture();
    const result = await service.create({ ...request, resourceType: 'landmark' }, 'reviewer');
    const resource = db.data().resources[result.resourceId];
    assert.equal(resource.location, null);
    assert.equal(resource.capabilities.routable, false);
    assert.equal(resource.capabilities.mappable, false);
    assert.equal(resource.visitInfo.status, 'unknown');
  }
  for (const failingCollection of ['resources', 'submissions', 'moderation_logs']) {
    const { db, service } = fixture();
    const before = structuredClone(db.data());
    db.failOn(failingCollection);
    await assert.rejects(service.create(request, 'reviewer'), /injected failure/);
    assert.deepEqual(db.data(), before, `rollback ${failingCollection}`);
  }
  {
    const resources = Object.fromEntries(Array.from({ length: 140 }, (_, i) => [
      `r${String(i).padStart(3, '0')}`, { title: `已有资源 ${i}`, type: 'article', status: 'published', region: {} }
    ]));
    resources.z_existing = { title: request.title, type: 'article', status: 'published', region: { label: request.regionName } };
    resources.z_private = { title: '未发布资源', type: 'article', status: 'draft' };
    resources.z_literal = { title: '题名[1].*', type: 'article', status: 'published' };
    const { db, queries, service } = fixture({ resources });
    await assert.rejects(service.create(request, 'reviewer'), error =>
      error.code === 'RESOURCE_ALREADY_EXISTS' && error.resourceId === 'z_existing');
    assert.equal(db.data().submissions.s1.resourceId, undefined);
    const found = await service.search({ query: request.title });
    assert.deepEqual(found.items.map(item => item.id), ['z_existing']);
    assert.equal(found.items[0].regionName, request.regionName);
    db.data().resources.z_existing.status = 'archived';
    await assert.rejects(service.create(request, 'reviewer'), { code: 'RESOURCE_UNAVAILABLE_DUPLICATE' });
    assert.equal((await service.search({ query: request.title })).items.length, 0);
    db.data().resources.z_existing.status = 'published';
    assert.equal((await service.search({ query: '[1].*' })).items[0].id, 'z_literal');
    assert.equal((await service.search({ query: '未发布' })).items.length, 0);
    const page1 = await service.search({ query: '已有资源', limit: 20 });
    const page2 = await service.search({ query: '已有资源', limit: 20, offset: page1.nextOffset });
    assert.equal(page1.hasMore, true);
    assert.equal(page2.items.length, 20);
    assert(!page1.items.some(a => page2.items.some(b => a.id === b.id)));
    assert(queries.every(query => query.limit <= 101));
    assert.equal((await service.search({ offset: 140 })).items.length, 2);
    await assert.rejects(service.search({ offset: -1 }), { code: 'INVALID_RESOURCE_PAGE' });
  }
  console.log('Submission resource creation passed: explicit review, atomic creation/binding/audit, concurrent deduplication, repeat safety, privacy, disabled routes and paged search.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
