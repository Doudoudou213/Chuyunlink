'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createResourceService, publicResource } = require('../cloudfunctions/appCore/domains/resources');

const root = path.resolve(__dirname, '..');
const seed = require('../cloudfunctions/adminSubmissions/data/resources.v1.json');
const appCoreSource = fs.readFileSync(path.join(root, 'cloudfunctions/appCore/index.js'), 'utf8');
const adminSource = fs.readFileSync(path.join(root, 'cloudfunctions/adminSubmissions/index.js'), 'utf8');

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
  ['getResources', 'getResourceDetail', 'bootstrap', 'getPublic', 'createSubmission', 'createComment', 'redeemReward', 'planRoute']
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
}

testResourceService()
  .then(() => console.log(`Resource model validation passed (${checks.length + 1} checks).`))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

