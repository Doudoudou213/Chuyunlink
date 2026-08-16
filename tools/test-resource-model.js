'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createResourceService, publicResource, scoreResource } = require('../cloudfunctions/appCore/domains/resources');

const root = path.resolve(__dirname, '..');
const seed = require('../cloudfunctions/adminSubmissions/data/resources.v1.json');
const appCoreSource = fs.readFileSync(path.join(root, 'cloudfunctions/appCore/index.js'), 'utf8');
const adminSource = fs.readFileSync(path.join(root, 'cloudfunctions/adminSubmissions/index.js'), 'utf8');
const adminHtml = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const cloudClientSource = fs.readFileSync(path.join(root, 'static/cloudbase-app.js'), 'utf8');
const newWuhanLandmarkIds = [
  'qingchuan-pavilion',
  'jianghanguan-museum',
  'gude-temple',
  'panlongcheng-museum',
  'xinhai-revolution-museum',
  'wuhan-museum'
];

const checks = [];
function check(name, test) {
  test();
  checks.push(name);
  console.log(`PASS ${name}`);
}

check('资源 ID 唯一', () => {
  assert.strictEqual(new Set(seed.map((item) => item.id)).size, seed.length);
});

check('旧资源别名在类型范围内唯一', () => {
  const keys = seed.flatMap((item) => (item.legacyAliases || []).map((alias) => `${alias.type}:${alias.id}`));
  assert.strictEqual(new Set(keys).size, keys.length);
});

check('神农架历史 ID 冲突通过类型别名拆分', () => {
  const landmark = seed.find((item) => item.id === 'shennongjia-muyu');
  const route = seed.find((item) => item.id === 'route-shennongjia-muyu');
  assert(landmark.legacyAliases.some((alias) => alias.type === 'landmark' && alias.id === 'shennongjia-muyu'));
  assert(route.legacyAliases.some((alias) => alias.type === 'activity' && alias.id === 'shennongjia-muyu'));
});

check('所有关联资源都存在', () => {
  const ids = new Set(seed.map((item) => item.id));
  seed.forEach((item) => (item.relatedResourceIds || []).forEach((id) => assert(ids.has(id), `${item.id} -> ${id}`)));
});

check('公开资源视图不会暴露导入指纹', () => {
  const view = publicResource({ ...seed[0], _id: seed[0].id, seedFingerprint: 'secret-internal-value' });
  assert.strictEqual(view.id, seed[0].id);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(view, 'seedFingerprint'), false);
});

check('appCore 新增只读资源接口且保留既有接口', () => {
  ['getResources', 'getResourceDetail', 'searchResources', 'bootstrap', 'getPublic', 'createSubmission', 'createComment', 'redeemReward', 'planRoute']
    .forEach((action) => assert(appCoreSource.includes(`action === '${action}'`), action));
});

check('资源导入仅创建缺失记录', () => {
  const existingGuard = adminSource.indexOf("if (existing) return { id: resource.id, created: false }");
  const write = adminSource.indexOf('await ref.set({', existingGuard);
  assert(existingGuard > 0 && write > existingGuard);
  assert(adminSource.includes("policy: 'create_missing_only'"));
  assert(adminSource.includes('deleted: 0'));
  assert(adminSource.includes('updated: 0'));
});

check('资源导入动作位于管理员鉴权之后', () => {
  const forbidden = adminSource.indexOf("if (!isAdmin)");
  const applyAction = adminSource.indexOf("action === 'applyResourceSeed'");
  assert(forbidden > 0 && applyAction > forbidden);
});

check('管理后台提供只读预览和人工确认导入', () => {
  assert(adminHtml.includes('id="resource-preview-refresh"'));
  assert(adminHtml.includes('action: "previewResourceSeed"'));
  assert(adminHtml.includes('不执行导入，不更新、不覆盖、不删除任何已有数据'));
  assert(adminHtml.includes('data-resource-seed-import'));
  assert(adminHtml.includes('data-resource-confirm-input'));
  assert(adminHtml.includes('action: "applyResourceSeed"'));
  assert(adminHtml.includes('confirmToken: "IMPORT_RESOURCES_V1"'));
  assert.strictEqual(adminHtml.includes('const entered = prompt('), false);
  assert(adminHtml.indexOf('input.value.trim() !== confirmationText') < adminHtml.indexOf('action: "applyResourceSeed"'));
});

check('新增武汉点位同时接入统一资源、地图详情和评论白名单', () => {
  newWuhanLandmarkIds.forEach((id) => {
    const resource = seed.find((item) => item.id === id);
    assert(resource, `missing resource: ${id}`);
    assert.strictEqual(resource.type, 'landmark');
    assert.strictEqual(resource.region.city, '武汉');
    assert.strictEqual(resource.location.coordinateSystem, 'gcj02');
    assert(Number.isFinite(resource.location.latitude));
    assert(Number.isFinite(resource.location.longitude));
    assert(indexHtml.includes(`id: '${id}'`), `missing map point: ${id}`);
    assert(indexHtml.includes(`'${id}': {`), `missing map detail: ${id}`);
    assert(appCoreSource.includes(`'${id}':`), `missing comment target: ${id}`);
  });
});

check('用户端读取统一资源并保留本地降级数据', () => {
  assert(cloudClientSource.includes("action: 'getResources'"));
  assert(cloudClientSource.includes('function applyUnifiedResources'));
  assert(cloudClientSource.includes('window.chulinkResources'));
  assert(cloudClientSource.includes("setUnifiedResourceSyncState('fallback'"));
  assert(cloudClientSource.includes('refreshUnifiedResourceUi'));
  assert(indexHtml.includes('id="resource-sync-status"'));
  assert(indexHtml.includes('function renderHeritageMapMarkers'));
  assert(indexHtml.includes('本地兼容数据'));
});

check('相关资源入口内嵌在原有详情并使用可解释推荐', () => {
  assert(indexHtml.includes('id="discover-related-section"'));
  assert(indexHtml.includes('顺着线索看'));
  assert(indexHtml.includes('function renderDiscoverRelatedResources'));
  assert(indexHtml.includes('function openUnifiedResource'));
  assert(cloudClientSource.includes("action: 'searchResources'"));
  assert(cloudClientSource.includes('loadUnifiedRelatedResources'));
});

check('搜索排序只使用确定性资源字段', () => {
  const base = seed.find((item) => item.id === 'article-yellow-crane-tower');
  const landmark = seed.find((item) => item.id === 'yellow-crane-tower');
  const ranking = scoreResource(landmark, { base, query: '' });
  assert(ranking.score >= 80);
  assert(ranking.reasons.includes('已确认链迹'));
});

async function testResourceService() {
  const published = { ...seed[0], _id: seed[0].id };
  const db = {
    collection() {
      return {
        where() {
          return { limit() { return { async get() { return { data: [published] }; } }; } };
        },
        doc() {
          return { async get() { return { data: [published] }; } };
        }
      };
    }
  };
  const service = createResourceService({ db });
  const list = await service.list({ type: 'hotspot' });
  assert.strictEqual(list.items.length, 1);
  const detail = await service.detail({ resourceId: published.id });
  assert.strictEqual(detail.item.id, published.id);
  console.log('PASS 资源读取服务返回统一公开视图');

  const searchDb = {
    collection() {
      return {
        where() {
          return {
            limit() {
              return {
                async get() {
                  return { data: seed.map((item) => ({ ...item, _id: item.id })) };
                }
              };
            }
          };
        }
      };
    }
  };
  const searchService = createResourceService({ db: searchDb });
  const related = await searchService.search({ resourceId: 'article-yellow-crane-tower', limit: 4 });
  assert.strictEqual(related.deterministic, true);
  assert(related.items.length > 0);
  assert.strictEqual(related.items[0].id, 'yellow-crane-tower');
  assert(related.items[0].relationReasons.includes('已确认链迹'));
  const queried = await searchService.search({ query: '编钟', limit: 5 });
  assert(queried.items.some((item) => item.id === 'article-hubei-museum-bells'));
  console.log('PASS 资源检索按链迹、标签、地区和关键词确定性排序');
}

testResourceService()
  .then(() => console.log(`Resource model validation passed (${checks.length + 2} checks).`))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
