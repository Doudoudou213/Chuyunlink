'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const projectRoot = path.resolve(__dirname, '..');
const requiredFiles = [
  'index.html',
  'admin.html',
  'hubei_boundary.geojson',
  'static/cloudbase-app.js',
  'static/logo.png',
  'static/map-config.js',
  'cloudfunctions/appCore/index.js',
  'cloudfunctions/appCore/domains/resources.js',
  'cloudfunctions/adminSubmissions/data/resources.v1.json',
  'cloudfunctions/adminSubmissions/index.js'
];
const productionTextFiles = [
  'index.html',
  'admin.html',
  'static/cloudbase-app.js',
  'static/map-config.js',
  'cloudfunctions/appCore/index.js',
  'cloudfunctions/appCore/domains/resources.js',
  'cloudfunctions/adminSubmissions/index.js'
];
const javascriptFiles = [
  'static/cloudbase-app.js',
  'static/map-config.js',
  'cloudfunctions/appCore/index.js',
  'cloudfunctions/appCore/domains/resources.js',
  'cloudfunctions/adminSubmissions/index.js'
];
const forbiddenPatterns = [
  { label: 'localhost', pattern: /\blocalhost\b/i },
  { label: '127.0.0.1', pattern: /\b127\.0\.0\.1\b/ },
  { label: 'legacy quality API', pattern: /\/api\/quality-check\b/ },
  { label: 'legacy location API', pattern: /\/api\/verify-location\b/ },
  { label: 'legacy submission API', pattern: /\/api\/submissions\b/ },
  { label: 'legacy API variable', pattern: /\bLOCAL_API_BASE_URL\b/ },
  { label: 'legacy API mode', pattern: /\blocalApiMode\b/ }
];

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

for (const relativePath of requiredFiles) {
  if (!fs.existsSync(path.join(projectRoot, relativePath))) {
    throw new Error(`缺少 CloudBase 部署文件：${relativePath}`);
  }
}

for (const relativePath of productionTextFiles) {
  const content = read(relativePath);
  for (const rule of forbiddenPatterns) {
    if (rule.pattern.test(content)) {
      throw new Error(`${relativePath} 仍包含 ${rule.label}，已阻止部署`);
    }
  }
}

for (const relativePath of javascriptFiles) {
  try {
    new vm.Script(read(relativePath), { filename: relativePath });
  } catch (error) {
    throw new Error(`${relativePath} 语法错误：${error.message}`);
  }
}

let inlineScriptCount = 0;
let stickyCloseHeaderCount = 0;
for (const htmlFile of ['index.html', 'admin.html']) {
  const html = read(htmlFile);
  const inlineScripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1])
    .filter((script) => script.trim());
  inlineScripts.forEach((script, index) => {
    try {
      new Function(script);
    } catch (error) {
      throw new Error(`${htmlFile} 内联脚本 ${index + 1} 语法错误：${error.message}`);
    }
  });
  inlineScriptCount += inlineScripts.length;
}

const indexHtml = read('index.html');
const activityRouteDrawingStart = indexHtml.indexOf('function drawCommunityRouteOnMap');
const activityRouteDrawingEnd = indexHtml.indexOf('function getCommunityRouteRoadPoints', activityRouteDrawingStart);
const activityRouteDrawing = indexHtml.slice(activityRouteDrawingStart, activityRouteDrawingEnd);
if (activityRouteDrawingStart < 0 || activityRouteDrawingEnd < 0 || /dashArray/.test(activityRouteDrawing)) {
  throw new Error('活动路线仍在使用虚线示意，未完成产品级道路展示升级');
}
if (!indexHtml.includes('await window.planCloudRoute({') ||
    !indexHtml.includes('function drawProductRoadRoute') ||
    !indexHtml.includes('id="map-route-provider-note"')) {
  throw new Error('活动路线没有完整接入高德道路几何、双层道路样式或数据来源说明');
}
const stickyCloseControls = [
  ['activity-route-graph-modal', 'closeActivityRouteGraphModal()'],
  ['graph-modal', 'closeGraphModal()'],
  ['endangered-hotspot-modal', 'closeEndangeredHotspot()'],
  ['discover-detail-modal', 'closeDiscoverDetailModal()'],
  ['cloud-discussion-modal', 'id="cloud-discussion-close"'],
  ['cloud-notification-modal', 'id="cloud-notification-close"']
];
for (const [modalId, closeMarker] of stickyCloseControls) {
  const modalStart = indexHtml.indexOf(`id="${modalId}"`);
  const closeControl = indexHtml.indexOf(closeMarker, modalStart);
  const stickyHeader = indexHtml.lastIndexOf('sticky top-0', closeControl);
  if (modalStart < 0 || closeControl < modalStart || stickyHeader < modalStart) {
    throw new Error(`${modalId} 的关闭按钮没有固定在滚动窗口顶部`);
  }
  stickyCloseHeaderCount += 1;
}

console.log(
  `CloudBase build validation passed (${requiredFiles.length} files, ${javascriptFiles.length} JavaScript files, ${inlineScriptCount} inline scripts, ${stickyCloseHeaderCount} sticky modal headers).`
);
