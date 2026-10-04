'use strict';
// Offline release gate: no CloudBase writes or paid service calls.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
for (const name of ['deploy-cloudbase.yml', 'initialize-story-worker.yml']) {
  const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows', name), 'utf8');
  if (/^  push:/m.test(workflow) || !workflow.includes('workflow_dispatch:') ||
      !workflow.includes("github.ref == 'refs/heads/doudoudou'")) {
    throw Error(name + ': production actions must be manual and limited to doudoudou');
  }
}
const scripts = [
  'validate-cloudbase-build.js',
  'test-submission-resource-binding.js',
  'test-submission-moderation.js',
  'test-submission-resources.js',
  'test-submission-withdrawal-readers.js',
  'test-submission-title.js',
  'test-ai-consent-withdrawal.js',
  'test-reward-security.js',
  'test-navigation-motion.js',
  'test-paper-motion.js',
  'test-map-route-ink.js'
];
for (const script of scripts) {
  const result = spawnSync(process.execPath, [path.join(__dirname, script)], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log('Offline release checks passed; browser and real cloud acceptance are separate.');
