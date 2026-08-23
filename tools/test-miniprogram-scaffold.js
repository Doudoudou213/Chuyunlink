'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const requiredFiles = [
  'project.config.json',
  'miniprogram/app.js',
  'miniprogram/app.json',
  'miniprogram/app.wxss',
  'miniprogram/config/index.js',
  'miniprogram/services/auth.js',
  'miniprogram/services/core.js',
  'cloudfunctions/miniProgramAuth/index.js'
];

requiredFiles.forEach((relativePath) => {
  if (!fs.existsSync(path.join(root, relativePath))) throw new Error(`Missing ${relativePath}`);
});

const project = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'));
const app = JSON.parse(fs.readFileSync(path.join(root, 'miniprogram/app.json'), 'utf8'));
const sourceFiles = requiredFiles
  .filter((file) => /\.(js|json)$/.test(file))
  .map((file) => fs.readFileSync(path.join(root, file), 'utf8'))
  .join('\n');

if (project.appid !== 'wxd39e239481fcb7f9') throw new Error('Unexpected mini program AppID');
if (project.miniprogramRoot !== 'miniprogram/') throw new Error('miniprogramRoot is not configured');
if (!Array.isArray(app.tabBar && app.tabBar.list) || app.tabBar.list.length !== 4) throw new Error('Expected four primary tabs');
if (app.pages.length < 5) throw new Error('Expected four tabs and resource detail page');
if (!Array.isArray(app.requiredPrivateInfos) || app.requiredPrivateInfos.some((name) => name === 'chooseMedia')) {
  throw new Error('chooseMedia is not allowed in requiredPrivateInfos');
}
if (/WX_SECRET\s*[:=]\s*['\"][^'\"]+['\"]/.test(sourceFiles)) throw new Error('WX_SECRET must not be committed');
if (/TCB_CUSTOM_PRIVATE_KEY\s*[:=]\s*['\"][^'\"]+['\"]/.test(sourceFiles)) throw new Error('Custom login private key must not be committed');

console.log('Mini program scaffold checks passed.');
