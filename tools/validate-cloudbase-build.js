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
  'cloudfunctions/appCore/domains/story-evidence.js',
  'cloudfunctions/adminSubmissions/data/resources.v1.json',
  'cloudfunctions/adminSubmissions/domains/resource-binding.js',
  'cloudfunctions/adminSubmissions/domains/story-evidence.js',
  'cloudfunctions/adminSubmissions/index.js',
  'cloudfunctions/storyWorker/index.js',
  'cloudfunctions/storyWorker/lib/config.js',
  'cloudfunctions/storyWorker/lib/contract.js',
  'cloudfunctions/storyWorker/lib/tokenhub-client.js',
  'cloudfunctions/storyWorker/package.json',
  'cloudfunctions/materialWorker/index.js',
  'cloudfunctions/materialWorker/lib/material-contract.js',
  'cloudfunctions/materialWorker/package.json',
  'tools/test-material-pipeline.js',
  'tools/test-ai-foundation.js',
  'tools/initialize-story-worker.ps1',
  '.github/workflows/initialize-story-worker.yml',
  'docs/AI_INTERFACE_FOUNDATION.md'
];
const productionTextFiles = [
  'index.html',
  'admin.html',
  'static/cloudbase-app.js',
  'static/map-config.js',
  'cloudfunctions/appCore/index.js',
  'cloudfunctions/appCore/domains/resources.js',
  'cloudfunctions/appCore/domains/story-evidence.js',
  'cloudfunctions/adminSubmissions/domains/resource-binding.js',
  'cloudfunctions/adminSubmissions/domains/story-evidence.js',
  'cloudfunctions/adminSubmissions/index.js',
  'cloudfunctions/storyWorker/index.js',
  'cloudfunctions/storyWorker/lib/config.js',
  'cloudfunctions/storyWorker/lib/contract.js',
  'cloudfunctions/storyWorker/lib/tokenhub-client.js',
  'cloudfunctions/materialWorker/index.js',
  'cloudfunctions/materialWorker/lib/material-contract.js'
];
const javascriptFiles = [
  'static/cloudbase-app.js',
  'static/map-config.js',
  'cloudfunctions/appCore/index.js',
  'cloudfunctions/appCore/domains/resources.js',
  'cloudfunctions/appCore/domains/story-evidence.js',
  'cloudfunctions/adminSubmissions/domains/resource-binding.js',
  'cloudfunctions/adminSubmissions/domains/story-evidence.js',
  'cloudfunctions/adminSubmissions/index.js',
  'cloudfunctions/storyWorker/index.js',
  'cloudfunctions/storyWorker/lib/config.js',
  'cloudfunctions/storyWorker/lib/contract.js',
  'cloudfunctions/storyWorker/lib/tokenhub-client.js',
  'cloudfunctions/materialWorker/index.js',
  'cloudfunctions/materialWorker/lib/material-contract.js'
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
const modalMarkup = `${indexHtml}\n${read('static/cloudbase-app.js')}`;
const stickyCloseControls = [
  ['activity-route-graph-modal', 'closeActivityRouteGraphModal()'],
  ['graph-modal', 'closeGraphModal()'],
  ['endangered-hotspot-modal', 'closeEndangeredHotspot()'],
  ['discover-detail-modal', 'closeDiscoverDetailModal()'],
  ['cloud-discussion-modal', 'id="cloud-discussion-close"'],
  ['cloud-notification-modal', 'id="cloud-notification-close"'],
  ['cloud-story-evidence-modal', 'id="cloud-story-evidence-close"']
];
for (const [modalId, closeMarker] of stickyCloseControls) {
  const modalStart = modalMarkup.indexOf(`id="${modalId}"`);
  const closeControl = modalMarkup.indexOf(closeMarker, modalStart);
  const stickyHeader = modalMarkup.lastIndexOf('sticky top-0', closeControl);
  if (modalStart < 0 || closeControl < modalStart || stickyHeader < modalStart) {
    throw new Error(`${modalId} 的关闭按钮没有固定在滚动窗口顶部`);
  }
  stickyCloseHeaderCount += 1;
}

console.log(
  `CloudBase build validation passed (${requiredFiles.length} files, ${javascriptFiles.length} JavaScript files, ${inlineScriptCount} inline scripts, ${stickyCloseHeaderCount} sticky modal headers).`
);
