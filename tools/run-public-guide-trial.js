'use strict';
const fs = require('node:fs'), path = require('node:path');
const { loadConfig } = require('../cloudfunctions/storyWorker/lib/config');
const { runTrial } = require('./lib/public-guide-trial');
(async () => {
  const args = process.argv.slice(2), value = key => args[args.indexOf(key) + 1];
  if (!args.includes('--bundle') || !args.includes('--out')) throw Error('TRIAL_ARGUMENTS');
  const execute = args.includes('--execute');
  // Keys arrive through stdin, never command-line arguments, logs or a file.
  const env = execute ? JSON.parse(fs.readFileSync(0, 'utf8')) : {};
  const config = loadConfig(env);
  const outputDirectory = path.resolve(value('--out'));
  const result = await runTrial({ bundlePath: path.resolve(value('--bundle')), outputDirectory, index: args.includes('--sample') ? Number(value('--sample')) : 0, interest: args.includes('--interest') ? value('--interest') : '通用', variant: args.includes('--variant') ? value('--variant') : 'baseline', execute, config });
  console.log(JSON.stringify(result, null, 2));
})().catch(() => { console.error('试跑未能执行：请检查参数、凭证或本地预算文件；未输出私有配置。'); process.exit(1); });
