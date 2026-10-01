'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const projectRoot = path.resolve(__dirname, '..');
const requiredFiles = [
  'guide.html','static/visit-engine.js','static/cultural-guide.js','static/guide-cloud.js','static/guide-entry.js','static/cultural-guide.css','cloudfunctions/appCore/lib/visit-engine.js','cloudfunctions/appCore/domains/visit-sessions.js',
  'cloudfunctions/appCore/domains/ai-consent.js',
  'cloudfunctions/storyWorker/lib/graph-context.js',
  'cloudfunctions/adminSubmissions/domains/story-agent-gaps.js',
  'static/admin-agent-review.js',
  'static/admin-story-themes.js',
  'static/theme-page.js',
  'cloudfunctions/adminSubmissions/domains/story-agent-reviews.js',
  'cloudfunctions/adminSubmissions/domains/story-agent-evaluations.js',
  'index.html',
  'admin.html',
  'themes.html',
  'hubei_boundary.geojson',
  'static/cloudbase-app.js',
  'static/assets/loading-gold-weave.webp',
  'static/discover-paper.css',
  'static/discover-paper.js',
  'static/profile-paper.css',
  'static/profile-paper.js',
  'static/community-paper.css',
  'static/field-paper.css',
  'static/field-paper.js',
  'static/map-paper-edge.css',
  'static/map-paper-edge.js',
  'static/paper-editorial.css',
  'static/paper-editorial.js',
  'static/assets/longcang-editorial-v1.woff2',
  'static/assets/longcang-OFL.txt',
  'static/assets/community-river-collage-v3.webp',
  'static/assets/community-fieldnotes-cover-v1.webp',
  'static/assets/community-phoenix-watermark-v2.webp',
  'static/assets/profile-badge-architecture-v1.webp',
  'static/assets/profile-badge-bronze-v1.webp',
  'static/assets/profile-badge-fieldnotes-v1.webp',
  'static/assets/discover-botanical-paper-v1.webp',
  'static/assets/chulink-ink-wordmark-v1.webp',
  'static/logo.png',
  'static/map-config.js',
  'cloudfunctions/appCore/index.js',
  'cloudfunctions/appCore/domains/resources.js',
  'cloudfunctions/appCore/domains/story-evidence.js',
  'cloudfunctions/appCore/domains/story-themes.js',
  'cloudfunctions/adminSubmissions/data/resources.v1.json',
  'cloudfunctions/adminSubmissions/domains/resource-binding.js',
  'cloudfunctions/adminSubmissions/domains/story-evidence.js',
  'cloudfunctions/adminSubmissions/domains/story-themes.js',
  'cloudfunctions/adminSubmissions/domains/story-theme-proposals.js',
  'cloudfunctions/adminSubmissions/domains/story-quality.js',
  'cloudfunctions/adminSubmissions/index.js',
  'cloudfunctions/storyWorker/index.js',
  'cloudfunctions/storyWorker/lib/config.js',
  'cloudfunctions/storyWorker/lib/contract.js',
  'cloudfunctions/storyWorker/lib/story-contract.js',
  'cloudfunctions/storyWorker/lib/story-quality.js',
  'cloudfunctions/storyWorker/lib/tokenhub-client.js',
  'cloudfunctions/storyWorker/package.json',
  'cloudfunctions/storyAgentWorker/index.js',
  'cloudfunctions/storyAgentWorker/lib/config.js',
  'cloudfunctions/storyAgentWorker/lib/contract.js',
  'cloudfunctions/storyAgentWorker/lib/job-contract.js',
  'cloudfunctions/storyAgentWorker/lib/retrieval.js',
  'cloudfunctions/storyAgentWorker/lib/tokenhub-client.js',
  'cloudfunctions/storyAgentWorker/package.json',
  'cloudfunctions/materialWorker/index.js',
  'cloudfunctions/materialWorker/lib/material-contract.js',
  'cloudfunctions/materialWorker/lib/config.js',
  'cloudfunctions/materialWorker/lib/privacy.js',
  'cloudfunctions/materialWorker/lib/tencent-ocr-client.js',
  'cloudfunctions/materialWorker/package.json',
  'tools/test-material-pipeline.js',
  'tools/test-ai-foundation.js',
  'tools/test-story-quality.js',
  'tools/test-ai-consent-withdrawal.js',
  'tools/test-story-agent-evaluation.js',
  'tools/test-story-agent-feedback-evaluation.js',
  'tools/test-story-section-agent.js',
  'tools/test-map-personalization.js',
  'tools/initialize-story-worker.ps1',
  '.github/workflows/initialize-story-worker.yml',
  'docs/AI_INTERFACE_FOUNDATION.md'
];
const productionTextFiles = [
  'cloudfunctions/appCore/domains/ai-consent.js',
  'cloudfunctions/storyWorker/lib/graph-context.js',
  'cloudfunctions/adminSubmissions/domains/story-agent-gaps.js',
  'static/admin-agent-review.js',
  'static/admin-story-themes.js',
  'static/theme-page.js',
  'cloudfunctions/adminSubmissions/domains/story-agent-reviews.js',
  'cloudfunctions/adminSubmissions/domains/story-agent-evaluations.js',
  'static/map-paper-edge.css',
  'static/map-paper-edge.js',
  'static/paper-editorial.css',
  'static/paper-editorial.js',
  'static/field-paper.css',
  'static/field-paper.js',
  'static/community-paper.css',
  'static/profile-paper.css',
  'static/profile-paper.js',
  'static/discover-paper.css',
  'static/discover-paper.js',
  'index.html',
  'admin.html',
  'themes.html',
  'static/cloudbase-app.js',
  'static/map-config.js',
  'cloudfunctions/appCore/index.js',
  'cloudfunctions/appCore/domains/resources.js',
  'cloudfunctions/appCore/domains/story-evidence.js',
  'cloudfunctions/appCore/domains/story-themes.js',
  'cloudfunctions/adminSubmissions/domains/resource-binding.js',
  'cloudfunctions/adminSubmissions/domains/story-evidence.js',
  'cloudfunctions/adminSubmissions/domains/story-themes.js',
  'cloudfunctions/adminSubmissions/domains/story-theme-proposals.js',
  'cloudfunctions/adminSubmissions/domains/story-quality.js',
  'cloudfunctions/adminSubmissions/index.js',
  'cloudfunctions/storyWorker/index.js',
  'cloudfunctions/storyWorker/lib/config.js',
  'cloudfunctions/storyWorker/lib/contract.js',
  'cloudfunctions/storyWorker/lib/story-contract.js',
  'cloudfunctions/storyWorker/lib/story-quality.js',
  'cloudfunctions/storyWorker/lib/tokenhub-client.js',
  'cloudfunctions/storyAgentWorker/index.js',
  'cloudfunctions/storyAgentWorker/lib/config.js',
  'cloudfunctions/storyAgentWorker/lib/contract.js',
  'cloudfunctions/storyAgentWorker/lib/job-contract.js',
  'cloudfunctions/storyAgentWorker/lib/retrieval.js',
  'cloudfunctions/storyAgentWorker/lib/tokenhub-client.js',
  'cloudfunctions/materialWorker/index.js',
  'cloudfunctions/materialWorker/lib/material-contract.js',
  'cloudfunctions/materialWorker/lib/config.js',
  'cloudfunctions/materialWorker/lib/privacy.js',
  'cloudfunctions/materialWorker/lib/tencent-ocr-client.js'
];
const javascriptFiles = [
  'cloudfunctions/appCore/domains/ai-consent.js',
  'cloudfunctions/storyWorker/lib/graph-context.js',
  'cloudfunctions/adminSubmissions/domains/story-agent-gaps.js',
  'static/admin-agent-review.js',
  'static/admin-story-themes.js',
  'static/theme-page.js',
  'cloudfunctions/adminSubmissions/domains/story-agent-reviews.js',
  'cloudfunctions/adminSubmissions/domains/story-agent-evaluations.js',
  'static/map-paper-edge.js',
  'static/paper-editorial.js',
  'static/field-paper.js',
  'static/profile-paper.js',
  'static/discover-paper.js',
  'static/cloudbase-app.js',
  'static/map-config.js',
  'cloudfunctions/appCore/index.js',
  'cloudfunctions/appCore/domains/resources.js',
  'cloudfunctions/appCore/domains/story-evidence.js',
  'cloudfunctions/appCore/domains/story-themes.js',
  'cloudfunctions/adminSubmissions/domains/resource-binding.js',
  'cloudfunctions/adminSubmissions/domains/story-evidence.js',
  'cloudfunctions/adminSubmissions/domains/story-themes.js',
  'cloudfunctions/adminSubmissions/domains/story-theme-proposals.js',
  'cloudfunctions/adminSubmissions/domains/story-quality.js',
  'cloudfunctions/adminSubmissions/index.js',
  'cloudfunctions/storyWorker/index.js',
  'cloudfunctions/storyWorker/lib/config.js',
  'cloudfunctions/storyWorker/lib/contract.js',
  'cloudfunctions/storyWorker/lib/story-contract.js',
  'cloudfunctions/storyWorker/lib/story-quality.js',
  'cloudfunctions/storyWorker/lib/tokenhub-client.js',
  'cloudfunctions/storyAgentWorker/index.js',
  'cloudfunctions/storyAgentWorker/lib/config.js',
  'cloudfunctions/storyAgentWorker/lib/contract.js',
  'cloudfunctions/storyAgentWorker/lib/job-contract.js',
  'cloudfunctions/storyAgentWorker/lib/retrieval.js',
  'cloudfunctions/storyAgentWorker/lib/tokenhub-client.js',
  'cloudfunctions/materialWorker/index.js',
  'cloudfunctions/materialWorker/lib/material-contract.js',
  'cloudfunctions/materialWorker/lib/config.js',
  'cloudfunctions/materialWorker/lib/privacy.js',
  'cloudfunctions/materialWorker/lib/tencent-ocr-client.js'
];
const guideFiles = [
 ...['storyWorker','adminSubmissions'].flatMap(f=>['guide-content-plan.js','guide-grounding.js','guide-source-context.js'].map(n=>'cloudfunctions/'+f+'/lib/'+n)),
 'cloudfunctions/appCore/lib/guide-grounding.js',
 'cloudfunctions/appCore/lib/guide-source-context.js',
 'cloudfunctions/appCore/lib/guide-contract.js',
  "static/content-effects.js",
  "static/admin-content-effects.js",
  "static/admin-content-effects.css",
  "cloudfunctions/appCore/domains/content-effects.js",
  "cloudfunctions/adminSubmissions/domains/content-effects.js",
  "cloudfunctions/appCore/lib/content-effect-contract.js",
  "cloudfunctions/adminSubmissions/lib/content-effect-contract.js",
  "cloudfunctions/appCore/lib/content-effect-store.js",
  "cloudfunctions/adminSubmissions/lib/content-effect-store.js",
  "cloudfunctions/storyWorker/lib/guide-evidence.js",
  "cloudfunctions/storyWorker/lib/guide-generation-evidence.js",
  "cloudfunctions/adminSubmissions/lib/guide-generation-evidence.js",
  "cloudfunctions/storyWorker/lib/guide-contract.js",
  "cloudfunctions/adminSubmissions/lib/guide-contract.js",
  "cloudfunctions/storyWorker/lib/guide-client.js",
  "cloudfunctions/storyWorker/lib/guide-generation.js",
  "cloudfunctions/adminSubmissions/domains/guide-evaluations.js",
  "guide.html",
  "static/cultural-guide.css",
  "static/admin-guide.css",
  "static/visit-engine.js",
  "static/visit-route.js",
  "static/guide-cloud.js",
  "static/guide-entry.js",
  "static/cultural-guide.js",
  "static/visit-planner.js",
  "static/guide-conversation.js",
  "static/guide-content.js",
  "static/guide-route.js",
  "static/guide-record.js",
  "static/guide-contribution.js",
  "static/admin-guide.js",
  "static/admin-guide-official.js",
  'cloudfunctions/adminSubmissions/lib/official-source-registry.js',
  'cloudfunctions/adminSubmissions/lib/official-source-fetch.js',
  'cloudfunctions/adminSubmissions/lib/guide-official-evidence.js',
  'cloudfunctions/adminSubmissions/domains/guide-official-sources.js',
  'cloudfunctions/appCore/lib/official-source-registry.js',
  'cloudfunctions/appCore/lib/guide-official-evidence.js',
  "static/admin-guide-trial.js",
  "cloudfunctions/storyWorker/lib/guide-trial-budget.js",
  "cloudfunctions/storyWorker/lib/guide-diagnostics.js",
  "cloudfunctions/appCore/lib/visit-engine.js",
  "cloudfunctions/appCore/lib/visit-route.js",
  "cloudfunctions/appCore/lib/guide-evidence.js",
  "cloudfunctions/adminSubmissions/lib/guide-evidence.js",
  "cloudfunctions/appCore/domains/visit-sessions.js",
  "cloudfunctions/appCore/domains/visit-records.js",
  "cloudfunctions/appCore/domains/cultural-guide.js",
  "cloudfunctions/appCore/domains/guide-route.js",
  "cloudfunctions/adminSubmissions/domains/guide-fragments.js"
];
for (const file of guideFiles) { if (!requiredFiles.includes(file)) requiredFiles.push(file); if (!productionTextFiles.includes(file)) productionTextFiles.push(file); if (file.endsWith(".js") && !javascriptFiles.includes(file)) javascriptFiles.push(file); }
for (const file of ["visit-engine.js","visit-route.js"]) { if (fs.readFileSync(path.join(projectRoot,"static",file),"utf8") !== fs.readFileSync(path.join(projectRoot,"cloudfunctions/appCore/lib",file),"utf8")) throw Error("向导规则副本不同步: "+file); }
if (fs.readFileSync(path.join(projectRoot,"cloudfunctions/appCore/lib/guide-evidence.js"),"utf8") !== fs.readFileSync(path.join(projectRoot,"cloudfunctions/adminSubmissions/lib/guide-evidence.js"),"utf8")) throw Error("讲解来源检查副本不同步");
for (const file of guideFiles.filter(f=>f.startsWith("static/")||f==="guide.html")) { if (!fs.readFileSync(path.join(projectRoot,"tools/deploy-cloudbase.ps1"),"utf8").includes("'"+path.basename(file)+"'")) throw Error("发布文件清单缺少："+file); }
for (const name of ['guide-content-plan.js','guide-grounding.js','guide-source-context.js','guide-generation-evidence.js','guide-contract.js','guide-evidence.js']) {if(fs.readFileSync(path.join(projectRoot,'cloudfunctions/storyWorker/lib',name),'utf8')!==fs.readFileSync(path.join(projectRoot,'cloudfunctions/adminSubmissions/lib',name),'utf8'))throw Error('讲解智能体共享副本不同步：'+name);}
for(const name of ['guide-official-evidence.js','official-source-registry.js']){if(read('cloudfunctions/appCore/lib/'+name)!==read('cloudfunctions/adminSubmissions/lib/'+name))throw Error('官网来源公开读取副本不同步：'+name);}
for(const name of ['guide-grounding.js','guide-source-context.js','guide-contract.js']){if(read('cloudfunctions/appCore/lib/'+name)!==read('cloudfunctions/storyWorker/lib/'+name))throw Error('讲解公开读取副本不同步：'+name);}
for(const name of ['content-effect-contract.js','content-effect-store.js']){if(fs.readFileSync(path.join(projectRoot,'cloudfunctions/appCore/lib',name),'utf8')!==fs.readFileSync(path.join(projectRoot,'cloudfunctions/adminSubmissions/lib',name),'utf8'))throw Error('内容效果规则副本不同步：'+name);}
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
for (const htmlFile of ['index.html', 'admin.html', 'themes.html']) {
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
  ['cloud-story-evidence-modal', 'id="cloud-story-evidence-close"'],
  ['cloud-resource-detail-modal', 'data-close-resource-detail']
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
