'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  buildResourceBindingCandidates,
  distanceKm,
  scoreSubmissionResource
} = require('../cloudfunctions/adminSubmissions/domains/resource-binding');

const root = path.resolve(__dirname, '..');
const resources = require('../cloudfunctions/adminSubmissions/data/resources.v1.json');
const adminSource = fs.readFileSync(path.join(root, 'cloudfunctions/adminSubmissions/index.js'), 'utf8');
const appCoreSource = fs.readFileSync(path.join(root, 'cloudfunctions/appCore/index.js'), 'utf8');
const adminHtml = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
const clientSource = fs.readFileSync(path.join(root, 'static/cloudbase-app.js'), 'utf8');

const yellowCraneSubmission = {
  title: '黄鹤楼碑廊题刻补充',
  description: '现场记录武汉黄鹤楼碑刻和楹联细节',
  regionName: '武汉武昌',
  latitude: 30.5443,
  longitude: 114.3061
};

const ranked = buildResourceBindingCandidates(yellowCraneSubmission, resources, 6);
assert(ranked.length > 0);
assert.strictEqual(ranked[0].id, 'yellow-crane-tower');
assert(ranked[0].score >= 75);
assert(ranked[0].reasons.some((reason) => /距点位/.test(reason)));
console.log('PASS 坐标与文字共同把黄鹤楼排在候选首位');

const wudang = resources.find((item) => item.id === 'wudang-stone-niche');
const textOnly = scoreSubmissionResource({
  title: '武当山石龛题记',
  description: '补充道教建筑和石龛纹样',
  regionName: '十堰武当山'
}, wudang);
assert(textOnly.score > 0);
assert(textOnly.reasons.some((reason) => /文字匹配|地区匹配/.test(reason)));
console.log('PASS 无坐标投稿仍可通过文字和地区生成候选');

const unrelated = buildResourceBindingCandidates({
  title: '校园活动随手拍',
  description: '普通活动照片',
  regionName: '未知'
}, resources, 6);
assert.strictEqual(unrelated.length, 0);
console.log('PASS 缺少证据时不生成虚假候选');

const nearDistance = distanceKm(
  { latitude: 30.5442, longitude: 114.3062 },
  { latitude: 30.5443, longitude: 114.3061 }
);
assert(nearDistance !== null && nearDistance < 0.1);
console.log('PASS 点位距离计算使用有限坐标');

assert(adminSource.includes("action === 'bindSubmissionResource'"));
assert(adminSource.includes("selectedResource.status !== 'published'"));
assert(adminSource.includes("action: 'submission_resource_binding'"));
assert(adminSource.indexOf("if (!isAdmin)") < adminSource.indexOf("action === 'bindSubmissionResource'"));
assert(adminSource.includes("resourceBindingSource: requestedResourceId ? 'admin_review' : ''"));
console.log('PASS 资源绑定只在管理员鉴权后执行并验证已发布资源');

assert(adminHtml.includes('id="resource-binding-refresh"'));
assert(adminHtml.includes('data-resource-binding-select'));
assert(adminHtml.includes('暂不关联资源'));
assert(adminHtml.includes('系统不会自动绑定，请人工确认'));
assert(adminHtml.includes('action: "bindSubmissionResource"'));
console.log('PASS 管理后台默认不选候选并支持历史投稿补关联');

assert(appCoreSource.includes("resourceId: item.resourceId || ''"));
assert(clientSource.includes('const mapped = {'));
assert(clientSource.includes('...item'));
assert(clientSource.includes('loadUnifiedRelatedResources(itemId)'));
console.log('PASS 公开投稿携带资源 ID 并复用现有相关内容入口');

console.log('Submission resource binding validation passed (7 checks).');
