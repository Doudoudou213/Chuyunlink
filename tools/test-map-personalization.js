'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const functionStart = source.indexOf('function generatePersonalizedMapPlannerRoute()');
const functionEnd = source.indexOf('\n    function renderMapPlanner()', functionStart);
assert(functionStart > 0 && functionEnd > functionStart, 'missing personalized planner function');
const implementation = source.slice(functionStart, functionEnd);

const checks = [
  ['界面明确标注规则推荐而非 AI', () => assert(source.includes('只用时间、强度、兴趣和点位距离进行规则排序') && source.includes('非 AI'))],
  ['时间仅接受三档明确预算', () => assert(source.includes("[120, 240, 420].includes(Number(value))"))],
  ['强度仅接受三档明确选项', () => assert(source.includes("['relaxed', 'balanced', 'active'].includes(value)"))],
  ['兴趣词表来自本地人工定义', () => assert(source.includes('mapPlannerInterestDefinitions') && source.includes("id: 'architecture'") && source.includes("id: 'community'"))],
  ['推荐限制在同一城市组', () => assert(implementation.includes('cityGroups') && implementation.includes('selectedGroup'))],
  ['排序使用兴趣、资料状态和真实位置', () => assert(source.includes('getMapPlannerInterestMatches') && source.includes('item.status') && source.includes('currentLocation.isReal'))],
  ['推荐过程不调用 AI 或外部生成接口', () => assert(!/fetch\(|storyWorker|AI_|generateContent|Math\.random/.test(implementation))],
  ['生成结果只写入本地行程篮', () => assert(implementation.includes('mapPlannerSelectedIds =') && implementation.includes('saveMapPlannerState()'))],
  ['用户仍可增删和拖动路线', () => assert(source.includes('addMapPlannerPoint') && source.includes('removeMapPlannerPoint') && source.includes('handleMapPlannerDrop'))],
  ['每个推荐点展示可解释理由', () => assert(source.includes('mapPlannerRecommendationReasons') && source.includes('推荐理由：'))],
  ['道路与开放状态保留当天核验提示', () => assert(implementation.includes('道路与开放状态仍以当天信息为准'))]
];

for (const [label, check] of checks) {
  check();
  process.stdout.write(`✓ ${label}\n`);
}

process.stdout.write(`规则型个性化游览测试通过：${checks.length} 项。\n`);
