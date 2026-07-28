'use strict';

const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const requiredFiles = [
  'index.html',
  'admin.html',
  'hubei_boundary.geojson',
  'static/cloudbase-app.js',
  'static/logo.png',
  'static/map-config.js',
  'cloudfunctions/appCore/index.js',
  'cloudfunctions/adminSubmissions/index.js'
];
const productionTextFiles = [
  'index.html',
  'admin.html',
  'static/cloudbase-app.js',
  'static/map-config.js',
  'cloudfunctions/appCore/index.js',
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

const html = read('index.html');
const inlineScripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .map((match) => match[1])
  .filter((script) => script.trim());
inlineScripts.forEach((script, index) => {
  try {
    new Function(script);
  } catch (error) {
    throw new Error(`index.html 内联脚本 ${index + 1} 语法错误：${error.message}`);
  }
});

console.log(`CloudBase build validation passed (${requiredFiles.length} files, ${inlineScripts.length} inline scripts).`);
